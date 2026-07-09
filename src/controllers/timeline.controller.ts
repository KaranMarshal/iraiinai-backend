import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { WeddingTimeline } from '../models/WeddingTimeline';
import { Match } from '../models/Match';
import { User } from '../models/User';
import { Chat } from '../models/Chat';
import { processAndUploadPhoto } from '../utils/photoProcessor';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class TimelineController {
  /**
   * GET /api/v1/timeline/:matchId
   * Load or initialize the wedding timeline for a match
   */
  static getTimeline = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const myId = req.user?._id;

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const match = await Match.findById(matchId);
      if (!match) {
        return sendResponse(res, 404, false, 'Match not found.');
      }

      // Check if user is part of the match
      if (match.user1.toString() !== myId.toString() && match.user2.toString() !== myId.toString()) {
        return sendResponse(res, 403, false, 'Not authorized to view this timeline.');
      }

      let timeline = await WeddingTimeline.findOne({ matchId });

      if (!timeline) {
        // Fetch users to get registration dates
        const user1 = await User.findById(match.user1);
        const user2 = await User.findById(match.user2);
        
        const regDate = user1 && user2
          ? new Date(Math.min(user1.createdAt.getTime(), user2.createdAt.getTime()))
          : new Date();

        // Check if there is any chat message history
        const chat = await Chat.findOne({ match: matchId });
        const hasMessages = chat && chat.messages && chat.messages.length > 0;
        const firstMessageDate = hasMessages ? chat.messages[0].timestamp : undefined;

        // Initialize stages list
        const initialStages = [
          {
            title: 'Registration',
            stage: 'registration' as const,
            date: regDate,
            completed: true,
            notes: 'Our matrimony profile journeys began on IraiInai.',
            memories: [],
          },
          {
            title: 'Matching Connection',
            stage: 'matching' as const,
            date: match.createdAt,
            completed: true,
            notes: 'A mutual interest connection was created! The spark was ignited.',
            memories: [],
          },
          {
            title: 'First Chat conversation',
            stage: 'chat' as const,
            date: firstMessageDate,
            completed: !!hasMessages,
            notes: hasMessages 
              ? 'Our first conversation began inside the app.' 
              : 'Our first conversation is waiting to happen.',
            memories: [],
          },
          {
            title: 'Family Meeting',
            stage: 'family_meeting' as const,
            completed: false,
            notes: 'Meeting parents and family circles to seek blessings.',
            memories: [],
          },
          {
            title: 'Engagement Ring ceremony',
            stage: 'engagement' as const,
            completed: false,
            notes: 'The promise of a lifetime, finalized in front of loved ones.',
            memories: [],
          },
          {
            title: 'Wedding Celebration',
            stage: 'wedding' as const,
            completed: false,
            notes: 'Two families, two hearts joined forever in holy matrimony.',
            memories: [],
          },
        ];

        timeline = new WeddingTimeline({
          user1: match.user1,
          user2: match.user2,
          matchId,
          stages: initialStages,
        });

        await timeline.save();
      } else {
        // Auto-update chat stage if it was pending but now they chatted
        const chatStage = timeline.stages.find(s => s.stage === 'chat');
        if (chatStage && !chatStage.completed) {
          const chat = await Chat.findOne({ match: matchId });
          if (chat && chat.messages && chat.messages.length > 0) {
            chatStage.completed = true;
            chatStage.date = chat.messages[0].timestamp;
            chatStage.notes = 'Our first conversation began inside the app.';
            await timeline.save();
          }
        }
      }

      return sendResponse(res, 200, true, 'Wedding timeline loaded.', timeline);
    } catch (error: any) {
      logger.error(`getTimeline error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch wedding timeline.');
    }
  };

  /**
   * PATCH /api/v1/timeline/:matchId/stage
   * Update a timeline stage (e.g. check off completion, add notes or memory photos)
   */
  static updateStage = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const { stage, completed, date, notes, memoryBase64 } = req.body;
      const myId = req.user?._id;

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const timeline = await WeddingTimeline.findOne({ matchId });
      if (!timeline) {
        return sendResponse(res, 404, false, 'Timeline not found.');
      }

      // Check if user is part of the match
      if (timeline.user1.toString() !== myId.toString() && timeline.user2.toString() !== myId.toString()) {
        return sendResponse(res, 403, false, 'Not authorized to modify this timeline.');
      }

      const stageItem = timeline.stages.find((s) => s.stage === stage);
      if (!stageItem) {
        return sendResponse(res, 400, false, `Stage ${stage} is invalid.`);
      }

      // Cannot un-complete core system steps
      if (['registration', 'matching'].includes(stage) && completed === false) {
        return sendResponse(res, 400, false, 'Core registration & matching stages cannot be unchecked.');
      }

      if (completed !== undefined) stageItem.completed = !!completed;
      if (date) stageItem.date = new Date(date);
      if (notes !== undefined) stageItem.notes = notes;

      // Handle memory photo upload
      if (memoryBase64) {
        const host = req.get('host') || 'localhost:5000';
        const photoUrl = await processAndUploadPhoto(
          myId.toString(),
          memoryBase64,
          host
        );
        stageItem.memories.push(photoUrl);
      }

      await timeline.save();

      return sendResponse(res, 200, true, `Stage ${stage} updated successfully.`, timeline);
    } catch (error: any) {
      logger.error(`updateStage error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update timeline stage.', error.message);
    }
  };
}
