import { Router } from 'express';
import { MatchController } from '../controllers/match.controller';
import { authenticateUser } from '../middleware/auth.middleware';
import { cacheMiddleware } from '../middleware/cache.middleware';

const router = Router();

// Load discovery stack profiles
router.get('/discovery', authenticateUser as any, cacheMiddleware(60) as any, MatchController.getPotentialMatches as any);

// Register card swipes (like/pass)
router.post('/swipe', authenticateUser as any, MatchController.swipeProfile as any);

// Interest request system
router.post('/interest/send', authenticateUser as any, MatchController.sendInterest as any);
router.post('/interest/:requestId/respond', authenticateUser as any, MatchController.respondToInterest as any);
router.get('/interest/history', authenticateUser as any, MatchController.getInterestHistory as any);

export default router;
