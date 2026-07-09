import { Router } from 'express';
import { TimelineController } from '../controllers/timeline.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// Middleware: All timeline routes require authentication
router.use(authenticateUser as any);

router.get('/:matchId', TimelineController.getTimeline as any);
router.patch('/:matchId/stage', TimelineController.updateStage as any);

export default router;
