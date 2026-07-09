import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { PaymentService } from '../services/payment.service';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { Coupon } from '../models/Coupon';
import { ReferralReward } from '../models/ReferralReward';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';
import { generateInvoice } from '../utils/pdfGenerator';

const PLAN_PRICES = {
  silver: 1250,      // INR 1250
  gold: 2500,       // INR 2500
  platinum: 3750,   // INR 3750
};

export class PaymentController {
  /**
   * Helper function to calculate discounted plan price based on coupon validation
   */
  static calculateDiscountedAmount = async (plan: string, couponCode?: string) => {
    const originalPrice = PLAN_PRICES[plan as keyof typeof PLAN_PRICES];
    if (!couponCode) return { amount: originalPrice, discountApplied: 0 };

    const coupon = await Coupon.findOne({ code: couponCode.trim().toUpperCase(), isActive: true });
    if (!coupon) return { amount: originalPrice, discountApplied: 0 };

    // Check expiry
    if (new Date(coupon.expiryDate) < new Date()) return { amount: originalPrice, discountApplied: 0 };
    // Check max uses
    if (coupon.usedCount >= coupon.maxUses) return { amount: originalPrice, discountApplied: 0 };
    // Check applicable plans
    if (coupon.applicablePlans && coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(plan)) {
      return { amount: originalPrice, discountApplied: 0 };
    }

    let discountApplied = 0;
    if (coupon.discountType === 'percentage') {
      discountApplied = Math.round((originalPrice * coupon.discountValue) / 100);
    } else {
      discountApplied = coupon.discountValue;
    }

    const amount = Math.max(0, originalPrice - discountApplied);
    return { amount, discountApplied };
  };

  /**
   * Validate a coupon code and calculate final discounted price (REST endpoint)
   */
  static validateCouponCode = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { code, plan } = req.body;
      if (!code || !plan) {
        return sendResponse(res, 400, false, 'Coupon code and plan selection are required.');
      }

      if (!['silver', 'gold', 'platinum'].includes(plan)) {
        return sendResponse(res, 400, false, 'Invalid plan selection.');
      }

      const coupon = await Coupon.findOne({ code: code.trim().toUpperCase(), isActive: true });
      if (!coupon) {
        return sendResponse(res, 400, false, 'Invalid or inactive coupon code.');
      }

      if (new Date(coupon.expiryDate) < new Date()) {
        return sendResponse(res, 400, false, 'This coupon code has expired.');
      }

      if (coupon.usedCount >= coupon.maxUses) {
        return sendResponse(res, 400, false, 'This coupon code has reached its maximum usage limit.');
      }

      if (coupon.applicablePlans && coupon.applicablePlans.length > 0 && !coupon.applicablePlans.includes(plan)) {
        return sendResponse(res, 400, false, `This coupon code is not applicable to the ${plan} plan.`);
      }

      const originalPrice = PLAN_PRICES[plan as keyof typeof PLAN_PRICES];
      let discountApplied = 0;

      if (coupon.discountType === 'percentage') {
        discountApplied = Math.round((originalPrice * coupon.discountValue) / 100);
      } else {
        discountApplied = coupon.discountValue;
      }

      const finalAmount = Math.max(0, originalPrice - discountApplied);

