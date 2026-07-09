import { Router } from 'express';
import { authenticateUser } from '../middleware/auth.middleware';
import { BlockController } from '../controllers/block.controller';
import { ReportController } from '../controllers/report.controller';
import { ChatSettingsController } from '../controllers/chatSettings.controller';
import { SafetyAnalysisController } from '../controllers/safetyAnalysis.controller';

const router = Router();

// All safety routes require authentication
router.use(authenticateUser);

// ─── Block ────────────────────────────────────────────────────────────────────
router.post('/block', BlockController.block);
router.delete('/block/:targetId', BlockController.unblock);
router.get('/blocked', BlockController.getBlockedUsers);

// ─── Report ───────────────────────────────────────────────────────────────────
router.post('/report', ReportController.fileReport);
router.get('/reports', ReportController.getMyReports);
router.get('/analysis/:targetUserId', SafetyAnalysisController.getFlagsAnalysis as any);

// ─── Admin ────────────────────────────────────────────────────────────────────
router.get('/admin/reports', ReportController.adminGetReports);
router.patch('/admin/reports/:id', ReportController.adminReviewReport);
router.get('/admin/moderation-logs', ReportController.adminGetModerationLogs);
router.post('/admin/scan-fraud', ReportController.adminRunFraudScan as any);

// ─── Chat Settings ────────────────────────────────────────────────────────────
router.get('/chat-settings/:matchId', ChatSettingsController.getSettings);
router.put('/chat-settings/:matchId', ChatSettingsController.updateSettings);

export default router;
