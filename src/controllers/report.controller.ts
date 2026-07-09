import { Response } from 'express';
import mongoose, { Types } from 'mongoose';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { Report } from '../models/Report';
import { User } from '../models/User';
import { Chat } from '../models/Chat';
import { Match } from '../models/Match';
import { ModerationLog } from '../models/ModerationLog';
import { AIFraudService } from '../services/aiFraud.service';
import { encrypt } from '../utils/crypto';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class ReportController {
  /**
   * POST /api/v1/safety/report
   * File a report against another user. Optionally also blocks them.
   * Body: { targetUserId, matchId?, reason, description?, evidence?, autoBlock? }
   */
  static fileReport = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');

      const myId = req.user._id.toString();
      const { targetUserId, matchId, reason, description, evidence, autoBlock = true } = req.body;

      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return sendResponse(res, 400, false, 'Invalid targetUserId.');
      }
      if (!reason) return sendResponse(res, 400, false, 'Report reason is required.');
      if (targetUserId === myId) return sendResponse(res, 400, false, 'Cannot report yourself.');

      // Prevent duplicate reports within 24h for same reason
      const recentReport = await Report.findOne({
        reporter: myId,
        reportedUser: targetUserId,
        reason,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      });
      if (recentReport) {
        return sendResponse(res, 409, false, 'You have already reported this user for this reason recently.');
      }

      // Determine severity based on reason
      const HIGH_SEVERITY_REASONS = ['sexual_content', 'minor_safety', 'threats_violence'];
      const severity = HIGH_SEVERITY_REASONS.includes(reason) ? 'high' : 'medium';

      // Capture last 10 messages from chat as context (encrypted)
      let chatContext: string | undefined;
      if (matchId && mongoose.Types.ObjectId.isValid(matchId)) {
        try {
          const chat = await Chat.findOne({ match: matchId });
          if (chat) {
            const last10 = chat.messages.slice(-10).map(m => ({
              sender: m.sender.toString(),
              text: m.text.substring(0, 200),
              timestamp: m.timestamp,
            }));
            chatContext = encrypt(JSON.stringify(last10));
          }
        } catch {
          // Non-fatal
        }
      }

      const report = await Report.create({
        reporter: new Types.ObjectId(myId),
        reportedUser: new Types.ObjectId(targetUserId),
        matchId: matchId ? new Types.ObjectId(matchId) : undefined,
        reason,
        description,
        evidence: evidence || [],
        chatContext,
        severity,
        autoFlagged: false,
      });

      // Auto-block if requested
      if (autoBlock) {
        await User.findByIdAndUpdate(myId, {
          $addToSet: { blockedUsers: new Types.ObjectId(targetUserId) },
        });
        // Unmatch
        await Match.updateMany(
          {
            status: 'matched',
            $or: [
              { user1: myId, user2: targetUserId },
              { user1: targetUserId, user2: myId },
            ],
          },
          { $set: { status: 'passed' } }
        );
      }

      logger.info(`[Report] User ${myId} reported ${targetUserId} for "${reason}" (severity: ${severity})`);
      return sendResponse(res, 201, true, 'Report submitted. Our team will review it shortly.', {
        reportId: report._id,
      });
    } catch (err: any) {
      logger.error(`[Report] fileReport error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to submit report.');
    }
  };

  /**
   * GET /api/v1/safety/reports
   * Get the authenticated user's own report history.
   */
  static getMyReports = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) return sendResponse(res, 401, false, 'Unauthorized.');
      const myId = req.user._id.toString();

      const reports = await Report.find({ reporter: myId })
        .sort({ createdAt: -1 })
        .select('-chatContext -evidence')
        .lean();

      return sendResponse(res, 200, true, 'Reports retrieved.', reports);
    } catch (err: any) {
      logger.error(`[Report] getMyReports error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve reports.');
    }
  };

  // ─── Admin Endpoints ────────────────────────────────────────────────────────

  /**
   * GET /api/v1/safety/admin/reports
   * Admin: List all pending/under-review reports with filtering.
   * Query: ?status=pending&severity=high&page=1&limit=20
   */
  static adminGetReports = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return sendResponse(res, 403, false, 'Admin access required.');
      }

      const { status = 'pending', severity, page = 1, limit = 20 } = req.query;
      const filter: any = {};
      if (status) filter.status = status;
      if (severity) filter.severity = severity;

      const skip = (Number(page) - 1) * Number(limit);
      const [reports, total] = await Promise.all([
        Report.find(filter)
          .sort({ severity: -1, createdAt: 1 })
          .skip(skip)
          .limit(Number(limit))
          .populate('reporter', 'email')
          .populate('reportedUser', 'email')
          .lean(),
        Report.countDocuments(filter),
      ]);

      return sendResponse(res, 200, true, 'Reports retrieved.', {
        reports,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      });
    } catch (err: any) {
      logger.error(`[Report] adminGetReports error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve reports.');
    }
  };

  /**
   * PATCH /api/v1/safety/admin/reports/:id
   * Admin: Review and take action on a report.
   * Body: { status, actionTaken, adminNotes }
   */
  static adminReviewReport = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return sendResponse(res, 403, false, 'Admin access required.');
      }

      const { id } = req.params;
      const { status, actionTaken, adminNotes } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return sendResponse(res, 400, false, 'Invalid report ID.');
      }

      const report = await Report.findById(id);
      if (!report) return sendResponse(res, 404, false, 'Report not found.');

      report.status = status || report.status;
      report.actionTaken = actionTaken || report.actionTaken;
      report.adminNotes = adminNotes;
      report.resolvedBy = req.user._id as Types.ObjectId;
      report.resolvedAt = new Date();
      await report.save();

      // Apply action to reported user
      if (actionTaken === 'suspended') {
        await User.findByIdAndUpdate(report.reportedUser, {
          isSuspended: true,
          suspendedAt: new Date(),
          suspendedReason: `Admin action: ${adminNotes || 'Policy violation'}`,
        });
      } else if (actionTaken === 'banned') {
        await User.findByIdAndUpdate(report.reportedUser, {
          isSuspended: true,
          isActive: false,
          suspendedAt: new Date(),
          suspendedReason: `Banned: ${adminNotes || 'Severe policy violation'}`,
        });
      } else if (actionTaken === 'warning') {
        await User.findByIdAndUpdate(report.reportedUser, {
          $inc: { warningCount: 1 },
          lastWarningAt: new Date(),
        });
      }

      logger.info(`[Report] Admin ${req.user._id} reviewed report ${id}: ${actionTaken}`);
      return sendResponse(res, 200, true, 'Report updated successfully.', report);
    } catch (err: any) {
      logger.error(`[Report] adminReviewReport error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to update report.');
    }
  };

  /**
   * GET /api/v1/safety/admin/moderation-logs
   * Admin: List moderation logs for review.
   */
  static adminGetModerationLogs = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return sendResponse(res, 403, false, 'Admin access required.');
      }

      const { severity, action, page = 1, limit = 50 } = req.query;
      const filter: any = {};
      if (severity) filter.severity = severity;
      if (action) filter.action = action;

      const skip = (Number(page) - 1) * Number(limit);
      const [logs, total] = await Promise.all([
        ModerationLog.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(Number(limit))
          .populate('sender', 'email')
          .populate('recipient', 'email')
          .lean(),
        ModerationLog.countDocuments(filter),
      ]);

      return sendResponse(res, 200, true, 'Moderation logs retrieved.', {
        logs,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      });
    } catch (err: any) {
      logger.error(`[Report] adminGetModerationLogs error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve moderation logs.');
    }
  };

  /**
   * POST /api/v1/safety/admin/scan-fraud
   * Admin: Trigger an AI Fraud heuristics scan
   */
  static adminRunFraudScan = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return sendResponse(res, 403, false, 'Admin access required.');
      }

      const flaggedCount = await AIFraudService.scanCluster();

      return sendResponse(res, 200, true, `Scan complete. Flagged ${flaggedCount} suspicious profiles.`);
    } catch (err: any) {
      logger.error(`[Report] adminRunFraudScan error: ${err.message}`);
      return sendResponse(res, 500, false, 'Failed to run fraud scan.');
    }
  };
}

export default ReportController;
