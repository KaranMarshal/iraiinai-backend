import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AIService } from '../services/ai.service';
import { Match } from '../models/Match';
import { Profile } from '../models/Profile';
import { Horoscope } from '../models/Horoscope';
import { AIChatSession } from '../models/AIChatSession';
import { AICompatibilityReport } from '../models/AICompatibilityReport';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class AIController {
  /**
   * Endpoint to polish bio text using Gemini
   */
  static polishBio = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { bio } = req.body;
      if (!bio) {
        return sendResponse(res, 400, false, 'No bio content provided for processing.');
      }

      const polishedBio = await AIService.polishBio(bio);
      return sendResponse(res, 200, true, 'Bio polished successfully.', { polishedBio });
    } catch (error: any) {
      logger.error(`polishBio error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to polish bio.');
    }
  };

  /**
   * Endpoint to retrieve compatibility score reasoning
   */
  static getMatchAnalysis = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      
      const match = await Match.findById(matchId);
      if (!match) {
        return sendResponse(res, 404, false, 'Match record not found.');
      }

      // Verify user is part of the match
      const myId = req.user?._id.toString();
      if (match.user1.toString() !== myId && match.user2.toString() !== myId) {
        return sendResponse(res, 403, false, 'Not authorized to view this analysis.');
      }

      // If details are cached in Match schema, return them directly
      if (match.aiReasoning && match.compatibilityScore) {
        try {
          const parsed = JSON.parse(match.aiReasoning);
          if (parsed && typeof parsed === 'object' && parsed.breakdown && parsed.details) {
            return sendResponse(res, 200, true, 'Compatibility details retrieved.', {
              score: parsed.score || match.compatibilityScore,
              reasoning: match.aiReasoning,
              breakdown: parsed.breakdown,
              details: parsed.details,
              summary: parsed.summary || ''
            });
          }
        } catch (e) {
          // If JSON parsing fails (legacy text-only reasoning), fall back
        }

        // Legacy text-only reasoning fallback
        const fallbackBreakdown = {
          personality: match.compatibilityScore,
          emotional: match.compatibilityScore,
          horoscope: match.compatibilityScore,
          interests: match.compatibilityScore
        };
        const fallbackDetails = {
          personality: 'Compatibility based on profile parameters.',
          emotional: 'Emotional compatibility estimate.',
          horoscope: 'Astrological compatibility estimate.',
          interests: 'Shared interest profile.'
        };
        return sendResponse(res, 200, true, 'Compatibility details retrieved.', {
          score: match.compatibilityScore,
          reasoning: match.aiReasoning,
          breakdown: fallbackBreakdown,
          details: fallbackDetails,
          summary: match.aiReasoning
        });
      }

      // Re-trigger calculation if missing
      const profile1 = await Profile.findOne({ user: match.user1 });
      const profile2 = await Profile.findOne({ user: match.user2 });
      const horoscope1 = await Horoscope.findOne({ user: match.user1 });
      const horoscope2 = await Horoscope.findOne({ user: match.user2 });

      if (!profile1 || !profile2) {
        return sendResponse(res, 404, false, 'User profiles for this match are missing.');
      }

      const compatibility = await AIService.computeCompatibility(
        profile1,
        profile2,
        horoscope1 || undefined,
        horoscope2 || undefined
      );
      
      // Save calculation results
      match.compatibilityScore = compatibility.score;
      match.aiReasoning = compatibility.reasoning;
      await match.save();

      return sendResponse(res, 200, true, 'Compatibility details computed.', compatibility);
    } catch (error: any) {
      logger.error(`getMatchAnalysis error: ${error.message}`);
      return sendResponse(res, 500, false, 'Error loading match analysis details.');
    }
  };

  /**
   * Endpoint to generate alternative bio suggestions using Gemini
   */
  /**
   * Generate smart reply suggestions for the last received message
   */
  static suggestBios = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        name,
        gender,
        dob,
        age,
        location,
        occupation,
        interests,
        education,
        career,
        familyDetails
      } = req.body;

      let profilePayload = {
        name,
        gender,
        dob,
        age,
        location,
        occupation,
        interests,
        education,
        career,
        familyDetails
      };

      if (!name || !location) {
        const storedProfile = await Profile.findOne({ user: req.user?._id });
        if (storedProfile) {
          const profileObj = storedProfile.toObject();
          profilePayload = {
            ...profileObj,
            ...profilePayload
          };
        }
      }

      if (!profilePayload.name || !profilePayload.location?.city) {
        return sendResponse(res, 400, false, 'Please fill in Name and City/State to generate personalized suggestions.');
      }

      const suggestions = await AIService.generateBioSuggestions(profilePayload);
      return sendResponse(res, 200, true, 'Bio suggestions generated successfully.', suggestions);
    } catch (error: any) {
      logger.error(`suggestBios error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate bio suggestions.');
    }
  };

  // ─── Conversation AI Endpoints ───────────────────────────────────────────

  /**
   * GET /ai/icebreakers/:matchId
   * Generate personalised icebreaker questions for a new match
   */
  static getIcebreakers = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const myUserId = req.user?._id;

      const match = await Match.findById(matchId);
      if (!match) return sendResponse(res, 404, false, 'Match not found.');

      const isParticipant = match.user1.toString() === myUserId?.toString() ||
        match.user2.toString() === myUserId?.toString();
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized.');

      const theirUserId = match.user1.toString() === myUserId?.toString() ? match.user2 : match.user1;

      const [myProfile, theirProfile] = await Promise.all([
        Profile.findOne({ user: myUserId }),
        Profile.findOne({ user: theirUserId }),
      ]);

      if (!myProfile || !theirProfile) return sendResponse(res, 404, false, 'Profiles not found.');

      const icebreakers = await AIService.generateIcebreakers(myProfile, theirProfile, 5);
      return sendResponse(res, 200, true, 'Icebreakers generated.', { icebreakers });
    } catch (error: any) {
      logger.error(`getIcebreakers error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate icebreakers.');
    }
  };

  /**
   * POST /ai/smart-replies/:matchId
   * Suggest smart replies based on last message + conversation history
   */
  static getSmartReplies = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const { lastMessage, conversationHistory = [] } = req.body;
      const myUserId = req.user?._id;

      if (!lastMessage) return sendResponse(res, 400, false, 'lastMessage is required.');

      const match = await Match.findById(matchId);
      if (!match) return sendResponse(res, 404, false, 'Match not found.');

      const isParticipant = match.user1.toString() === myUserId?.toString() ||
        match.user2.toString() === myUserId?.toString();
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized.');

      const theirUserId = match.user1.toString() === myUserId?.toString() ? match.user2 : match.user1;

      const [myProfile, theirProfile] = await Promise.all([
        Profile.findOne({ user: myUserId }),
        Profile.findOne({ user: theirUserId }),
      ]);

      if (!myProfile || !theirProfile) return sendResponse(res, 404, false, 'Profiles not found.');

      const replies = await AIService.suggestReplies(lastMessage, conversationHistory, myProfile, theirProfile, 3);
      return sendResponse(res, 200, true, 'Smart replies generated.', { replies });
    } catch (error: any) {
      logger.error(`getSmartReplies error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate smart replies.');
    }
  };

  /**
   * POST /ai/conversation-tips/:matchId
   * Get personalised coaching tips based on conversation analysis
   */
  static getConversationTips = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const { conversationHistory = [] } = req.body;
      const myUserId = req.user?._id;

      const match = await Match.findById(matchId);
      if (!match) return sendResponse(res, 404, false, 'Match not found.');

      const isParticipant = match.user1.toString() === myUserId?.toString() ||
        match.user2.toString() === myUserId?.toString();
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized.');

      const theirUserId = match.user1.toString() === myUserId?.toString() ? match.user2 : match.user1;

      const [myProfile, theirProfile] = await Promise.all([
        Profile.findOne({ user: myUserId }),
        Profile.findOne({ user: theirUserId }),
      ]);

      if (!myProfile || !theirProfile) return sendResponse(res, 404, false, 'Profiles not found.');

      const result = await AIService.generateConversationTips(conversationHistory, myProfile, theirProfile);
      return sendResponse(res, 200, true, 'Conversation tips generated.', result);
    } catch (error: any) {
      logger.error(`getConversationTips error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate conversation tips.');
    }
  };

  /**
   * POST /ai/conversation-health/:matchId
   * Analyse conversation momentum, sentiment and depth
   */
  static getConversationHealth = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { matchId } = req.params;
      const { conversationHistory = [] } = req.body;
      const myUserId = req.user?._id;

      const match = await Match.findById(matchId);
      if (!match) return sendResponse(res, 404, false, 'Match not found.');

      const isParticipant = match.user1.toString() === myUserId?.toString() ||
        match.user2.toString() === myUserId?.toString();
      if (!isParticipant) return sendResponse(res, 403, false, 'Unauthorized.');

      const result = await AIService.analyzeConversationHealth(conversationHistory);
      return sendResponse(res, 200, true, 'Conversation health analysed.', result);
    } catch (error: any) {
      logger.error(`getConversationHealth error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to analyse conversation health.');
    }
  };

  /**
   * GET /ai/assistant/history
   * Retrieve previous AI chatbot sessions for the user.
   */
  static getAssistantHistory = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const myUserId = req.user?._id;
      const { matchId } = req.query;

      const query: any = { user: myUserId };
      if (matchId) {
        query.contextMatchId = matchId;
      }

      const sessions = await AIChatSession.find(query).sort({ updatedAt: -1 });
      return sendResponse(res, 200, true, 'AI chat history retrieved.', { sessions });
    } catch (error: any) {
      logger.error(`getAssistantHistory error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve AI chat history.');
    }
  };

  /**
   * POST /ai/assistant/chat
   * Send a message to the AI relationship assistant
   */
  static chatWithAssistant = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { message, matchId, sessionId } = req.body;
      const myUserId = req.user?._id;

      if (!message) {
        return sendResponse(res, 400, false, 'Message is required.');
      }

      const myProfile = await Profile.findOne({ user: myUserId });
      if (!myProfile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      let partnerProfile = undefined;
      let session;

      // Find or create session
      if (sessionId) {
        session = await AIChatSession.findById(sessionId);
        if (session && session.user.toString() !== myUserId?.toString()) {
          return sendResponse(res, 403, false, 'Unauthorized session access.');
        }
      }

      if (!session) {
        session = new AIChatSession({
          user: myUserId,
          contextMatchId: matchId || undefined,
          messages: []
        });
      }

      // Load partner profile if context is tied to a match
      if (session.contextMatchId) {
        const match = await Match.findById(session.contextMatchId);
        if (match) {
          const partnerId = match.user1.toString() === myUserId?.toString() ? match.user2 : match.user1;
          partnerProfile = await Profile.findOne({ user: partnerId });
        }
      }

      // Format history for the service
      const sessionHistory = session.messages.map(m => ({
        role: m.role,
        text: m.text
      }));

      // Append new user message to session
      session.messages.push({
        role: 'user',
        text: message,
        timestamp: new Date()
      } as any);

      // Call AI Service
      const aiResponse = await AIService.chatWithAssistant(message, sessionHistory, myProfile, partnerProfile);

      // Append AI response to session
      session.messages.push({
        role: 'assistant',
        text: aiResponse,
        timestamp: new Date()
      } as any);

      await session.save();

      return sendResponse(res, 200, true, 'Message processed.', {
        sessionId: session._id,
        response: aiResponse,
        timestamp: session.messages[session.messages.length - 1].timestamp
      });
    } catch (error: any) {
      logger.error(`chatWithAssistant error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to process assistant message.');
    }
  };

  /**
   * POST /ai/transcribe
   * Transcribe a base64-encoded audio file using Gemini
   */
  static transcribeAudio = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { audio, mimeType } = req.body;
      if (!audio || !mimeType) {
        return sendResponse(res, 400, false, 'audio (base64 string) and mimeType are required.');
      }

      const text = await AIService.transcribeAudio(audio, mimeType);
      return sendResponse(res, 200, true, 'Audio transcribed successfully.', { text });
    } catch (error: any) {
      logger.error(`transcribeAudio error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to transcribe audio.', error.message);
    }
  };

  /**
   * Endpoint to retrieve compatibility score breakdown between two users
   * GET /api/v1/ai/compatibility/:targetUserId
   */
  static getUserCompatibility = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetUserId } = req.params;
      const myId = req.user?._id.toString();

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      if (myId === targetUserId) {
        return sendResponse(res, 400, false, 'Cannot calculate compatibility with yourself.');
      }

      const myProfile = await Profile.findOne({ user: req.user?._id });
      if (!myProfile) {
        return sendResponse(res, 404, false, 'Your profile was not found.');
      }

      const isPremium = req.user?.subscription && req.user.subscription.status === 'active';
      if (!isPremium) {
        return sendResponse(res, 403, false, 'Detailed AI compatibility analysis is a premium feature.', {
          locked: true
        });
      }

      const targetProfile = await Profile.findOne({ user: targetUserId });
      if (!targetProfile) {
        return sendResponse(res, 404, false, 'Target user profile was not found.');
      }

      let report = await AICompatibilityReport.findOne({
        $or: [
          { user1: myId, user2: targetUserId },
          { user1: targetUserId, user2: myId }
        ]
      });

      if (report) {
        return sendResponse(res, 200, true, 'AI Compatibility report retrieved.', report);
      }

      const horoscope1 = await Horoscope.findOne({ user: myId });
      const horoscope2 = await Horoscope.findOne({ user: targetUserId });

      const compatibility = await AIService.computeCompatibility(
        myProfile,
        targetProfile,
        horoscope1 || undefined,
        horoscope2 || undefined
      );

      let summaryContent = '';
      try {
        summaryContent = compatibility.reasoning ? JSON.parse(compatibility.reasoning).summary || '' : 'AI Matching Analysis completed.';
      } catch (e) {
        summaryContent = compatibility.reasoning || '';
      }

      report = new AICompatibilityReport({
        user1: myId,
        user2: targetUserId,
        overallScore: compatibility.score,
        breakdown: compatibility.breakdown || { demographics: 75, lifestyle: 75, astrology: 75, values: 75 },
        details: compatibility.details || { demographics: '', lifestyle: '', astrology: '', values: '' },
        summary: summaryContent
      });

      await report.save();

      return sendResponse(res, 200, true, 'AI Compatibility report generated successfully.', report);
    } catch (error: any) {
      logger.error(`getUserCompatibility error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve compatibility analysis.', error.message);
    }
  };
}
