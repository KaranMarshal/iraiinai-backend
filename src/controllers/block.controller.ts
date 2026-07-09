import { Response as ExpressResponse } from 'express';
import mongoose, { Types } from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Match } from '../models/Match';
import { Chat } from '../models/Chat';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class BlockController {
  /**
   * POST /api/v1/safety/block
   * Block a user. Automatically unmatch if they were matched.
   * Body: { targetUserId: string }
   */
  static block = async (req: AuthenticatedRequest, res: ExpressResponse) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');

      const myId = req.user._id.toString();
      const { targetUserId } = req.body;

      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return sendResponse(res, 400, false, 'Invalid targetUserId.');
      }
      if (targetUserId === myId) {
        return sendResponse(res, 400, false, 'You cannot block yourself.');
      }

      const targetObjId = new Types.ObjectId(targetUserId);

      // Add to blocked list (avoid duplicates with $addToSet)
      await User.findByIdAndUpdate(myId, {
        $addToSet: { blockedUsers: targetObjId },
      });

      // Unmatch if they were matched — set status to 'passed'
      await Match.updateMany(
        {
          status: 'matched',
          $or: [
            { user1: myId, user2: targetUserId },
            { user1: targetUserId, user2: myId },
          ],
        },
        { $set: { status: 'passed' } }
      );

      logger.info(`[Block] User ${myId} blocked ${targetUserId}`);
      return sendResponse(res, 200, true, 'User blocked successfully.');
    } catch (err: any) {
      logger.error(`[Block] block error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to block user.');
    }
  };

  /**
   * DELETE /api/v1/safety/block/:targetId
   * Unblock a previously blocked user.
   */
  static unblock = async (req: AuthenticatedRequest, res: ExpressResponse) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');

      const myId = req.user._id.toString();
      const { targetId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(targetId)) {
        return sendResponse(res, 400, false, 'Invalid user ID.');
      }

      await User.findByIdAndUpdate(myId, {
        $pull: { blockedUsers: new Types.ObjectId(targetId) },
      });

      logger.info(`[Block] User ${myId} unblocked ${targetId}`);
      return sendResponse(res, 200, true, 'User unblocked successfully.');
    } catch (err: any) {
      logger.error(`[Block] unblock error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to unblock user.');
    }
  };

  /**
   * GET /api/v1/safety/blocked
   * List all users blocked by the authenticated user, with basic profile info.
   */
  static getBlockedUsers = async (req: AuthenticatedRequest, res: ExpressResponse) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');

      const myId = req.user._id.toString();
      const me = await User.findById(myId).select('blockedUsers').lean();
      if (!me || !me.blockedUsers?.length) {
        return sendResponse(res, 200, true, 'No blocked users.', []);
      }

      // Fetch basic profile info for each blocked user
      const { Profile } = await import('../models/Profile');
      const profiles = await Profile.find({ user: { $in: me.blockedUsers } })
        .select('user name photos')
        .lean();

      const result = profiles.map(p => ({
        userId: p.user,
        name: p.name,
        photo: p.photos?.[0] || null,
      }));

      return sendResponse(res, 200, true, 'Blocked users retrieved.', result);
    } catch (err: any) {
      logger.error(`[Block] getBlockedUsers error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve blocked users.');
    }
  };
}

export default BlockController;
