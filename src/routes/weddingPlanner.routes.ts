import { Router } from 'express';
import { WeddingPlannerController } from '../controllers/weddingPlanner.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// Middleware: Require user authentication for all wedding planner endpoints
router.use(authenticateUser as any);

router.get('/:matchId', WeddingPlannerController.getPlanner as any);
router.put('/:matchId', WeddingPlannerController.updatePlanner as any);

export default router;
