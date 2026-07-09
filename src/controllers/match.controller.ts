import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Match } from '../models/Match';
import { Horoscope } from '../models/Horoscope';
import { InterestRequest } from '../models/InterestRequest';
import { Notification } from '../models/Notification';
import { AIService } from '../services/ai.service';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import { secureProfileMedia } from './profile.controller';
import { MatchmakingService } from '../services/matchmaking.service';
import { FirebaseService } from '../services/firebase.service';
import { clearCachePrefix } from '../middleware/cache.middleware';

export class MatchController {
  /**
   * Fetch potential partner profiles matching preferences
   */
  static getPotentialMatches = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      const myProfile = await Profile.findOne({ user: req.user._id });
      if (!myProfile) {
        return sendResponse(res, 400, false, 'Please create a profile first to discover matches.');
      }

      // Filter by opposite gender
      const targetGender = myProfile.gender === 'male' ? 'female' : 'male';

      // Find existing swipes to exclude them
      const swipedMatches = await Match.find({
        $or: [{ user1: req.user._id }, { user2: req.user._id }],
      });

      const myUserIdString = req.user._id.toString();
      const swipedUserIds = swipedMatches.map((m) =>
        m.user1.toString() === myUserIdString ? m.user2 : m.user1
      );

      // Find existing interest requests to exclude them
      const interestRequests = await InterestRequest.find({
        $or: [{ sender: req.user._id }, { receiver: req.user._id }]
      });
      const interestUserIds = interestRequests.map((r) =>
        r.sender.toString() === myUserIdString ? r.receiver : r.sender
      );
      
      // Find shadowbanned users to hide them from the feed
      const User = mongoose.model('User');
      const shadowBannedUsers = await User.find({ isShadowBanned: true }).select('_id');
      const shadowBannedIds = shadowBannedUsers.map(u => u._id);

      const excludedUserIds = [...swipedUserIds, ...interestUserIds, ...shadowBannedIds, req.user._id];

      // 1. Build strict preference query
      const strictQuery: any = {
        user: { $nin: excludedUserIds },
        gender: targetGender,
      };

      const currentYear = new Date().getFullYear();
      const minDob = new Date(currentYear - myProfile.preferences.ageRange.max, 0, 1);
      const maxDob = new Date(currentYear - myProfile.preferences.ageRange.min, 11, 31);
      strictQuery.dob = { $gte: minDob, $lte: maxDob };

      if (myProfile.preferences.locations && myProfile.preferences.locations.length > 0) {
        strictQuery['location.city'] = { $in: myProfile.preferences.locations };
      }

      if (myProfile.preferences.religions && myProfile.preferences.religions.length > 0) {
        strictQuery.religion = { $in: myProfile.preferences.religions };
      }

      let matches = await Profile.find(strictQuery).limit(15);

      // 2. Preference Relaxation: if we got fewer than 10 matches, relax query constraints
      if (matches.length < 10) {
        logger.info(`Strict query returned ${matches.length} matches. Relaxing matchmaking criteria...`);
        const relaxedQuery: any = {
          user: { $nin: excludedUserIds },
          gender: targetGender,
        };

        // Relax age range by +/- 3 years
        const relaxedMinDob = new Date(currentYear - (myProfile.preferences.ageRange.max + 3), 0, 1);
        const relaxedMaxDob = new Date(currentYear - Math.max(18, myProfile.preferences.ageRange.min - 3), 11, 31);
        relaxedQuery.dob = { $gte: relaxedMinDob, $lte: relaxedMaxDob };

        // Instead of strict city filter, allow state-wide or open matches
        if (myProfile.preferences.locations && myProfile.preferences.locations.length > 0) {
          if (myProfile.location?.state) {
            relaxedQuery['location.state'] = myProfile.location.state;
          }
        }

        // Fetch candidates with relaxed criteria
        const relaxedMatches = await Profile.find(relaxedQuery).limit(25);
        
        // Merge without duplicates
        const existingIds = new Set(matches.map(m => m._id.toString()));
        for (const rm of relaxedMatches) {
          if (!existingIds.has(rm._id.toString())) {
            matches.push(rm);
          }
        }
      }

