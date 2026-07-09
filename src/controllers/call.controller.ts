import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { Match } from '../models/Match';
import { CallLog } from '../models/CallLog';
import { AgoraService } from '../services/agora.service';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class CallController {
  /**
   * POST /api/v1/calls/token
   * Generate an Agora RTC token for a matched pair.
   * Body: { matchId: string, callType: 'voice' | 'video' }
   */
  static generateToken = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId, callType } = req.body;

      if (!matchId || !callType) {
        return sendResponse(res, 400, false, 'matchId and callType are required.');
      }
      if (!['voice', 'video'].includes(callType)) {
        return sendResponse(res, 400, false, 'callType must be "voice" or "video".');
      }
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      if (!mongoose.Types.ObjectId.isValid(matchId)) {
        return sendResponse(res, 400, false, 'Invalid matchId format.');
      }

      const myId = req.user._id.toString();

      // Verify this user is a participant in the match and it's a valid mutual match
      const match = await Match.findById(matchId);
      if (!match || match.status !== 'matched') {
        return sendResponse(res, 404, false, 'Valid mutual match not found.');
      }

      const isParticipant =
        match.user1.toString() === myId || match.user2.toString() === myId;
      if (!isParticipant) {
        return sendResponse(res, 403, false, 'You are not a participant in this match.');
      }

      // Generate Agora token — channel name is the matchId
      const { token, channelName, uid, expiresAt } = AgoraService.generateRtcToken(
        matchId,
        myId
      );

      // Create a CallLog entry with status "ongoing"
      const callLog = await CallLog.create({
        caller: myId,
        callee: match.user1.toString() === myId ? match.user2 : match.user1,
        matchId,
        callType,
        status: 'ongoing',
        channelName,
        startedAt: new Date(),
      });

      logger.info(`Call token issued: matchId=${matchId}, callType=${callType}, caller=${myId}`);
      return sendResponse(res, 200, true, 'Agora token generated successfully.', {
        token,
        channelName,
        uid,
        expiresAt,
        callLogId: callLog._id,
        appId: process.env.AGORA_APP_ID || '',
      });
    } catch (error: any) {
      logger.error(`generateToken error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate call token.');
    }
  };

  /**
   * PATCH /api/v1/calls/:callLogId/end
   * Update a call log when the call ends (duration, status)
   * Body: { status: 'answered' | 'missed' | 'declined' | 'failed', durationSeconds?: number }
   */
  static endCall = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { callLogId } = req.params;
      const { status, durationSeconds } = req.body;

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      if (!mongoose.Types.ObjectId.isValid(callLogId)) {
        return sendResponse(res, 400, false, 'Invalid callLogId format.');
      }
      if (!['answered', 'missed', 'declined', 'failed'].includes(status)) {
        return sendResponse(res, 400, false, 'Invalid call status.');
      }

      const callLog = await CallLog.findById(callLogId);
      if (!callLog) {
        return sendResponse(res, 404, false, 'Call log not found.');
      }

      // Verify requester is caller or callee
      const myId = req.user._id.toString();
      const isParticipant =
        callLog.caller.toString() === myId || callLog.callee.toString() === myId;
      if (!isParticipant) {
        return sendResponse(res, 403, false, 'Unauthorized.');
      }

      callLog.status = status;
      callLog.endedAt = new Date();
      if (durationSeconds !== undefined) {
        callLog.durationSeconds = durationSeconds;
      }
      await callLog.save();

      return sendResponse(res, 200, true, 'Call log updated.', callLog);
    } catch (error: any) {
      logger.error(`endCall error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update call log.');
    }
  };

  /**
   * GET /api/v1/calls/history?matchId=xxx
   * Fetch call history for a given match
   */
  static getCallHistory = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.query;
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');
      if (!matchId || !mongoose.Types.ObjectId.isValid(matchId as string)) {
        return sendResponse(res, 400, false, 'Valid matchId is required.');
      }

      const myId = req.user._id.toString();

      // Verify participation
      const match = await Match.findById(matchId);
      if (!match) return sendResponse(res, 404, false, 'Match not found.');
      const isParticipant =
        match.user1.toString() === myId || match.user2.toString() === myId;
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized.');

      const logs = await CallLog.find({ matchId })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return sendResponse(res, 200, true, 'Call history fetched.', logs);
    } catch (error: any) {
      logger.error(`getCallHistory error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch call history.');
    }
  };
}
