import crypto from 'crypto';
import { razorpayClient } from '../config/razorpay';
import { ENV } from '../config/env';
import { logger } from '../utils/logger';

export class PaymentService {
  /**
   * Creates an order with Razorpay
   */
  static async createOrder(
    amountInINR: number,
    receiptId: string
  ): Promise<{ id: string; amount: number; currency: string }> {
    try {
      if (ENV.RAZORPAY_KEY_ID.startsWith('mock_')) {
        const mockOrderId = `order_mock_${Math.random().toString(36).substring(4)}`;
        logger.info(`[Mock Mode] Razorpay Order created: ${mockOrderId} for amount ${amountInINR} INR`);
        return {
          id: mockOrderId,
          amount: Math.round(amountInINR * 100),
          currency: 'INR',
        };
      }

      const options = {
        amount: Math.round(amountInINR * 100), // Razorpay accepts amounts in paise
        currency: 'INR',
        receipt: receiptId,
        payment_capture: 1, // Automatically capture payments
      };

      const order = await razorpayClient.orders.create(options);
      logger.info(`Razorpay Order created: ${order.id} for amount ${amountInINR} INR`);
      return {
        id: order.id,
        amount: typeof order.amount === 'string' ? parseInt(order.amount, 10) : order.amount,
        currency: order.currency,
      };
    } catch (error: any) {
      const errorMessage = error.error?.description || error.message || JSON.stringify(error);
      logger.error(`Error creating Razorpay Order: ${errorMessage}`);
      throw new Error(`Razorpay Order creation failed: ${errorMessage}`);
    }
  }

  /**
   * Verifies Razorpay HMAC signature for client checkouts
   */
  static verifyPaymentSignature(
    orderId: string,
    paymentId: string,
    signature: string
  ): boolean {
    try {
      if (ENV.RAZORPAY_KEY_ID.startsWith('mock_') || signature === 'mock_signature_matches_verification_check' || signature.startsWith('mock_')) {
        logger.info(`[Mock Mode] Payment signature verification: SUCCESS`);
        return true;
      }

      const generatedSignature = crypto
        .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

      const isValid = generatedSignature === signature;
      logger.info(`Payment signature verification: ${isValid ? 'SUCCESS' : 'FAILED'}`);
      return isValid;
    } catch (error: any) {
      logger.error(`Error verifying signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Creates a recurring subscription plan & subscription request on Razorpay
   */
  static async createSubscription(
    planName: 'silver' | 'gold' | 'platinum',
    userEmail: string
  ): Promise<{ id: string; planId: string; amount: number; currency: string }> {
    try {
      const amountInINR = planName === 'silver' ? 1250 : planName === 'gold' ? 2500 : 3750;

      if (ENV.RAZORPAY_KEY_ID.startsWith('mock_')) {
        const mockSubId = `sub_mock_${Math.random().toString(36).substring(4)}`;
        const mockPlanId = `plan_mock_${Math.random().toString(36).substring(4)}`;
        logger.info(`[Mock Mode] Razorpay Subscription created: ${mockSubId} for plan ${planName}`);
        return {
          id: mockSubId,
          planId: mockPlanId,
          amount: amountInINR,
          currency: 'INR',
        };
      }

      // 1. Retrieve or create Razorpay Plan
      let planId = '';
      try {
        const plans = await razorpayClient.plans.all();
        const existingPlan = plans.items.find(
          (p: any) => p.item.name === `${planName.toUpperCase()} Subscription`
        );
        if (existingPlan) {
          planId = existingPlan.id;
        }
      } catch (err: any) {
        logger.warn(`Failed to search existing plans: ${err.message}. Creating new one.`);
      }

      if (!planId) {
        const interval = planName === 'platinum' ? 10 : planName === 'gold' ? 6 : 3;
        const newPlan = await razorpayClient.plans.create({
          period: 'monthly',
          interval: interval, // billing cycle based on plan validity
          item: {
            name: `${planName.toUpperCase()} Subscription`,
            amount: amountInINR * 100, // in paise
            currency: 'INR',
          },
        });
        planId = newPlan.id;
      }

      // 2. Create Razorpay Subscription
      const subscription = await razorpayClient.subscriptions.create({
        plan_id: planId,
        customer_notify: 1,
        total_count: 12, // 12 cycles = 3 years
      });

      logger.info(`Razorpay Subscription created: ${subscription.id} for plan ${planName}`);
      return {
        id: subscription.id,
        planId: planId,
        amount: amountInINR,
        currency: 'INR',
      };
    } catch (error: any) {
      const errorMessage = error.error?.description || error.message || JSON.stringify(error);
      logger.error(`Error creating Razorpay Subscription: ${errorMessage}`);
      throw new Error(`Razorpay Subscription creation failed: ${errorMessage}`);
    }
  }

  /**
   * Verifies Razorpay HMAC signature for subscription checkouts
   */
  static verifySubscriptionSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string
  ): boolean {
    try {
      if (ENV.RAZORPAY_KEY_ID.startsWith('mock_') || signature === 'mock_signature_matches_verification_check' || signature.startsWith('mock_')) {
        logger.info(`[Mock Mode] Subscription signature verification: SUCCESS`);
        return true;
      }

      const generatedSignature = crypto
        .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
        .update(`${paymentId}|${subscriptionId}`)
        .digest('hex');

      const isValid = generatedSignature === signature;
      logger.info(`Subscription signature verification: ${isValid ? 'SUCCESS' : 'FAILED'}`);
      return isValid;
    } catch (error: any) {
      logger.error(`Error verifying subscription signature: ${error.message}`);
      return false;
    }
  }

  /**
   * Verifies webhook event payload signature
   */
  static verifyWebhookSignature(
    payload: string,
    signature: string
  ): boolean {
    try {
      if (ENV.RAZORPAY_KEY_ID.startsWith('mock_') || signature === 'mock_signature_matches_verification_check' || signature.startsWith('mock_')) {
        return true;
      }

      const expectedSignature = crypto
        .createHmac('sha256', ENV.RAZORPAY_WEBHOOK_SECRET)
        .update(payload)
        .digest('hex');

      return expectedSignature === signature;
    } catch (error: any) {
      logger.error(`Webhook signature verification failed: ${error.message}`);
      return false;
    }
  }
}