      return sendResponse(res, 200, true, 'Coupon validated successfully.', {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        discountApplied,
        originalPrice,
        finalAmount,
      });
    } catch (error: any) {
      logger.error(`validateCouponCode error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to validate coupon code.');
    }
  };

  /**
   * Generates a new Razorpay order based on requested subscription tier (supports coupons)
   */
  static createSubscriptionOrder = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { plan, couponCode } = req.body; // 'silver' | 'gold' | 'platinum'
      if (!plan || !['silver', 'gold', 'platinum'].includes(plan)) {
        return sendResponse(res, 400, false, 'Invalid subscription tier selected.');
      }

      const { amount, discountApplied } = await PaymentController.calculateDiscountedAmount(plan, couponCode);
      const receiptId = `receipt_user_${req.user?._id}_${Date.now()}`;

      // Create Razorpay Order
      const order = await PaymentService.createOrder(amount, receiptId);

      // Create MongoDB Transaction log
      const transaction = await Transaction.create({
        user: req.user?._id,
        razorpayOrderId: order.id,
        amount: amount,
        plan: plan,
        status: 'created',
        signatureVerified: false,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : undefined,
        discountApplied,
      });

      logger.info(`Transaction initialized in DB: ${transaction._id}`);

      return sendResponse(res, 200, true, 'Order created successfully.', {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID || 'mock_key_id',
      });
    } catch (error: any) {
      logger.error(`createSubscriptionOrder error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to create subscription order.');
    }
  };

  /**
   * Generates a new Razorpay subscription based on requested subscription tier (supports coupons)
   */
  static createSubscriptionCheckout = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { plan, couponCode } = req.body; // 'silver' | 'gold' | 'platinum'
      if (!plan || !['silver', 'gold', 'platinum'].includes(plan)) {
        return sendResponse(res, 400, false, 'Invalid subscription tier selected.');
      }

      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const { amount, discountApplied } = await PaymentController.calculateDiscountedAmount(plan, couponCode);
      const subscriptionData = await PaymentService.createSubscription(plan as 'silver' | 'gold' | 'platinum', req.user.email!);

      // Create MongoDB Transaction log
      const transaction = await Transaction.create({
        user: req.user._id,
        razorpaySubscriptionId: subscriptionData.id,
        amount: amount, // Log the actual discounted price
        plan: plan,
        status: 'created',
        signatureVerified: false,
        couponCode: couponCode ? couponCode.trim().toUpperCase() : undefined,
        discountApplied,
      });

      logger.info(`Subscription Transaction initialized in DB: ${transaction._id}`);

      return sendResponse(res, 200, true, 'Subscription created successfully.', {
        subscriptionId: subscriptionData.id,
        amount: amount, // Return the actual discounted amount
        currency: subscriptionData.currency,
        keyId: process.env.RAZORPAY_KEY_ID || 'mock_key_id',
      });
    } catch (error: any) {
      logger.error(`createSubscriptionCheckout error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to create subscription checkout.');
    }
  };

  /**
   * Helper function to process referee/referrer rewards on successful premium upgrades
   */
  static processReferralRewards = async (userId: any, transactionId: any, amountPaid: number) => {
    try {
      const user = await User.findById(userId);
      if (user && user.referredBy) {
        // Check if referral rewards already exist for this referee (prevent duplicate rewards on renewals)
        const existingReward = await ReferralReward.findOne({ referee: userId });
        if (existingReward) return;

        // Create Referrer Reward (₹200 cashback)
        const referrerReward = await ReferralReward.create({
          referrer: user.referredBy,
          referee: userId,
          rewardType: 'cashback',
          amount: 200,
          status: 'completed', // claimable right away
          transactionId: transactionId,
        });
        
        logger.info(`Referral reward created for Referrer: ${user.referredBy}. Reward ID: ${referrerReward._id}`);

        // Create Referee Reward (₹100 cashback)
        const refereeReward = await ReferralReward.create({
          referrer: user.referredBy,
          referee: userId,
          rewardType: 'cashback',
          amount: 100,
          status: 'completed',
          transactionId: transactionId,
        });

        logger.info(`Referral reward created for Referee: ${userId}. Reward ID: ${refereeReward._id}`);

        // Notify Referrer
        const { Notification } = require('../models/Notification');
        Notification.create({
          recipient: user.referredBy,
          type: 'subscription',
          title: 'Referral Cashback Earned! 🎁',
          body: 'Someone you invited just upgraded to Premium! You have earned a ₹200 cashback reward. Claim it now in your profile settings.',
          dataPayload: new Map([['type', 'cashback']]),
          isRead: false
        }).catch((nErr: any) => {
          logger.error(`Failed to create referral notification: ${nErr.message}`);
        });

        // Notify Referee
        Notification.create({
          recipient: userId,
          type: 'subscription',
          title: 'Referee Reward Activated! 🎉',
          body: 'Thanks for signing up with an invite code! You have been credited a ₹100 cashback reward. Claim it now in your profile settings.',
          dataPayload: new Map([['type', 'cashback']]),
          isRead: false
        }).catch((nErr: any) => {
          logger.error(`Failed to create referee notification: ${nErr.message}`);
        });
      }
    } catch (err: any) {
      logger.error(`Failed to process referral rewards: ${err.message}`);
    }
  };

  /**
   * Verifies Razorpay payment signature post checkout
   */
  static verifyPaymentSignature = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { razorpayOrderId, razorpaySubscriptionId, razorpayPaymentId, razorpaySignature } = req.body;

      if ((!razorpayOrderId && !razorpaySubscriptionId) || !razorpayPaymentId || !razorpaySignature) {
        return sendResponse(res, 400, false, 'Missing payment parameters for validation.');
      }

      let transaction;
      let isValid = false;

      if (razorpaySubscriptionId) {
        transaction = await Transaction.findOne({ razorpaySubscriptionId });
        if (!transaction) {
          return sendResponse(res, 404, false, 'Transaction log not found.');
        }

        isValid = PaymentService.verifySubscriptionSignature(
          razorpayPaymentId,
          razorpaySubscriptionId,
          razorpaySignature
        );
      } else {
        transaction = await Transaction.findOne({ razorpayOrderId });
        if (!transaction) {
          return sendResponse(res, 404, false, 'Transaction log not found.');
        }

        isValid = PaymentService.verifyPaymentSignature(
          razorpayOrderId!,
          razorpayPaymentId,
          razorpaySignature
        );
      }

      if (!isValid) {
        transaction.status = 'failed';
        await transaction.save();
        return sendResponse(res, 400, false, 'Payment signature verification failed.');
      }

      // Update Transaction log
      transaction.status = 'paid';
      transaction.razorpayPaymentId = razorpayPaymentId;
      transaction.signatureVerified = true;
      await transaction.save();

      // Upgrade User Account Plan
      const expiry = new Date();
      const planMonths = transaction.plan === 'platinum' ? 10 : transaction.plan === 'gold' ? 6 : 3;
      expiry.setMonth(expiry.getMonth() + planMonths);

      const updatePayload: any = {
        subscription: {
          plan: transaction.plan,
          status: 'active',
          expiryDate: expiry,
        },
      };

      if (razorpaySubscriptionId) {
        updatePayload.subscription.razorpaySubscriptionId = razorpaySubscriptionId;
      }

      await User.findByIdAndUpdate(transaction.user, updatePayload);

      // Process referral rewards
      await PaymentController.processReferralRewards(transaction.user, transaction._id, transaction.amount);

      // Increment Coupon count
      if (transaction.couponCode) {
        await Coupon.findOneAndUpdate(
          { code: transaction.couponCode },
          { $inc: { usedCount: 1 } }
        );
      }

      const { Notification } = require('../models/Notification');
      Notification.create({
        recipient: transaction.user,
        type: 'subscription',
        title: 'Premium Activated! 🌟',
        body: `Congratulations! Your account has been upgraded to the ${transaction.plan.toUpperCase()} plan. Enjoy premium matchmaking features.`,
        dataPayload: new Map([['type', 'subscription']]),
        isRead: false
      }).catch((nErr: any) => {
        logger.error(`Failed to create payment verification notification: ${nErr.message}`);
      });

      logger.info(`User ${transaction.user} successfully upgraded to ${transaction.plan}`);

      // Generate Invoice
      const userObj = await User.findById(transaction.user);
      if (userObj) {
        try {
          const invoiceUrl = await generateInvoice(transaction, userObj, req.headers.host || 'localhost:5000');
          transaction.invoiceUrl = invoiceUrl;
          await transaction.save();
        } catch (invErr: any) {
          logger.error(`Invoice generation failed during verify: ${invErr.message}`);
        }
      }

      return sendResponse(res, 200, true, 'Payment verified & subscription activated.');
    } catch (error: any) {
      logger.error(`verifyPaymentSignature error: ${error.message}`);
      return sendResponse(res, 500, false, 'Error processing payment validation.');
    }
  };

  /**
   * Razorpay Webhook Endpoint
   */
  static handleWebhook = async (req: Request, res: Response) => {
    try {
      const signature = req.headers['x-razorpay-signature'] as string;
      const rawBody = (req as any).rawBody ? (req as any).rawBody.toString('utf8') : JSON.stringify(req.body);

      // Verify signature
      const isValid = PaymentService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        return res.status(400).send('Invalid signature.');
      }

      const event = req.body.event;
      logger.info(`Razorpay Webhook received: ${event}`);

      if (event === 'payment.captured') {
        const paymentEntity = req.body.payload.payment.entity;
        const orderId = paymentEntity.order_id;
        
        const transaction = await Transaction.findOne({ razorpayOrderId: orderId });
        if (transaction && transaction.status !== 'paid') {
          transaction.status = 'paid';
          transaction.razorpayPaymentId = paymentEntity.id;
          await transaction.save();

          const expiry = new Date();
          const planMonths = transaction.plan === 'platinum' ? 10 : transaction.plan === 'gold' ? 6 : 3;
          expiry.setMonth(expiry.getMonth() + planMonths);

          await User.findByIdAndUpdate(transaction.user, {
            subscription: {
              plan: transaction.plan,
              status: 'active',
              expiryDate: expiry,
            },
          });

          // Process referral rewards
          await PaymentController.processReferralRewards(transaction.user, transaction._id, transaction.amount);

          // Increment Coupon count
          if (transaction.couponCode) {
            await Coupon.findOneAndUpdate(
              { code: transaction.couponCode },
              { $inc: { usedCount: 1 } }
            );
          }

          const { Notification } = require('../models/Notification');
          Notification.create({
            recipient: transaction.user,
            type: 'subscription',
            title: 'Premium Activated! 🌟',
            body: `Congratulations! Your account has been upgraded to the ${transaction.plan.toUpperCase()} plan. Enjoy premium matchmaking features.`,
            dataPayload: new Map([['type', 'subscription']]),
            isRead: false
          }).catch((nErr: any) => {
            logger.error(`Failed to create payment webhook notification: ${nErr.message}`);
          });
          logger.info(`Webhook upgraded user plan to ${transaction.plan} for order: ${orderId}`);

          // Generate Invoice
          const userObj = await User.findById(transaction.user);
          if (userObj) {
            try {
              const invoiceUrl = await generateInvoice(transaction, userObj, req.headers.host || 'localhost:5000');
              transaction.invoiceUrl = invoiceUrl;
              await transaction.save();
            } catch (invErr: any) {
              logger.error(`Invoice generation failed during webhook: ${invErr.message}`);
            }
          }
        }
      }

      if (event === 'subscription.charged') {
        const subEntity = req.body.payload.subscription.entity;
        const payEntity = req.body.payload.payment.entity;
        const subscriptionId = subEntity.id;

        const user = await User.findOne({ 'subscription.razorpaySubscriptionId': subscriptionId });
        if (user) {
          const amount = payEntity.amount / 100;
          const newTransaction = await Transaction.create({
            user: user._id,
            razorpaySubscriptionId: subscriptionId,
            razorpayPaymentId: payEntity.id,
            amount: amount,
            plan: user.subscription.plan,
            status: 'paid',
            signatureVerified: true,
          });

          // Process referral rewards
          await PaymentController.processReferralRewards(user._id, newTransaction._id, amount);

          const expiry = new Date();
          const planMonths = user.subscription.plan === 'platinum' ? 10 : user.subscription.plan === 'gold' ? 6 : 3;
          expiry.setMonth(expiry.getMonth() + planMonths);

          user.subscription.status = 'active';
          user.subscription.expiryDate = expiry;
          await user.save();

          const { Notification } = require('../models/Notification');
          Notification.create({
            recipient: user._id,
            type: 'subscription',
            title: 'Subscription Renewed! ⚡',
            body: `Your ${user.subscription.plan.toUpperCase()} subscription was successfully renewed for another 3 months.`,
            dataPayload: new Map([['type', 'subscription']]),
            isRead: false
          }).catch((nErr: any) => {
            logger.error(`Failed to create renewal notification: ${nErr.message}`);
          });

          logger.info(`Webhook auto-renewed user ${user.email} subscription for sub: ${subscriptionId}`);

          // Generate Invoice
          try {
            const invoiceUrl = await generateInvoice(newTransaction, user, req.headers.host || 'localhost:5000');
            newTransaction.invoiceUrl = invoiceUrl;
            await newTransaction.save();
          } catch (invErr: any) {
            logger.error(`Invoice generation failed during subscription renewal: ${invErr.message}`);
          }
        }
      }

      if (event === 'subscription.cancelled' || event === 'subscription.halted') {
        const subEntity = req.body.payload.subscription.entity;
        const subscriptionId = subEntity.id;

        const user = await User.findOne({ 'subscription.razorpaySubscriptionId': subscriptionId });
        if (user) {
          user.subscription.status = 'inactive';
          await user.save();

          const { Notification } = require('../models/Notification');
          Notification.create({
            recipient: user._id,
            type: 'subscription',
            title: 'Subscription Cancelled/Suspended ⚠️',
            body: `Your premium subscription was cancelled or halted by Razorpay.`,
            dataPayload: new Map([['type', 'subscription']]),
            isRead: false
          }).catch((nErr: any) => {
            logger.error(`Failed to create cancelled notification: ${nErr.message}`);
          });

          logger.info(`Webhook cancelled user ${user.email} subscription for sub: ${subscriptionId}`);
        }
      }

      if (event === 'subscription.activated') {
        const subEntity = req.body.payload.subscription.entity;
        const subscriptionId = subEntity.id;

        const user = await User.findOne({ 'subscription.razorpaySubscriptionId': subscriptionId });
        if (user) {
          user.subscription.status = 'active';
          await user.save();
          logger.info(`Webhook activated user ${user.email} subscription for sub: ${subscriptionId}`);
        }
      }

      return res.status(200).json({ status: 'ok' });
    } catch (error: any) {
      logger.error(`Razorpay Webhook error: ${error.message}`);
      return res.status(500).send('Internal webhook error.');
    }
  };

  /**
   * Cancel user's premium subscription
   */
  static cancelSubscription = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      req.user.subscription.status = 'inactive';
      req.user.subscription.expiryDate = undefined;
      await req.user.save();

      // Create notification in Mongoose (auto-triggers push notification)
      const { Notification } = require('../models/Notification');
      Notification.create({
        recipient: req.user._id,
        type: 'subscription',
        title: 'Subscription Cancelled ⚠️',
        body: 'Your premium subscription has been successfully cancelled and auto-renewal turned off.',
        dataPayload: new Map([['type', 'subscription']]),
        isRead: false,
      }).catch((nErr: any) => {
        logger.error(`Failed to log subscription cancel notification: ${nErr.message}`);
      });

      logger.info(`User ${req.user.email} cancelled premium subscription.`);
      return sendResponse(res, 200, true, 'Premium subscription successfully cancelled.');
    } catch (error: any) {
      logger.error(`cancelSubscription error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to cancel subscription.');
    }
  };

  /**
   * Get user's transaction/billing history
   */
  static getTransactions = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const transactions = await Transaction.find({ user: req.user._id })
        .sort({ createdAt: -1 });

      return sendResponse(res, 200, true, 'Transaction history retrieved.', { transactions });
    } catch (error: any) {
      logger.error(`getTransactions error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve transaction history.');
    }
  };

  /**
   * Download or generate invoice for a specific transaction on the fly
   */
  static downloadInvoice = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const transaction = await Transaction.findById(id);

      if (!transaction) {
        return sendResponse(res, 404, false, 'Transaction not found.');
      }

      // Allow admin or the owner to download
      if (req.user?.role !== 'admin' && transaction.user.toString() !== req.user?._id.toString()) {
        return sendResponse(res, 403, false, 'Unauthorized to view this invoice.');
      }

      if (transaction.status !== 'paid') {
        return sendResponse(res, 400, false, 'Cannot generate invoice for unpaid transaction.');
      }

      // If already generated, return the existing URL
      if (transaction.invoiceUrl) {
        return sendResponse(res, 200, true, 'Invoice retrieved successfully.', { invoiceUrl: transaction.invoiceUrl });
      }

      // Fallback generation for older transactions
      const txUser = await User.findById(transaction.user);
      if (!txUser) {
        return sendResponse(res, 404, false, 'Transaction user not found.');
      }

      const invoiceUrl = await generateInvoice(transaction, txUser, req.headers.host || 'localhost:5000');
      transaction.invoiceUrl = invoiceUrl;
      await transaction.save();

      return sendResponse(res, 200, true, 'Invoice generated successfully.', { invoiceUrl });
    } catch (error: any) {
      logger.error(`downloadInvoice error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to download invoice.');
    }
  };

  /**
   * Admin: Get aggregated transaction reporting and billing data
   */
  static getTransactionReport = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startDate, endDate, plan, status } = req.query;
      
      const matchQuery: any = {};
      
      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = new Date(startDate as string);
        if (endDate) matchQuery.createdAt.$lte = new Date(endDate as string);
      }
      
      if (plan) matchQuery.plan = plan;
      if (status) matchQuery.status = status;

      // 1. Fetch filtered transactions
      const transactions = await Transaction.find(matchQuery)
        .populate('user', 'name email phone')
        .sort({ createdAt: -1 });

      // 2. Aggregate metrics for the dashboard
      const totalRevenueResult = await Transaction.aggregate([
        { $match: { ...matchQuery, status: 'paid' } },
        { $group: { _id: null, totalAmount: { $sum: '$amount' } } }
      ]);
      const totalRevenue = totalRevenueResult.length > 0 ? totalRevenueResult[0].totalAmount : 0;

      const revenueByPlan = await Transaction.aggregate([
        { $match: { ...matchQuery, status: 'paid' } },
        { $group: { _id: '$plan', totalAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]);

      const activeSubscriptions = await User.countDocuments({ 'subscription.status': 'active' });

      return sendResponse(res, 200, true, 'Transaction report generated successfully.', {
        metrics: {
          totalRevenue,
          revenueByPlan,
          activeSubscriptions,
          transactionsCount: transactions.length
        },
        transactions
      });
    } catch (error: any) {
      logger.error(`getTransactionReport error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to generate transaction report.');
    }
  };
}
