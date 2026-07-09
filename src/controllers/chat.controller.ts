import { Response } from 'express';
import mongoose from 'mongoose';

import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { Chat } from '../models/Chat';
import { Match } from '../models/Match';
import { Profile } from '../models/Profile';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import { decrypt } from '../utils/crypto';

export class ChatController {
  /**
   * List all conversations for the authenticated user, populated with profile details, unread count, and decrypted last message.
   */
  static getChats = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      const myId = req.user._id;

      // 1. Find all active chats
      const chats = await Chat.find({ participants: myId }).sort({ lastMessageAt: -1 });

      // 2. Find all mutual matches to include "new matches" that don't have message history yet
      const mutualMatches = await Match.find({
        status: 'matched',
        $or: [{ user1: myId }, { user2: myId }]
      });

      const conversationList: any[] = [];
      const processedMatchIds = new Set<string>();

      // A. Process existing chats
      for (const chat of chats) {
        const otherUserId = chat.participants.find(p => p.toString() !== myId.toString());
        if (!otherUserId) continue;

        const otherProfile = await Profile.findOne({ user: otherUserId });
        if (!otherProfile) continue;

        processedMatchIds.add(chat.match.toString());

        // Find last visible message (ignore isHidden messages if not the sender)
        let lastMsgObj = null;
        for (let i = chat.messages.length - 1; i >= 0; i--) {
           const m = chat.messages[i];
           if (!m.isHidden || m.sender.toString() === myId.toString()) {
              lastMsgObj = m;
              break;
           }
        }
        
        const lastMessage = lastMsgObj ? {
          text: lastMsgObj.mediaType && lastMsgObj.mediaType !== 'text' && !lastMsgObj.text
            ? `Sent an ${lastMsgObj.mediaType}`
            : decrypt(lastMsgObj.text),
          timestamp: lastMsgObj.timestamp,
          sender: lastMsgObj.sender,
          mediaType: lastMsgObj.mediaType || 'text',
          mediaUrl: lastMsgObj.mediaUrl || null
        } : null;

        const unreadCount = chat.messages.filter(
          m => m.sender.toString() !== myId.toString() && !m.isRead && !m.isHidden
        ).length;

        conversationList.push({
          chatId: chat._id,
          matchId: chat.match,
          otherUser: {
            id: otherUserId,
            profileId: otherProfile._id,
            name: otherProfile.name,
            photo: otherProfile.photos?.[0] || null,
            occupation: otherProfile.occupation || otherProfile.career?.occupation || 'Professional',
            city: otherProfile.location?.city || 'Location Private',
            isVerified: otherProfile.isVerified
          },
          lastMessage,
          unreadCount
        });
      }

      // B. Process mutual matches with NO active chat history yet
      for (const match of mutualMatches) {
        const matchIdStr = match._id.toString();
        if (processedMatchIds.has(matchIdStr)) continue;

        const otherUserId = match.user1.toString() === myId.toString() ? match.user2 : match.user1;
        const otherProfile = await Profile.findOne({ user: otherUserId });
        if (!otherProfile) continue;

        conversationList.push({
          chatId: null, // Indicates no messages sent yet
          matchId: match._id,
          otherUser: {
            id: otherUserId,
            profileId: otherProfile._id,
            name: otherProfile.name,
            photo: otherProfile.photos?.[0] || null,
            occupation: otherProfile.occupation || otherProfile.career?.occupation || 'Professional',
            city: otherProfile.location?.city || 'Location Private',
            isVerified: otherProfile.isVerified
          },
          lastMessage: null,
          unreadCount: 0
        });
      }

      // Sort chats so that active ones (or most recently updated matches) are first
      conversationList.sort((a, b) => {
        const timeA = a.lastMessage?.timestamp ? new Date(a.lastMessage.timestamp).getTime() : 0;
        const timeB = b.lastMessage?.timestamp ? new Date(b.lastMessage.timestamp).getTime() : 0;
        return timeB - timeA;
      });

