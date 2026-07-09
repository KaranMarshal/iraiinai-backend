import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticateUser, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

// FCM token registration for device session
router.post('/token', authenticateUser as any, NotificationController.registerToken as any);

// In-app notifications history endpoints
router.get('/', authenticateUser as any, NotificationController.getNotifications as any);
router.patch('/read-all', authenticateUser as any, NotificationController.markAllRead as any);
router.patch('/:id/read', authenticateUser as any, NotificationController.markRead as any);

// Admin promotional broadcast and campaigns
router.post('/admin/broadcast', authenticateUser as any, requireAdmin as any, NotificationController.broadcastNotification as any);
router.get('/admin/campaigns', authenticateUser as any, requireAdmin as any, NotificationController.getCampaigns as any);
router.delete('/admin/campaigns/:id', authenticateUser as any, requireAdmin as any, NotificationController.cancelCampaign as any);

export default router;
