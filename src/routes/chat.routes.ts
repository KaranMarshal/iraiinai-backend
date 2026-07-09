import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// List all active conversations for the current user
router.get('/', authenticateUser as any, ChatController.getChats as any);

// Media upload URL + local fallback
router.get('/media-upload-url', authenticateUser as any, ChatController.getMediaUploadUrl as any);
router.post('/media-upload-local', authenticateUser as any, ChatController.uploadMediaLocal as any);

// Delete a single message for both parties (delete-for-everyone)
router.delete('/:matchId/messages/:messageId', authenticateUser as any, ChatController.deleteMessage as any);

// Get message history for a specific match
router.get('/:matchId', authenticateUser as any, ChatController.getChatByMatch as any);

export default router;