      return sendResponse(res, 200, true, 'Conversations loaded successfully.', conversationList);
    } catch (error: any) {
      logger.error(`getChats error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch conversations.');
    }
  };

  /**
   * Load decrypted message history for a specific match. Auto-creates chat document if absent.
   */
  static getChatByMatch = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      const myId = req.user._id;
      const { matchId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(matchId)) {
        return sendResponse(res, 400, false, 'Invalid match ID format.');
      }

      // Find if chat already exists
      let chat = await Chat.findOne({ match: matchId });

      if (!chat) {
        // Chat does not exist. Verify there is a mutual match first before creating
        const match = await Match.findById(matchId);
        if (!match || match.status !== 'matched') {
          return sendResponse(res, 403, false, 'You can only chat with mutual matches.');
        }

        // Verify user is a participant of the match
        if (match.user1.toString() !== myId.toString() && match.user2.toString() !== myId.toString()) {
          return sendResponse(res, 403, false, 'You are not authorized to access this conversation.');
        }

        // Create the chat document
        chat = await Chat.create({
          match: matchId,
          participants: [match.user1, match.user2],
          messages: [],
          lastMessageAt: new Date()
        });
        logger.info(`Chat session created for match: ${matchId}`);
      } else {
        // Verify user is a participant of this existing chat
        const isParticipant = chat.participants.some(p => p.toString() === myId.toString());
        if (!isParticipant) {
          return sendResponse(res, 403, false, 'You are not authorized to access this conversation.');
        }
      }

      // Decrypt messages before returning, hiding shadowbanned ones
      const decryptedMessages = chat.messages
        .filter(msg => !msg.isHidden || msg.sender.toString() === myId.toString())
        .map(msg => ({
          _id: msg._id,
          sender: msg.sender,
          text: decrypt(msg.text),
        mediaUrl: msg.mediaUrl,
        mediaType: msg.mediaType || 'text',
        isRead: msg.isRead,
        timestamp: msg.timestamp
      }));

      return sendResponse(res, 200, true, 'Chat history loaded successfully.', {
        chatId: chat._id,
        matchId: chat.match,
        messages: decryptedMessages
      });
    } catch (error: any) {
      logger.error(`getChatByMatch error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve chat history.');
    }
  };

  /**
   * Generates a signed upload URL for chat media (image, video, audio)
   * or returns a local fallback endpoint if Firebase is mocked.
   */
  static getMediaUploadUrl = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const { type } = req.query;
      if (type !== 'image' && type !== 'video' && type !== 'audio') {
        return sendResponse(res, 400, false, 'Invalid media type. Must be "image", "video" or "audio".');
      }

      const userId = req.user._id.toString();
      let extension = 'jpg';
      let contentType = 'image/jpeg';

      if (type === 'video') {
        extension = 'mp4';
        contentType = 'video/mp4';
      } else if (type === 'audio') {
        extension = 'm4a';
        contentType = 'audio/x-m4a';
      }

      const filename = `chat_${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${extension}`;
      const host = req.get('host') || 'localhost:5000';



      // Local fallback configuration
      const localUploadUrl = `http://${host}/api/v1/chats/media-upload-local`;
      const finalUrlPlaceholder = `http://${host}/uploads/${filename}`;

      return sendResponse(res, 200, true, 'Local upload configuration returned.', {
        uploadUrl: localUploadUrl,
        finalUrl: finalUrlPlaceholder,
        isLocal: true,
        filename,
        contentType
      });
    } catch (error: any) {
      logger.error(`getMediaUploadUrl error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate media upload URL.');
    }
  };

  /**
   * Helper endpoint for saving local mock uploads in development (when Firebase is disabled)
   */
  static uploadMediaLocal = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const { filename, base64 } = req.body;
      if (!filename || !base64) {
        return sendResponse(res, 400, false, 'filename and base64 string are required.');
      }

      const uploadsDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const base64Data = base64.replace(/^data:.*?;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const filePath = path.join(uploadsDir, filename);

      fs.writeFileSync(filePath, buffer);
      logger.info(`Local chat media saved: ${filePath}`);

      return sendResponse(res, 200, true, 'Local media saved successfully.');
    } catch (error: any) {
      logger.error(`uploadMediaLocal error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to save local media.');
    }
  };
  /**
   * DELETE /api/v1/chats/:matchId/messages/:messageId
   * Delete a single message for BOTH participants (delete-for-everyone).
   * Only the message sender can delete it, within 30 minutes of sending.
   */
  static deleteMessage = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');
      const myId = req.user._id.toString();
      const { matchId, messageId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(matchId) || !mongoose.Types.ObjectId.isValid(messageId)) {
        return sendResponse(res, 400, false, 'Invalid ID format.');
      }

      const chat = await Chat.findOne({ match: matchId });
      if (!chat) return sendResponse(res, 404, false, 'Chat not found.');

      const isParticipant = chat.participants.some(p => p.toString() === myId);
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized.');

      const msg = chat.messages.find(m => m._id?.toString() === messageId);
      if (!msg) return sendResponse(res, 404, false, 'Message not found.');

      // Only sender can delete
      if (msg.sender.toString() !== myId) {
        return sendResponse(res, 403, false, 'You can only delete your own messages.');
      }

      // 30-minute deletion window
      const ageMs = Date.now() - new Date(msg.timestamp).getTime();
      if (ageMs > 30 * 60 * 1000) {
        return sendResponse(res, 403, false, 'Messages can only be deleted within 30 minutes of sending.');
      }

      // Remove message from array
      chat.messages = chat.messages.filter(m => m._id?.toString() !== messageId) as any;
      await chat.save();

      // Notify both participants via socket
      try {
        const { SocketService } = await import('../services/socket.service');
        const io = SocketService.getIO();
        io.to(matchId).emit('message_deleted', { matchId, messageId });
      } catch {
        // Socket not critical for REST response
      }

      logger.info(`[Chat] Message ${messageId} deleted by ${myId} from match ${matchId}`);
      return sendResponse(res, 200, true, 'Message deleted for everyone.');
    } catch (err: any) {
      logger.error(`[Chat] deleteMessage error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to delete message.');
    }
  };
}

