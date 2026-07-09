import { Router } from 'express';
import { ReferralController } from '../controllers/referral.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// Apply invite code
router.post('/apply', authenticateUser as any, ReferralController.applyInviteCode as any);

// Get referral analytics
router.get('/analytics', authenticateUser as any, ReferralController.getAnalytics as any);

// Get cashback rewards log
router.get('/rewards', authenticateUser as any, ReferralController.getRewards as any);

// Claim completed cashback rewards
router.post('/rewards/:id/claim', authenticateUser as any, ReferralController.claimReward as any);

export default router;
