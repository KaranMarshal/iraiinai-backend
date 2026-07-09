import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authenticateUser } from '../middleware/auth.middleware';
import rateLimit from 'express-rate-limit';

const router = Router();

// Fraud Prevention: Rate Limiters
const paymentCheckoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 checkout requests per windowMs
  message: { success: false, message: 'Too many payment attempts from this IP, please try again after 15 minutes.' },
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 webhook requests per minute
  message: 'Too many requests.',
});

// Create payment order
router.post('/checkout', authenticateUser as any, paymentCheckoutLimiter, PaymentController.createSubscriptionOrder as any);

// Create payment subscription
router.post('/subscribe', authenticateUser as any, paymentCheckoutLimiter, PaymentController.createSubscriptionCheckout as any);

// Validate payment tokens
router.post('/verify', authenticateUser as any, PaymentController.verifyPaymentSignature as any);

// Validate coupon promo code
router.post('/coupon/validate', authenticateUser as any, paymentCheckoutLimiter, PaymentController.validateCouponCode as any);

// Webhook endpoint (Public, called by Razorpay servers)
router.post('/webhook', webhookLimiter, PaymentController.handleWebhook as any);

// Cancel active subscription
router.post('/cancel', authenticateUser as any, PaymentController.cancelSubscription as any);

// Get user's billing / transactions history
router.get('/transactions', authenticateUser as any, PaymentController.getTransactions as any);

// Download specific invoice
router.get('/transactions/:id/invoice', authenticateUser as any, PaymentController.downloadInvoice as any);

// Admin: Get transaction reporting
import { authorizeRoles } from '../middleware/auth.middleware';
router.get('/reports', authenticateUser as any, authorizeRoles('admin') as any, PaymentController.getTransactionReport as any);

export default router;
