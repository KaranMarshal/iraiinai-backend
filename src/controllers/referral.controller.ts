import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { ReferralReward } from '../models/ReferralReward';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import mongoose from 'mongoose';

export class ReferralController {
  /**
   * Link user (referee) to a referrer using their invite/referral code
   */
  static applyInviteCode = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { code } = req.body;
      if (!code || typeof code !== 'string') {
        return sendResponse(res, 400, false, 'Invite code is required.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const currentUser = await User.findById(req.user._id);
      if (!currentUser) {
        return sendResponse(res, 404, false, 'Current user record not found.');
      }

      // Check if user already entered an invite code
      if (currentUser.referredBy) {
        return sendResponse(res, 400, false, 'You have already been referred by someone else.');
      }

      // Find the referrer by code
      const referrer = await User.findOne({ referralCode: code.trim().toUpperCase() });
      if (!referrer) {
        return sendResponse(res, 400, false, 'Invalid invite code. Please check and try again.');
      }

      // Prevent self-referral
      if (referrer._id.toString() === currentUser._id.toString()) {
        return sendResponse(res, 400, false, 'You cannot use your own invite code.');
      }

      // Link referee to referrer
      currentUser.referredBy = referrer._id;
      await currentUser.save();

      logger.info(`User ${currentUser._id} referred by ${referrer._id} using code ${code}`);
      return sendResponse(res, 200, true, 'Invite code applied successfully!');
    } catch (error: any) {
      logger.error(`applyInviteCode error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to apply invite code.');
    }
  };

  /**
   * Get referral stats, invite details, and dashboard analytics
   */
  static getAnalytics = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const userId = req.user._id;

      // 1. Fetch all users referred by current user
      const referredUsers = await User.find({ referredBy: userId });
      const totalReferredCount = referredUsers.length;

      // 2. Fetch all rewards associated with this referrer (amount = 200)
      const rewards = await ReferralReward.find({ referrer: userId, amount: 200 });

      const totalRewardsEarned = rewards
        .filter((r) => r.status === 'claimed' || r.status === 'completed')
        .reduce((sum, r) => sum + r.amount, 0);

      const pendingRewards = rewards
        .filter((r) => r.status === 'pending')
        .reduce((sum, r) => sum + r.amount, 0);

      // 3. Assemble detailed list of referred users
      const referralList = await Promise.all(
        referredUsers.map(async (referee) => {
          const profile = await Profile.findOne({ user: referee._id }, 'name');
          const reward = rewards.find((r) => r.referee.toString() === referee._id.toString());
          
          return {
            refereeId: referee._id,
            name: profile?.name || referee.email?.split('@')[0] || 'User',
            signupDate: referee.createdAt,
            plan: referee.subscription?.plan || 'free',
            status: referee.subscription?.status === 'active' && referee.subscription?.plan !== 'free' ? 'upgraded' : 'registered',
            rewardAmount: reward ? reward.amount : 0,
            rewardStatus: reward ? reward.status : 'none',
            rewardId: reward ? reward._id : null,
          };
        })
      );

      return sendResponse(res, 200, true, 'Referral analytics retrieved successfully.', {
        referralCode: req.user.referralCode,
        referredBy: req.user.referredBy,
        totalReferredCount,
        successfulReferredCount: referredUsers.filter(u => u.subscription?.status === 'active' && u.subscription?.plan !== 'free').length,
        totalRewardsEarned,
        pendingRewards,
        referralList,
      });
    } catch (error: any) {
      logger.error(`getAnalytics error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch referral analytics.');
    }
  };

  /**
   * Fetch all rewards log for the referrer
   */
  static getRewards = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const rewards = await ReferralReward.find({
        $or: [
          { referrer: req.user._id, amount: 200 },
          { referee: req.user._id, amount: 100 }
        ]
      })
        .populate('referee', 'email')
        .sort({ createdAt: -1 });

      const formattedRewards = await Promise.all(
        rewards.map(async (r: any) => {
          const refereeProfile = await Profile.findOne({ user: r.referee._id }, 'name');
          return {
            _id: r._id,
            refereeName: refereeProfile?.name || r.referee.email.split('@')[0],
            amount: r.amount,
            status: r.status,
            rewardType: r.rewardType,
            claimedAt: r.claimedAt,
            createdAt: r.createdAt,
          };
        })
      );

      return sendResponse(res, 200, true, 'Rewards logs retrieved successfully.', {
        rewards: formattedRewards,
      });
    } catch (error: any) {
      logger.error(`getRewards error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch rewards.');
    }
  };

  /**
   * Claim completed rewards as cashback
   */
  static claimReward = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const rewardId = req.params.id;
      if (!mongoose.Types.ObjectId.isValid(rewardId)) {
        return sendResponse(res, 400, false, 'Invalid reward ID format.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const reward = await ReferralReward.findById(rewardId);
      if (!reward) {
        return sendResponse(res, 404, false, 'Reward not found.');
      }

      // Check ownership: referrer owns the 200 reward, referee owns the 100 reward
      const isReferrer = reward.referrer.toString() === req.user._id.toString() && reward.amount === 200;
      const isReferee = reward.referee.toString() === req.user._id.toString() && reward.amount === 100;

      if (!isReferrer && !isReferee) {
        return sendResponse(res, 403, false, 'Unauthorized to claim this reward.');
      }

      if (reward.status === 'claimed') {
        return sendResponse(res, 400, false, 'This reward has already been claimed.');
      }

      if (reward.status === 'pending') {
        return sendResponse(res, 400, false, 'This reward is still pending and cannot be claimed yet.');
      }

      // Mark as claimed
      reward.status = 'claimed';
      reward.claimedAt = new Date();
      await reward.save();

      // Trigger user in-app notification of claimed reward
      const { Notification } = require('../models/Notification');
      Notification.create({
        recipient: req.user._id,
        type: 'subscription',
        title: 'Cashback Claimed! 💰',
        body: `Congratulations! Your cashback reward of ₹${reward.amount} was successfully claimed and credited to your primary account.`,
        dataPayload: new Map([['type', 'cashback']]),
        isRead: false
      }).catch((nErr: any) => {
        logger.error(`Failed to log claim notification: ${nErr.message}`);
      });

      logger.info(`User ${req.user._id} claimed referral reward of ₹${reward.amount}`);

      return sendResponse(res, 200, true, 'Cashback reward claimed successfully!', {
        reward,
      });
    } catch (error: any) {
      logger.error(`claimReward error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to claim reward.');
    }
  };
}
