import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { CompatibilityQuizAnswer } from '../models/CompatibilityQuizAnswer';
import { Profile } from '../models/Profile';
import { User } from '../models/User';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';

// Initialize Gemini SDK if API key is provided
let genAI: GoogleGenerativeAI | null = null;
if (ENV.GEMINI_API_KEY && ENV.GEMINI_API_KEY !== 'YourGeminiApiKeyHere') {
  genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
}

const QUIZ_QUESTIONS = [
  {
    id: 'lifestyle_1',
    category: 'lifestyle' as const,
    questionText: 'What does your ideal weekend look like?',
    options: [
      { key: 'A', label: 'Cozying up at home with a book or movie' },
      { key: 'B', label: 'Going out with family or friends' },
      { key: 'C', label: 'Exploring outdoors, traveling, or trekking' },
      { key: 'D', label: 'Working on side projects or learning new skills' },
    ],
  },
  {
    id: 'lifestyle_2',
    category: 'lifestyle' as const,
    questionText: 'How do you prefer to manage household finances?',
    options: [
      { key: 'A', label: 'Joint accounts for everything' },
      { key: 'B', label: 'Splitting expenses proportionally based on income' },
      { key: 'C', label: 'Completely separate accounts with mutual bill sharing' },
      { key: 'D', label: 'One person managing it with full transparency' },
    ],
  },
  {
    id: 'personality_1',
    category: 'personality' as const,
    questionText: 'How do you recharge your social battery?',
    options: [
      { key: 'A', label: 'Quiet time alone (Introverted recharge)' },
      { key: 'B', label: 'Socializing in group gatherings (Extroverted energy)' },
      { key: 'C', label: 'One-on-one deep conversations with a close person' },
      { key: 'D', label: 'Engaging in active hobbies, sports, or workouts' },
    ],
  },
  {
    id: 'personality_2',
    category: 'personality' as const,
    questionText: 'How do you approach important life decisions?',
    options: [
      { key: 'A', label: 'Detailed analysis, list of pros/cons (Logical)' },
      { key: 'B', label: 'Trusting my intuition and gut feelings (Intuitive)' },
      { key: 'C', label: 'Empathy-driven, consulting family and loved ones' },
      { key: 'D', label: 'Taking spontaneous, quick action' },
    ],
  },
  {
    id: 'values_1',
    category: 'values' as const,
    questionText: 'What is the most crucial pillar in your family system?',
    options: [
      { key: 'A', label: 'Deep respect for traditions, rituals, and elders' },
      { key: 'B', label: 'Equal partnership and shared household duties' },
      { key: 'C', label: 'Independence, giving each other personal space' },
      { key: 'D', label: 'Continuous self-growth and learning together' },
    ],
  },
  {
    id: 'values_2',
    category: 'values' as const,
    questionText: 'How do you prefer to handle arguments or disagreements?',
    options: [
      { key: 'A', label: 'Talk it out immediately to clear the air' },
      { key: 'B', label: 'Take some space to cool down before discussing' },
      { key: 'C', label: 'Consult family elders or a neutral third party' },
      { key: 'D', label: 'Let it pass silently and move forward' },
    ],
  },
  {
    id: 'goals_1',
    category: 'goals' as const,
    questionText: 'What is your long-term career vs. family vision?',
    options: [
      { key: 'A', label: 'Prioritizing career progression and ambition' },
      { key: 'B', label: 'Balancing career progression equally with family time' },
      { key: 'C', label: 'Family is the absolute center of my life decisions' },
      { key: 'D', label: 'Flexible, adapting to the needs of the moment' },
    ],
  },
  {
    id: 'goals_2',
    category: 'goals' as const,
    questionText: 'How do you view relocating for new job opportunities?',
    options: [
      { key: 'A', label: 'Completely open to moving anywhere globally' },
      { key: 'B', label: 'Prefer staying close to home and family circles' },
      { key: 'C', label: 'Open to relocating only within South India / Tamil Nadu' },
      { key: 'D', label: 'Strongly prefer not to relocate' },
    ],
  },
];

export class QuizController {
  /**
   * GET /api/v1/quiz/questions
   * Fetch list of standard compatibility quiz questions
   */
  static getQuestions = async (req: AuthenticatedRequest, res: Response) => {
    return sendResponse(res, 200, true, 'Quiz questions fetched.', QUIZ_QUESTIONS);
  };

  /**
   * POST /api/v1/quiz/answers
   * Save or update user quiz answers
   */
  static saveAnswers = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { responses } = req.body;
      const myId = req.user?._id;

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      if (!responses || !Array.isArray(responses) || responses.length === 0) {
        return sendResponse(res, 400, false, 'Quiz responses are required.');
      }

      const quizRecord = await CompatibilityQuizAnswer.findOneAndUpdate(
        { user: myId },
        { responses },
        { upsert: true, new: true }
      );

