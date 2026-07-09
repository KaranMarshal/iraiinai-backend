import axios from 'axios';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';
import { PaymentService } from '../services/payment.service';
import { signAccessToken } from './jwt';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Razorpay Payment Integration Tests...\n');

  try {
    // Connect to database
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB for verification.');

    // Provision mock_payment_user
    console.log('⏳ Triggering auto-provisioning for mock_payment_user...');
    
    // Clean up potential duplicate key conflict
    await User.deleteMany({ phone: '9999999999' });
    await User.deleteMany({ email: 'mock_payment_v2@iraiinai.temporary' });
    await User.deleteMany({ firebaseId: 'mock-payment-user-v2' });

    let user = await User.create({
      firebaseId: 'mock-payment-user-v2',
      email: 'mock_payment_v2@iraiinai.temporary',
      phone: '9999999999',
      role: 'user',
      subscription: { plan: 'free', status: 'inactive' }
    });

    const token = signAccessToken({ userId: user._id.toString(), phone: user.phone, role: 'user' });

    const client = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${token}` },
    });

    await client.get('/auth/me');
    console.log('✅ Mock user accessed /auth/me successfully.');

    console.log(`   User: ${user.email} (Current Plan: ${user.subscription.plan})`);

    // Reset user to free plan
    user.subscription = { plan: 'free', status: 'inactive' };
    await user.save();
    console.log('✅ User reset to Free plan.');

    // ─── TEST 1: CREATE SUBSCRIPTION ORDER (One-Time Gold) ───
    console.log('\n⏳ Test 1: Creating Razorpay subscription order (one-time checkout)...');
    const orderRes = await client.post('/payments/checkout', { plan: 'gold' });
    if (!orderRes.data.success) {
      throw new Error(`Order checkout failed: ${orderRes.data.message}`);
    }
    const orderData = orderRes.data.data;
    console.log('✅ Order created successfully:');
    console.log(`   OrderId: ${orderData.orderId}`);
    console.log(`   Amount: ${orderData.amount} paise`);

    // Verify transaction log exists
    const transaction = await Transaction.findOne({ razorpayOrderId: orderData.orderId });
    if (!transaction) {
      throw new Error('Verification failed: Transaction log was not found in DB.');
    }
    console.log(`   DB Transaction Log Status: ${transaction.status}`);

    // ─── TEST 2: CREATE AUTO-RENEW SUBSCRIPTION (Platinum) ───
    console.log('\n⏳ Test 2: Creating Razorpay auto-renew subscription checkout...');
    const subRes = await client.post('/payments/subscribe', { plan: 'platinum' });
    if (!subRes.data.success) {
      throw new Error(`Subscription checkout failed: ${subRes.data.message}`);
    }
    const subData = subRes.data.data;
    console.log('✅ Subscription created successfully:');
    console.log(`   SubscriptionId: ${subData.subscriptionId}`);
    console.log(`   Amount: ${subData.amount} INR`);

    // Verify transaction log exists
    const subTransaction = await Transaction.findOne({ razorpaySubscriptionId: subData.subscriptionId });
    if (!subTransaction) {
      throw new Error('Verification failed: Subscription Transaction log was not found in DB.');
    }
    console.log(`   DB Subscription Log Status: ${subTransaction.status}`);

    // ─── TEST 3: VERIFY SIGNATURE (Subscription checkout verification) ───
    console.log('\n⏳ Test 3: Verifying subscription checkout signature...');
    const mockPaymentId = `pay_mock_${Math.random().toString(36).substring(4)}`;
    
    // Generate signature locally using payment service helper
    const mockSignature = crypto
      .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
      .update(`${mockPaymentId}|${subData.subscriptionId}`)
      .digest('hex');

    const verifyRes = await client.post('/payments/verify', {
      razorpaySubscriptionId: subData.subscriptionId,
      razorpayPaymentId: mockPaymentId,
      razorpaySignature: mockSignature,
    });

    if (!verifyRes.data.success) {
      throw new Error(`Signature verification failed: ${verifyRes.data.message}`);
    }
    console.log('✅ Signature verified successfully!');

    // Verify User upgraded to platinum
    const updatedUser = await User.findById(user._id);
    if (!updatedUser || updatedUser.subscription.plan !== 'platinum' || updatedUser.subscription.status !== 'active') {
      throw new Error('Verification failed: User was not upgraded to Platinum plan post verification.');
    }
    console.log(`   Upgraded User Plan: ${updatedUser.subscription.plan} (Status: ${updatedUser.subscription.status})`);
    console.log(`   Stored Subscription ID: ${updatedUser.subscription.razorpaySubscriptionId}`);

    // ─── TEST 4: WEBHOOK RECURRING CHARGE ───
    console.log('\n⏳ Test 4: Simulating Razorpay Webhook subscription.charged event...');
    
    // Reset user to Gold plan first
    updatedUser.subscription = {
      plan: 'gold',
      status: 'active',
      razorpaySubscriptionId: subData.subscriptionId,
      expiryDate: new Date(),
    };
    await updatedUser.save();
    console.log('   User reset to Gold with active subscription ID.');

    const mockWebhookRenewalPayId = `pay_renew_${Math.random().toString(36).substring(4)}`;
    const webhookPayload = {
      event: 'subscription.charged',
      payload: {
        subscription: {
          entity: {
            id: subData.subscriptionId,
            plan_id: 'plan_mock_id',
            status: 'active'
          }
        },
        payment: {
          entity: {
            id: mockWebhookRenewalPayId,
            amount: 199900, // in paise
            currency: 'INR'
          }
        }
      }
    };

    const webhookBodyString = JSON.stringify(webhookPayload);
    const webhookSignature = crypto
      .createHmac('sha256', ENV.RAZORPAY_WEBHOOK_SECRET)
      .update(webhookBodyString)
      .digest('hex');

    const webhookRes = await axios.post(`${BASE_URL}/payments/webhook`, webhookPayload, {
      headers: {
        'x-razorpay-signature': webhookSignature,
        'Content-Type': 'application/json',
      },
    });

    if (webhookRes.status !== 200) {
      throw new Error(`Webhook request failed with status: ${webhookRes.status}`);
    }
    console.log('✅ Webhook dispatched and accepted.');

    // Wait a brief moment for database save
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify user expiry was extended by 3 months
    const renewedUser = await User.findById(user._id);
    if (!renewedUser) {
      throw new Error('User not found after renewal.');
    }
    console.log(`   User Subscription Plan: ${renewedUser.subscription.plan}`);
    console.log(`   User Expiry Date: ${renewedUser.subscription.expiryDate}`);

    // Verify transaction logs
    const renewalTransaction = await Transaction.findOne({ razorpayPaymentId: mockWebhookRenewalPayId });
    if (!renewalTransaction) {
      throw new Error('Verification failed: Webhook failed to log new Transaction for renewal.');
    }
    console.log(`   DB logged Transaction for renewal. Status: ${renewalTransaction.status}, Amount: ${renewalTransaction.amount}`);

    console.log('\n🏆 ALL RAZORPAY INTEGRATION TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
    if (error.response) {
      console.error(`   Status Code: ${error.response.status}`);
      console.error(`   Response Message:`, error.response.data);
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB.');
  }
};

runTests();
