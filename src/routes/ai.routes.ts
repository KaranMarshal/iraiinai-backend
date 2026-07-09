import { Router } from 'express';
import { AIController } from '../controllers/ai.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// Polish raw biography draft using Gemini
router.post('/polish-bio', authenticateUser as any, AIController.polishBio as any);

// Transcribe raw audio to text using Gemini
router.post('/transcribe', authenticateUser as any, AIController.transcribeAudio as any);

// Generate bio suggestions based on user facts using Gemini
router.post('/suggest-bios', authenticateUser as any, AIController.suggestBios as any);

// Request compatibility analysis for matches
router.get('/analysis/:matchId', authenticateUser as any, AIController.getMatchAnalysis as any);
router.get('/compatibility/:targetUserId', authenticateUser as any, AIController.getUserCompatibility as any);

// Conversation AI endpoints
router.get('/icebreakers/:matchId', authenticateUser as any, AIController.getIcebreakers as any);
router.post('/smart-replies/:matchId', authenticateUser as any, AIController.getSmartReplies as any);
router.post('/conversation-tips/:matchId', authenticateUser as any, AIController.getConversationTips as any);
router.post('/conversation-health/:matchId', authenticateUser as any, AIController.getConversationHealth as any);

// AI Relationship Assistant (Chatbot)
router.get('/assistant/history', authenticateUser as any, AIController.getAssistantHistory as any);
router.post('/assistant/chat', authenticateUser as any, AIController.chatWithAssistant as any);

export default router;