      logger.info(`Compatibility Quiz responses saved for user: ${myId}`);
      return sendResponse(res, 200, true, 'Quiz answers saved successfully.', quizRecord);
    } catch (error: any) {
      logger.error(`saveAnswers error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to save quiz answers.');
    }
  };

  /**
   * GET /api/v1/quiz/answers/me
   * Fetch current user's quiz responses
   */
  static getMyAnswers = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const myId = req.user?._id;
      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const answers = await CompatibilityQuizAnswer.findOne({ user: myId });
      return sendResponse(res, 200, true, 'Quiz answers fetched.', answers || { responses: [] });
    } catch (error: any) {
      logger.error(`getMyAnswers error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch my quiz answers.');
    }
  };

  /**
   * GET /api/v1/quiz/report/:targetUserId
   * Fetch comparison report of quiz answers between current and target user
   */
  static getQuizReport = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetUserId } = req.params;
      const myId = req.user?._id;

      if (!myId) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const [myAnswers, theirAnswers, myProfile, theirProfile] = await Promise.all([
        CompatibilityQuizAnswer.findOne({ user: myId }),
        CompatibilityQuizAnswer.findOne({ user: targetUserId }),
        Profile.findOne({ user: myId }),
        Profile.findOne({ user: targetUserId }),
      ]);

      if (!myProfile || !theirProfile) {
        return sendResponse(res, 404, false, 'Profiles not found.');
      }

      const myCompleted = !!(myAnswers && myAnswers.responses && myAnswers.responses.length >= 6);
      const theirCompleted = !!(theirAnswers && theirAnswers.responses && theirAnswers.responses.length >= 6);

      if (!myCompleted || !theirCompleted) {
        return sendResponse(res, 200, true, 'Quiz report not available yet.', {
          completed: false,
          myCompleted,
          theirCompleted,
        });
      }

      const myResp = myAnswers!.responses;
      const theirResp = theirAnswers!.responses;

      if (!genAI) {
        // Fallback rule-based scoring comparison
        let totalMatches = 0;
        let categoryScores = { lifestyle: 70, personality: 70, values: 70, goals: 70 };
        const highlights: string[] = [];
        const challenges: string[] = [];

        // Check each matching question
        myResp.forEach((myR) => {
          const theirR = theirResp.find((tr) => tr.questionId === myR.questionId);
          if (theirR) {
            if (myR.selectedOption === theirR.selectedOption) {
              totalMatches++;
              highlights.push(`Shared viewpoint: "${myR.optionLabel}" on Q: "${myR.questionText}"`);
            } else {
              challenges.push(`Alignment opportunity: ${myProfile.name} selected "${myR.optionLabel}" whereas ${theirProfile.name} prefers "${theirR.optionLabel}"`);
            }
          }
        });

        const overallScore = Math.round(50 + (totalMatches / Math.max(1, myResp.length)) * 50);
        categoryScores.lifestyle = overallScore - 5 > 100 ? 100 : overallScore - 5;
        categoryScores.personality = overallScore + 5 > 100 ? 100 : overallScore + 5;
        categoryScores.values = overallScore;
        categoryScores.goals = overallScore - 2;

        return sendResponse(res, 200, true, 'Quiz report generated (fallback mode).', {
          completed: true,
          overallScore,
          categoryScores,
          highlights: highlights.slice(0, 3),
          challenges: challenges.slice(0, 2),
          aiSummary: `${myProfile.name} and ${theirProfile.name} show an overall compatibility score of ${overallScore}%. They share strong alignment in key matrimonial topics, but should connect further in chat to align on different perspectives.`,
        });
      }

      // Generate deep comparison insights using Gemini
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        You are a relationship and marriage coach for IraiInai, a premium matrimony app.
        Compare the quiz responses of two users, ${myProfile.name} and ${theirProfile.name}, and generate a compatibility report.
        
        ${myProfile.name}'s Responses:
        ${myResp.map((r) => `- Category: ${r.category}, Question: "${r.questionText}", Selected: "${r.optionLabel}"`).join('\n')}
        
        ${theirProfile.name}'s Responses:
        ${theirResp.map((r) => `- Category: ${r.category}, Question: "${r.questionText}", Selected: "${r.optionLabel}"`).join('\n')}
        
        Rules:
        1. Calculate category scores (lifestyle, personality, values, goals) from 0 to 100.
        2. Calculate an overall average score from 0 to 100.
        3. Identify 2 to 3 "highlights" (where their options align or complement each other).
        4. Identify 1 to 2 "challenges" (where options represent potential differences that need discussion).
        5. Write a friendly, qualitative aiSummary (under 60 words) explaining their quiz alignment.
        
        Return a strict JSON response matching this schema:
        {
          "overallScore": number,
          "categoryScores": {
            "lifestyle": number,
            "personality": number,
            "values": number,
            "goals": number
          },
          "highlights": ["string", "string", ...],
          "challenges": ["string", "string", ...],
          "aiSummary": "string"
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const cleanJson = result.response.text().trim().replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return sendResponse(res, 200, true, 'Quiz report generated successfully.', {
        completed: true,
        ...parsed,
      });

    } catch (error: any) {
      logger.error(`getQuizReport error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to compare quiz answers.');
    }
  };
}
