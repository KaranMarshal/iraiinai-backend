import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Report } from '../models/Report';
import { Chat } from '../models/Chat';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ENV } from '../config/env';

// Initialize Gemini SDK if API key is provided
let genAI: GoogleGenerativeAI | null = null;
if (ENV.GEMINI_API_KEY && ENV.GEMINI_API_KEY !== 'YourGeminiApiKeyHere') {
  genAI = new GoogleGenerativeAI(ENV.GEMINI_API_KEY);
}

export class SafetyAnalysisController {
  /**
   * GET /api/v1/safety/analysis/:targetUserId
   * Fetch Premium Green / Red Flag Analysis for a target user profile
   */
  static getFlagsAnalysis = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { targetUserId } = req.params;
      const myUser = req.user;

      if (!myUser) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      // Check premium status (Gold/Platinum)
      const isPremium = myUser.subscription?.status === 'active' && 
        ['gold', 'platinum'].includes(myUser.subscription?.plan || '');

      if (!isPremium) {
        return sendResponse(res, 200, true, 'Upgrade to Premium to access.', {
          premiumLocked: true,
        });
      }

      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        return sendResponse(res, 404, false, 'User not found.');
      }

      const profile = await Profile.findOne({ user: targetUserId });
      if (!profile) {
        return sendResponse(res, 404, false, 'Profile not found.');
      }

      // Fetch report count
      const reportsCount = await Report.countDocuments({ reportedUser: targetUserId });

      // Heuristic checks for fallback
      const trustScore = 100 - (profile.riskScore || 0);
      const isVerified = profile.isVerified || profile.verificationStatus === 'approved';
      const hasGoodBio = profile.bio && profile.bio.length > 25;
      const hasMultiplePhotos = profile.photos && profile.photos.length >= 2;
      const hasCareer = !!(profile.career?.occupation || profile.occupation);

      if (!genAI) {
        // Fallback rule-based analysis if Gemini is not set up
        const greenFlags: string[] = [];
        const redFlags: string[] = [];

        if (isVerified) greenFlags.push('Identity Verified Profile (Govt ID Check Approved)');
        if (hasGoodBio) greenFlags.push('Comprehensive biography details provided');
        if (hasMultiplePhotos) greenFlags.push('Multiple user photos uploaded');
        if (hasCareer) greenFlags.push('Profession and educational fields completed');
        if (reportsCount === 0) greenFlags.push('Clean safety record (No reports filed)');

        if (profile.riskScore && profile.riskScore >= 40) redFlags.push('High system security risk triggers matched');
        if (reportsCount > 0) redFlags.push(`Flagged by other members (Received ${reportsCount} reports)`);
        if (!hasGoodBio) redFlags.push('Extremely brief or empty biography description');
        if (!hasMultiplePhotos) redFlags.push('Only one or zero photos uploaded');
        if (targetUser.swipeVelocity?.count && targetUser.swipeVelocity.count > 30) {
          redFlags.push('Suspicious swipe rate velocity (Potential automation)');
        }

        let trustCategory: 'high_trust' | 'moderate' | 'needs_caution' = 'moderate';
        if (trustScore >= 80 && redFlags.length === 0) trustCategory = 'high_trust';
        else if (trustScore < 50 || redFlags.length >= 2) trustCategory = 'needs_caution';

        const aiSummary = trustCategory === 'high_trust'
          ? `${profile.name} exhibits excellent trust markers. They have completed identity verification and maintain a fully detailed profile with no warnings.`
          : trustCategory === 'needs_caution'
          ? `Caution is advised. ${profile.name} has triggered multiple system safety warnings, such as low profile completeness or report files.`
          : `${profile.name} is a moderately trusted profile. Consider connecting further to verify details in chat before meeting.`;

        return sendResponse(res, 200, true, 'Safety analysis loaded.', {
          premiumLocked: false,
          trustScore,
          trustCategory,
          greenFlags,
          redFlags,
          aiSummary,
        });
      }

      // Generate AI-synthesized flags using Gemini
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
        You are an elite safety analyst for IraiInai Matrimony.
        Analyze the trust profile of target user "${profile.name}" based on the following security parameters:
        
        - Profile Completeness: Bio length is ${profile.bio?.length || 0} characters. Number of photos uploaded: ${profile.photos?.length || 0}. Occupation: ${profile.career?.occupation || profile.occupation || 'Not listed'}.
        - Verification Status: Government ID verified: ${isVerified ? 'Yes' : 'No'}. Verification Status: ${profile.verificationStatus || 'none'}.
        - Activity Metrics: Swipe rate count in recent window: ${targetUser.swipeVelocity?.count || 0}.
        - Report History: Number of safety reports filed against this user by other members: ${reportsCount}.
        - Security Risk Rating: Cached system risk score: ${profile.riskScore || 0}% (higher means more risk).
        
        Based on these metrics, generate:
        1. A list of 2 to 4 "Green Flags" (positive credibility indicators, e.g. ID verified, comprehensive details, clean record).
        2. A list of "Red Flags" (negative warning indicators, e.g. lack of photos, rapid swiping, report history, high system risk score, empty bio). If there are none, return an empty array.
        3. An overall safety trust category: "high_trust" (Trust Score > 80, no major warnings), "moderate" (Trust Score 50-80, minor issues), or "needs_caution" (Trust Score < 50, critical indicators/reports).
        4. A concise safety summary overview (under 50 words) explaining your findings.
        
        Return a JSON response in this strict format:
        {
          "trustScore": ${trustScore},
          "trustCategory": "high_trust" | "moderate" | "needs_caution",
          "greenFlags": ["Flag 1", "Flag 2", ...],
          "redFlags": ["Flag 1", "Flag 2", ...],
          "aiSummary": "Summary statement..."
        }
      `;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });

      const cleanJson = result.response.text().trim().replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return sendResponse(res, 200, true, 'Safety analysis loaded.', {
        premiumLocked: false,
        trustScore: parsed.trustScore !== undefined ? parsed.trustScore : trustScore,
        trustCategory: parsed.trustCategory || 'moderate',
        greenFlags: parsed.greenFlags || [],
        redFlags: parsed.redFlags || [],
        aiSummary: parsed.aiSummary || '',
      });

    } catch (error: any) {
      logger.error(`getFlagsAnalysis error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate flags analysis.');
    }
  };
}
