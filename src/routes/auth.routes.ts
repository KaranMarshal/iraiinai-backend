import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthController } from '../controllers/auth.controller';
import { authenticateUser } from '../middleware/auth.middleware';

const router = Router();

// ─── Per-route rate limiters ──────────────────────────────────────────────────

/** 5 email OTP requests per IP per 15 minutes */
const emailOtpRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many OTP requests. Try again in 15 minutes.' },
});

/** 10 verify attempts per IP per 15 minutes */
const emailOtpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many verification attempts. Try again in 15 minutes.' },
});

// ─── Phone OTP ────────────────────────────────────────────────────────────────

router.get('/me', authenticateUser as any, AuthController.getMe as any);
router.post('/request-otp', AuthController.requestOtp as any);
router.post('/verify-otp', AuthController.verifyOtp as any);
router.post('/refresh', AuthController.refreshSession as any);
router.post('/logout', AuthController.logout as any);

// ─── Social Sign-In ───────────────────────────────────────────────────────────

router.post('/social', AuthController.socialSignIn as any);

// ─── Email OTP ────────────────────────────────────────────────────────────────

router.post('/request-email-otp', emailOtpRequestLimiter, AuthController.requestEmailOtp as any);
router.post('/verify-email-otp', emailOtpVerifyLimiter, AuthController.verifyEmailOtp as any);

// ─── Device management ────────────────────────────────────────────────────────

router.get('/devices', authenticateUser as any, AuthController.getDevices as any);
router.post('/devices/fcm-token', authenticateUser as any, AuthController.updateFcmToken as any);
router.delete('/devices/:deviceId', authenticateUser as any, AuthController.revokeDevice as any);

export default router;
