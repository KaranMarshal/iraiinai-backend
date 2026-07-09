import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { ChatSettings, MessageExpiryHours } from '../models/ChatSettings';
import { Match } from '../models/Match';
import { Chat } from '../models/Chat';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class ChatSettingsController {
  /**
   * GET /api/v1/safety/chat-settings/:matchId
   * Get safety settings for a specific match/chat.
   * Auto-creates default settings if none exist.
   */
  static getSettings = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');
      const myId = req.user._id.toString();
      const { matchId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(matchId)) {
        return sendResponse(res, 400, false, 'Invalid match ID.');
      }

      // Verify participation
      const match = await Match.findById(matchId).lean();
      if (!match) return sendResponse(res, 404, false, 'Match not found.');
      const isParticipant =
        match.user1.toString() === myId || match.user2.toString() === myId;
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized for this match.');

      let settings = await ChatSettings.findOne({ matchId }).lean();
      if (!settings) {
        settings = await ChatSettings.create({ matchId }) as any;
      }

      return sendResponse(res, 200, true, 'Chat settings retrieved.', settings);
    } catch (err: any) {
      logger.error(`[ChatSettings] getSettings error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve chat settings.');
    }
  };

  /**
   * PUT /api/v1/safety/chat-settings/:matchId
   * Update safety settings for a match. Either participant can update.
   * Body: { mediaEnabled?, linkSharingEnabled?, screenshotProtection?, messageExpiryHours? }
   */
  static updateSettings = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');
      const myId = req.user._id.toString();
      const { matchId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(matchId)) {
        return sendResponse(res, 400, false, 'Invalid match ID.');
      }

      const match = await Match.findById(matchId).lean();
      if (!match) return sendResponse(res, 404, false, 'Match not found.');
      const isParticipant =
        match.user1.toString() === myId || match.user2.toString() === myId;
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized for this match.');

      const { mediaEnabled, linkSharingEnabled, screenshotProtection, messageExpiryHours } = req.body;

      const validExpiry: MessageExpiryHours[] = [0, 24, 168, 720];
      if (messageExpiryHours !== undefined && !validExpiry.includes(messageExpiryHours)) {
        return sendResponse(res, 400, false, 'Invalid messageExpiryHours. Must be 0, 24, 168, or 720.');
      }

      const update: Partial<any> = {};
      if (mediaEnabled !== undefined) update.mediaEnabled = mediaEnabled;
      if (linkSharingEnabled !== undefined) update.linkSharingEnabled = linkSharingEnabled;
      if (screenshotProtection !== undefined) update.screenshotProtection = screenshotProtection;
      if (messageExpiryHours !== undefined) update.messageExpiryHours = messageExpiryHours;

      const settings = await ChatSettings.findOneAndUpdate(
        { matchId },
        { $set: update },
        { new: true, upsert: true }
      );

      logger.info(`[ChatSettings] Match ${matchId} settings updated by ${myId}`);
      return sendResponse(res, 200, true, 'Chat settings updated.', settings);
    } catch (err: any) {
      logger.error(`[ChatSettings] updateSettings error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to update chat settings.');
    }
  };

  /**
   * Delete expired messages across all chats with active expiry settings.
   * Called by a cron-like background job or scheduled task.
   */
  static runExpiryCleanup = async (): Promise<void> => {
    try {
      const activeExpiries = await ChatSettings.find({
        messageExpiryHours: { $gt: 0 },
      }).lean();

      for (const setting of activeExpiries) {
        const cutoff = new Date(
          Date.now() - setting.messageExpiryHours * 60 * 60 * 1000
        );

        const result = await Chat.updateOne(
          { match: setting.matchId },
          { $pull: { messages: { timestamp: { $lt: cutoff } } } }
        );

        if (result.modifiedCount > 0) {
          logger.info(
            `[ChatSettings] Expiry cleanup for match ${setting.matchId}: removed messages older than ${setting.messageExpiryHours}h`
          );
        }

        await ChatSettings.findByIdAndUpdate(setting._id, {
          lastExpiryRunAt: new Date(),
        });
      }
    } catch (err: any) {
      logger.error(`[ChatSettings] runExpiryCleanup error: ${err.message}`);
    }
  };
}

export default ChatSettingsController;
