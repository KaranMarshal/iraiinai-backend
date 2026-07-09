/**
 * ModerationService — Real-time pattern-based message scanning.
 *
 * Runs synchronously on every incoming `send_message` socket event before
 * the message is persisted to the database.
 *
 * Severity levels:
 *   high   → message is BLOCKED, sender notified, ModerationLog created
 *   medium → message delivered, ModerationLog created for admin review
 *   low    → message delivered, silently logged
 *   safe   → message delivered, nothing logged
 */

import { logger } from '../utils/logger';
import { ModerationLog } from '../models/ModerationLog';
import { User } from '../models/User';
import { Types } from 'mongoose';

// ─── Rule Sets ───────────────────────────────────────────────────────────────

interface ModerationRule {
  id: string;
  severity: 'low' | 'medium' | 'high';
  pattern: RegExp;
  description: string;
}

const RULES: ModerationRule[] = [
  // HIGH — immediately blocked
  {
    id: 'phone_number',
    severity: 'high',
    pattern: /(\+91|0)?[\s\-.]?[6-9]\d{9}|\b(\d[\s\-.]?){10,11}\b/g,
    description: 'Sharing phone numbers',
  },
  {
    id: 'email_address',
    severity: 'high',
    pattern: /[a-zA-Z0-9._%+\-]+\s*[@＠]\s*[a-zA-Z0-9.\-]+\s*\.\s*[a-zA-Z]{2,}/g,
    description: 'Sharing email addresses',
  },
  {
    id: 'whatsapp_handle',
    severity: 'high',
    pattern: /\bwhatsapp\b|\bwa\.me\/\d/gi,
    description: 'Sharing WhatsApp contact',
  },
  {
    id: 'instagram_handle',
    severity: 'high',
    pattern: /\binstagram\.com\/\w|\binsta\s*:\s*@\w|\b@[a-z0-9_]{3,30}\s+(on\s+)?insta/gi,
    description: 'Sharing Instagram handle',
  },
  {
    id: 'social_handle',
    severity: 'high',
    pattern: /\b(snapchat|telegram|skype|linkedin|facebook|twitter|tiktok)\s*[:/]?\s*[a-z0-9_.]{2,}/gi,
    description: 'Sharing social media handle',
  },
  {
    id: 'explicit_content',
    severity: 'high',
    pattern: /\b(nude|naked|sex|porn|boobs|dick|pussy|cock|fuck|vagina|penis|masturbat|orgasm|horny)\b/gi,
    description: 'Explicit sexual content',
  },
  {
    id: 'threats_violence',
    severity: 'high',
    pattern: /\b(i('ll| will) (kill|hurt|find|track|rape)|come to your (house|home|address)|i know where you|you('ll| will) regret)\b/gi,
    description: 'Threats or violence',
  },

  // MEDIUM — delivered but flagged for review
  {
    id: 'personal_info_hint',
    severity: 'medium',
    pattern: /\b(my number|call me at|text me on|my address|where i live|meet me at|i('ll| will) send my|add me on)\b/gi,
    description: 'Attempting to share personal contact info',
  },
  {
    id: 'financial_request',
    severity: 'medium',
    pattern: /\b(send money|transfer (rs|rupees|\$|₹)|gpay|phonepay|paytm|upi|bank account|need money|emergency money)\b/gi,
    description: 'Financial solicitation or scam',
  },
  {
    id: 'url_sharing',
    severity: 'medium',
    pattern: /https?:\/\/[^\s]+|www\.[a-z0-9\-]{2,}\.[a-z]{2,}/gi,
    description: 'External URL shared',
  },

  // LOW — silently noted
  {
    id: 'mild_profanity',
    severity: 'low',
    pattern: /\b(damn|shit|ass|crap|bastard|idiot|stupid)\b/gi,
    description: 'Mild profanity',
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScanResult {
  safe: boolean;
  severity: 'safe' | 'low' | 'medium' | 'high';
  flags: string[];
  flagDescriptions: string[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class ModerationService {
  /**
   * Scan a message text against all rule patterns.
   * Returns a ScanResult — does NOT save to DB (caller must do that).
   */
  static scan(text: string): ScanResult {
    if (!text || text.trim().length === 0) {
      return { safe: true, severity: 'safe', flags: [], flagDescriptions: [] };
    }

    const triggeredFlags: string[] = [];
    const triggeredDescriptions: string[] = [];
    let maxSeverity: 'safe' | 'low' | 'medium' | 'high' = 'safe';

    const severityRank = { safe: 0, low: 1, medium: 2, high: 3 };

    for (const rule of RULES) {
      if (rule.pattern.test(text)) {
        triggeredFlags.push(rule.id);
        triggeredDescriptions.push(rule.description);
        if (severityRank[rule.severity] > severityRank[maxSeverity]) {
          maxSeverity = rule.severity;
        }
      }
      // Reset lastIndex for global regexes
      rule.pattern.lastIndex = 0;
    }

    const isSafe = triggeredFlags.length === 0;
    return {
      safe: isSafe,
      severity: maxSeverity,
      flags: triggeredFlags,
      flagDescriptions: triggeredDescriptions,
    };
  }

  /**
   * Persist a moderation log entry. Text is redacted for HIGH severity.
   */
  static async log(
    senderId: string,
    recipientId: string,
    matchId: string,
    messageText: string,
    result: ScanResult,
    action: 'blocked' | 'delivered' | 'delivered_flagged'
  ): Promise<void> {
    try {
      const storedText = result.severity === 'high' ? '[REDACTED — HIGH SEVERITY]' : messageText.substring(0, 500);
      await ModerationLog.create({
        sender: new Types.ObjectId(senderId),
        recipient: new Types.ObjectId(recipientId),
        matchId: new Types.ObjectId(matchId),
        messageText: storedText,
        flags: result.flags,
        severity: result.severity,
        action,
      });
    } catch (err: any) {
      logger.error(`[Moderation] Failed to save log: ${err.message}`);
    }
  }

  /**
   * Increment the sender's warning count. If threshold exceeded, set isSuspended.
   */
  static async applyWarning(
    userId: string,
    severity: 'low' | 'medium' | 'high'
  ): Promise<void> {
    try {
      const INCREMENT = severity === 'high' ? 3 : severity === 'medium' ? 1 : 0;
      if (INCREMENT === 0) return;

      const user = await User.findById(userId);
      if (!user) return;

      user.warningCount = (user.warningCount || 0) + INCREMENT;
      user.lastWarningAt = new Date();

      // Auto-suspend after 9 high-severity points (3 high violations or 9 medium)
      if (user.warningCount >= 9 && !user.isSuspended) {
        user.isSuspended = true;
        user.suspendedAt = new Date();
        user.suspendedReason = 'Automatic suspension: repeated safety violations detected.';
        logger.warn(`[Moderation] User ${userId} auto-suspended after ${user.warningCount} warning points.`);
      }

      await user.save();
    } catch (err: any) {
      logger.error(`[Moderation] applyWarning error: ${err.message}`);
    }
  }

  /**
   * Strip URLs from message text (used when linkSharingEnabled=false).
   */
  static stripLinks(text: string): string {
    return text.replace(/https?:\/\/[^\s]+|www\.[a-z0-9\-]{2,}\.[a-z]{2,}/gi, '[link removed]');
  }

  /**
   * Check if a user is blocked by another user.
   * Returns true if userA has blocked userB OR userB has blocked userA.
   */
  static async isBlocked(userAId: string, userBId: string): Promise<boolean> {
    try {
      const userA = await User.findById(userAId).select('blockedUsers').lean();
      const userB = await User.findById(userBId).select('blockedUsers').lean();

      const aBlockedB = userA?.blockedUsers?.some(id => id.toString() === userBId) ?? false;
      const bBlockedA = userB?.blockedUsers?.some(id => id.toString() === userAId) ?? false;

      return aBlockedB || bBlockedA;
    } catch {
      return false;
    }
  }
}

export default ModerationService;