      // 3. Score and rank candidate profiles using MatchmakingService
      const scoredMatches = matches.map((m) => {
        const scoreResult = MatchmakingService.calculateMatchScore(myProfile, m);
        const profileObj = typeof m.toObject === 'function' ? m.toObject() : m;

        // Apply ranking score boosts to candidate profiles
        const isBoosted = m.boost?.isBoosted && m.boost?.boostExpiresAt && new Date(m.boost.boostExpiresAt) > new Date();
        const boostType = isBoosted ? m.boost?.boostType : null;
        let rankScore = scoreResult.score;
        if (isBoosted) {
          if (boostType === 'spotlight') rankScore += 20;
          else if (boostType === 'trending') rankScore += 10;
        }

        return {
          ...profileObj,
          matchScore: scoreResult.score,
          rankScore,
          matchReasons: scoreResult.reasons,
          scoreBreakdown: scoreResult.breakdown
        };
      });

      // Sort by rankScore descending and take top 10
      const topMatches = scoredMatches
        .sort((a, b) => b.rankScore - a.rankScore)
        .slice(0, 10);

      const securedMatches = await Promise.all(
        topMatches.map((m) => secureProfileMedia(m, req.user))
      );

      return sendResponse(res, 200, true, 'Potential matches loaded.', securedMatches);
    } catch (error: any) {
      logger.error(`getPotentialMatches error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch matches.');
    }
  };

  /**
   * Record a swiping action (like or pass)
   */
  static swipeProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetProfileId, action } = req.body; // action: 'liked' | 'passed'
      if (!targetProfileId || !['liked', 'passed'].includes(action)) {
        return sendResponse(res, 400, false, 'Invalid swipe request payloads.');
      }

      if (!mongoose.Types.ObjectId.isValid(targetProfileId)) {
        if (targetProfileId.toString().startsWith('mock-')) {
          if (req.user) {
            clearCachePrefix(`__express__${req.user._id}`);
          }
          // Return mock matching response for developer sandbox testing
          return sendResponse(res, 200, true, `Swipe registered as: ${action} (Sandbox Mode)`, {
            _id: `match-${targetProfileId}`,
            user1: req.user?._id || 'mock-user',
            user2: `user-${targetProfileId}`,
            status: action === 'liked' ? 'matched' : action,
            compatibilityScore: 88,
            aiReasoning: 'AI predicts a premium alignment based on mock preferences in sandbox mode.'
          });
        }
        return sendResponse(res, 400, false, 'Invalid profile ID format.');
      }

      const targetProfile = await Profile.findById(targetProfileId);
      if (!targetProfile) {
        return sendResponse(res, 404, false, 'Target profile not found.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      const myId = req.user._id;
      
      // --- Security: Velocity Tracking & Shadowban ---
      const userDoc = await User.findById(myId);
      if (userDoc) {
        if (userDoc.isShadowBanned) {
           logger.info(`[Security] Shadowbanned user ${myId} attempted swipe. Faking success.`);
           return sendResponse(res, 200, true, `Swipe registered as: ${action}`);
        }
        
        const now = Date.now();
        const velocityWindow = 60 * 1000; // 1 min window
        let count = userDoc.swipeVelocity?.count || 0;
        let windowStart = userDoc.swipeVelocity?.windowStart || new Date();
        
        if (now - new Date(windowStart).getTime() > velocityWindow) {
           count = 1;
           windowStart = new Date(now);
        } else {
           count++;
        }
        
        userDoc.swipeVelocity = { count, windowStart };
        
        if (count > 50) { // 50 swipes a minute is highly anomalous
           userDoc.isShadowBanned = true;
           userDoc.trustScore = Math.max(0, userDoc.trustScore - 70);
           logger.warn(`[Security] User ${myId} exceeded swipe velocity (${count}/min). Shadowbanned.`);
        }
        
        await userDoc.save();

        if (userDoc.isShadowBanned) {
           return sendResponse(res, 200, true, `Swipe registered as: ${action}`);
        }
      }
      // -----------------------------------------------

      const targetUserId = targetProfile.user;

      // Check if match already exists
      const firstId = myId.toString() < targetUserId.toString() ? myId : targetUserId;
      const secondId = myId.toString() < targetUserId.toString() ? targetUserId : myId;

      let match = await Match.findOne({ user1: firstId, user2: secondId });

      if (match) {
        // Match record already exists (the other user swiped first)
        if (action === 'passed') {
          match.status = 'passed';
          match.actionBy = myId;
          await match.save();
        } else if (action === 'liked') {
          if (match.status === 'liked' && match.actionBy && match.actionBy.toString() !== myId.toString()) {
            // Mutual Like!
            match.status = 'matched';
            match.actionBy = myId;

            // Fetch profiles and horoscopes to calculate AI compatibility
            const myProfile = await Profile.findOne({ user: myId });
            const partnerProfile = await Profile.findOne({ user: targetUserId });
            const myHoroscope = await Horoscope.findOne({ user: myId });
            const partnerHoroscope = await Horoscope.findOne({ user: targetUserId });

            if (myProfile && partnerProfile) {
              const aiResult = await AIService.computeCompatibility(
                myProfile,
                partnerProfile,
                myHoroscope || undefined,
                partnerHoroscope || undefined
              );
              match.compatibilityScore = aiResult.score;
              match.aiReasoning = aiResult.reasoning;
            }

            await match.save();
            logger.info(`Mutual Match created between ${myId} and ${targetUserId}`);
            
            // Push notification to both users
            const myName = myProfile?.name || 'Someone';
            const partnerName = partnerProfile?.name || 'Someone';
            FirebaseService.sendMatchNotification(myId.toString(), partnerName, match._id.toString());
            FirebaseService.sendMatchNotification(targetUserId.toString(), myName, match._id.toString());

            return sendResponse(res, 200, true, 'Congratulations! It is a mutual match.', match);
          } else {
            // User likes, but other has not swiped yet (or swiped passed)
            match.status = 'liked';
            match.actionBy = myId;
            await match.save();
          }
        }
      } else {
        // Create new match record
        match = await Match.create({
          user1: firstId,
          user2: secondId,
          status: action,
          actionBy: myId,
        });
      }

      clearCachePrefix(`__express__${myId}`);
      clearCachePrefix(`__express__${targetUserId}`);

      return sendResponse(res, 200, true, `Swipe registered as: ${action}`, match);
    } catch (error: any) {
      logger.error(`swipeProfile error: ${error.message}`);
      return sendResponse(res, 500, false, 'Error registering swipe.');
    }
  };

  /**
   * Send an interest request to a target user
   */
  static sendInterest = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetUserId, message } = req.body;
      if (!targetUserId) {
        return sendResponse(res, 400, false, 'Target user ID is required.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const myId = req.user._id;

      // Validate ObjectIds to prevent CastError with non-MongoDB IDs (e.g., mock IDs)
      if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
        return sendResponse(res, 400, false, 'Invalid target user ID format.');
      }
      if (!mongoose.Types.ObjectId.isValid(myId.toString())) {
        return sendResponse(res, 400, false, 'Invalid authenticated user ID format.');
      }

      if (myId.toString() === targetUserId.toString()) {
        return sendResponse(res, 400, false, 'You cannot send an interest request to yourself.');
      }

      const targetObjectId = new mongoose.Types.ObjectId(targetUserId);

      // Check if target user profile exists
      const targetProfile = await Profile.findOne({ user: targetObjectId });
      if (!targetProfile) {
        return sendResponse(res, 404, false, 'Target profile not found.');
      }

      // Check if request already exists
      const existingRequest = await InterestRequest.findOne({
        sender: myId,
        receiver: targetObjectId
      });

      if (existingRequest) {
        return sendResponse(res, 400, false, 'Interest request already sent to this user.');
      }

      // Create request
      const interestRequest = await InterestRequest.create({
        sender: myId,
        receiver: targetObjectId,
        message: message || undefined,
        status: 'pending'
      });

      // Get sender profile for notification body
      const myProfile = await Profile.findOne({ user: myId });
      const senderName = myProfile?.name || 'A user';

      // Create database in-app notification
      await Notification.create({
        recipient: targetObjectId,
        sender: myId,
        type: 'interest_request',
        title: 'New Interest Request',
        body: `${senderName} is interested in your profile${message ? `: "${message}"` : '.'}`,
        isRead: false
      });

      // Push notification
      FirebaseService.sendToUser(
        targetUserId.toString(),
        'New Interest Request',
        `${senderName} is interested in your profile.`,
        { type: 'interest_request' }
      );

      clearCachePrefix(`__express__${myId}`);
      clearCachePrefix(`__express__${targetUserId}`);

      logger.info(`Interest request sent from ${myId} to ${targetUserId}`);
      return sendResponse(res, 200, true, 'Interest request sent successfully.', interestRequest);
    } catch (error: any) {
      logger.error(`sendInterest error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to send interest request.');
    }
  };

  /**
   * Accept or reject an interest request
   */
  static respondToInterest = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { requestId } = req.params;
      const { action } = req.body; // 'accepted' | 'rejected'

      if (!['accepted', 'rejected'].includes(action)) {
        return sendResponse(res, 400, false, 'Invalid response action.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const myId = req.user._id;

      const interestRequest = await InterestRequest.findById(requestId);
      if (!interestRequest) {
        return sendResponse(res, 404, false, 'Interest request not found.');
      }

      if (interestRequest.receiver.toString() !== myId.toString()) {
        return sendResponse(res, 403, false, 'Not authorized to respond to this request.');
      }

      if (interestRequest.status !== 'pending') {
        return sendResponse(res, 400, false, 'This request has already been processed.');
      }

      interestRequest.status = action as any;
      await interestRequest.save();

      let match = null;

      // Fetch responder profile for notification body
      const myProfile = await Profile.findOne({ user: myId });
      const responderName = myProfile?.name || 'A user';

      if (action === 'accepted') {
        // Create a mutual Match
        const firstId = interestRequest.sender.toString() < myId.toString() ? interestRequest.sender : myId;
        const secondId = interestRequest.sender.toString() < myId.toString() ? myId : interestRequest.sender;

        match = await Match.findOne({ user1: firstId, user2: secondId });

        if (!match) {
          match = new Match({
            user1: firstId,
            user2: secondId,
          });
        }

        match.status = 'matched';
        match.actionBy = myId;

        // Calculate and cache AI compatibility breakdown
        const senderProfile = await Profile.findOne({ user: interestRequest.sender });
        const myHoroscope = await Horoscope.findOne({ user: myId });
        const senderHoroscope = await Horoscope.findOne({ user: interestRequest.sender });

        if (senderProfile && myProfile) {
          const aiResult = await AIService.computeCompatibility(
            senderProfile,
            myProfile,
            senderHoroscope || undefined,
            myHoroscope || undefined
          );
          match.compatibilityScore = aiResult.score;
          match.aiReasoning = aiResult.reasoning;
        }

        await match.save();

        // Notify the original sender
        await Notification.create({
          recipient: interestRequest.sender,
          sender: myId,
          type: 'interest_accept',
          title: 'Interest Request Accepted!',
          body: `${responderName} accepted your interest request. You are now matched!`,
          isRead: false
        });

        // Push Notification
        FirebaseService.sendMatchNotification(interestRequest.sender.toString(), responderName, match._id.toString());

        logger.info(`Interest request accepted. Mutual Match created between ${interestRequest.sender} and ${myId}`);
      }

      clearCachePrefix(`__express__${myId}`);
      clearCachePrefix(`__express__${interestRequest.sender}`);

      return sendResponse(res, 200, true, `Interest request ${action} successfully.`, {
        interestRequest,
        match
      });
    } catch (error: any) {
      logger.error(`respondToInterest error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to respond to interest request.');
    }
  };

  /**
   * Retrieve current user's incoming and outgoing interest request history
   */
  static getInterestHistory = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const myId = req.user._id;

      // Find incoming requests
      const incomingRequests = await InterestRequest.find({ receiver: myId })
        .populate('sender', 'email phone')
        .sort({ createdAt: -1 });

      // Find outgoing requests
      const outgoingRequests = await InterestRequest.find({ sender: myId })
        .populate('receiver', 'email phone')
        .sort({ createdAt: -1 });

      // Fetch matching profile documents to send clean payload containing photos, name, profession, etc.
      const incoming = await Promise.all(
        incomingRequests.map(async (reqItem) => {
          const profile = await Profile.findOne({ user: reqItem.sender });
          const securedProfile = profile ? await secureProfileMedia(profile, req.user) : null;
          return {
            _id: reqItem._id,
            sender: reqItem.sender,
            receiver: reqItem.receiver,
            status: reqItem.status,
            message: reqItem.message,
            createdAt: reqItem.createdAt,
            profile: securedProfile
          };
        })
      );

      const outgoing = await Promise.all(
        outgoingRequests.map(async (reqItem) => {
          const profile = await Profile.findOne({ user: reqItem.receiver });
          const securedProfile = profile ? await secureProfileMedia(profile, req.user) : null;
          return {
            _id: reqItem._id,
            sender: reqItem.sender,
            receiver: reqItem.receiver,
            status: reqItem.status,
            message: reqItem.message,
            createdAt: reqItem.createdAt,
            profile: securedProfile
          };
        })
      );

      return sendResponse(res, 200, true, 'Interest requests history retrieved.', {
        incoming: incoming.filter(i => i.profile !== null),
        outgoing: outgoing.filter(o => o.profile !== null)
      });
    } catch (error: any) {
      logger.error(`getInterestHistory error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch interest requests history.');
    }
  };
}
