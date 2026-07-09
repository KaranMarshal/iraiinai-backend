import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { ContentController } from '../controllers/content.controller';
import { authenticateUser, authorizeRoles } from '../middleware/auth.middleware';

const router = Router();

// Middleware: All routes below require Admin role
router.use(authenticateUser as any);
router.use(authorizeRoles('admin') as any);

// Dashboard Statistics
router.get('/stats', AdminController.getDashboardStats as any);

// User Management
router.get('/users', AdminController.getAllUsers as any);
router.patch('/users/:id/status', AdminController.updateUserStatus as any);
router.patch('/users/:id/verify', AdminController.verifyUserProfile as any);
router.patch('/users/:id/reject-verification', AdminController.rejectUserProfileVerification as any);
router.get('/users/:id/activity', AdminController.getUserActivity as any);

// Content Management (CMS)
router.get('/content', ContentController.getAllContent as any);
router.post('/content', ContentController.createContent as any);
router.patch('/content/:id', ContentController.updateContent as any);
router.delete('/content/:id', ContentController.deleteContent as any);

export default router;
