import axios from 'axios';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Coupon } from '../models/Coupon';
import { ReferralReward } from '../models/ReferralReward';
import { Transaction } from '../models/Transaction';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Referral & Coupon Integration Tests...\n');

  try {
    // Connect to database
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB for verification.');

    // Clean up existing test records to ensure clean slate
    await User.deleteMany({ firebaseId: { $in: ['mock-user-uid-mock_referrer_user', 'mock-user-uid-mock_referee_user'] } });
    await Coupon.deleteMany({ code: { $in: ['SHIVA50', 'FLAT100'] } });
    console.log('✅ Cleaned up old test users and coupons from MongoDB.');

    // Provision Referrer & Referee users
    console.log('⏳ Provisioning test users...');
    const referrerClient = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_referrer_user' },
    });

    const refereeClient = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_referee_user' },
    });

    await referrerClient.get('/auth/me');
    await refereeClient.get('/auth/me');
    console.log('✅ Mock users auto-provisioned.');

    const referrer = await User.findOne({ firebaseId: 'mock-user-uid-mock_referrer_user' });
    const referee = await User.findOne({ firebaseId: 'mock-user-uid-mock_referee_user' });

    if (!referrer || !referee) {
      throw new Error('Auto-provisioning failed to find mock users in DB.');
    }

    console.log(`   Referrer Code: ${referrer.referralCode}`);
    console.log(`   Referee Code: ${referee.referralCode}`);

    // Create promo coupons in DB
    const couponShiva50 = await Coupon.create({
      code: 'SHIVA50',
      discountType: 'percentage',
      discountValue: 50,
      maxUses: 10,
      usedCount: 0,
      expiryDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days expiry
      isActive: true,
      applicablePlans: ['gold', 'platinum'],
    });

    const couponFlat100 = await Coupon.create({
      code: 'FLAT100',
      discountType: 'fixed',
      discountValue: 100,
      maxUses: 5,
      usedCount: 0,
      expiryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days expiry
      isActive: true,
      applicablePlans: ['silver', 'gold', 'platinum'],
    });

    console.log('✅ Created mock Coupons: SHIVA50 (50%), FLAT100 (₹100).');

    // ─── TEST 1: APPLY INVITE CODE ───
    console.log('\n⏳ Test 1: Referee applying Referrer invite code...');
    const applyRes = await refereeClient.post('/referrals/apply', { code: referrer.referralCode });
    if (!applyRes.data.success) {
      throw new Error(`Failed to apply invite code: ${applyRes.data.message}`);
    }
    console.log(`✅ Applied invite code successfully: "${applyRes.data.message}"`);

    // Verify referee updated in DB
    const updatedReferee = await User.findById(referee._id);
    if (!updatedReferee || updatedReferee.referredBy?.toString() !== referrer._id.toString()) {
      throw new Error('Verification failed: referredBy field was not linked in DB.');
    }
    console.log('✅ DB verified referee successfully linked referredBy to referrer.');

    // ─── TEST 2: BLOCKS DUPLICATE / SELF REFERRALS ───
    console.log('\n⏳ Test 2: Verifying referral validation blocks...');
    try {
      await refereeClient.post('/referrals/apply', { code: referrer.referralCode });
      throw new Error('Failing test: Referee allowed to apply invite code twice.');
    } catch (err: any) {
      if (err.response?.status === 400) {
        console.log('✅ Blocked double-applied invite code correctly.');
      } else {
        throw err;
      }
    }

    try {
      await referrerClient.post('/referrals/apply', { code: referrer.referralCode });
      throw new Error('Failing test: Referrer allowed to refer themselves.');
    } catch (err: any) {
      if (err.response?.status === 400) {
        console.log('✅ Blocked self-referral correctly.');
      } else {
        throw err;
      }
    }

    // ─── TEST 3: VALIDATE COUPON ───
    console.log('\n⏳ Test 3: Validating coupon codes via API...');
    const valRes = await refereeClient.post('/payments/coupon/validate', {
      code: 'SHIVA50',
      plan: 'gold'
    });

    if (!valRes.data.success) {
      throw new Error(`Coupon validation request failed: ${valRes.data.message}`);
    }

    const valData = valRes.data.data;
    console.log('✅ Coupon validation successful:');
    console.log(`   Code: ${valData.code}`);
    console.log(`   Discount: ${valData.discountApplied} INR`);
    console.log(`   Original Price: ${valData.originalPrice} INR`);
    console.log(`   Final Price: ${valData.finalAmount} INR`);

    if (valData.originalPrice !== 1999 || valData.discountApplied !== 1000 || valData.finalAmount !== 999) {
      throw new Error(`Discount math failed: original=${valData.originalPrice}, discount=${valData.discountApplied}, final=${valData.finalAmount}`);
    }

    // ─── TEST 4: CHECKOUT WITH COUPON ───
    console.log('\n⏳ Test 4: Creating Razorpay checkout order with coupon applied...');
    const orderRes = await refereeClient.post('/payments/checkout', {
      plan: 'gold',
      couponCode: 'SHIVA50'
    });

    if (!orderRes.data.success) {
      throw new Error(`Checkout failed: ${orderRes.data.message}`);
    }

    const orderData = orderRes.data.data;
    console.log('✅ Order created with coupon:');
    console.log(`   OrderId: ${orderData.orderId}`);
    console.log(`   Amount: ${orderData.amount} paise (should be 99900 paise / ₹999)`);

    if (orderData.amount !== 99900) {
      throw new Error(`Final amount was not discounted in Razorpay order. Amount: ${orderData.amount}`);
    }

    // Verify transaction DB log
    const tx = await Transaction.findOne({ razorpayOrderId: orderData.orderId });
    if (!tx || tx.couponCode !== 'SHIVA50' || tx.discountApplied !== 1000 || tx.amount !== 999) {
      throw new Error('Transaction record did not store coupon data correctly.');
    }
    console.log('✅ DB Transaction logged coupon and discount amount correctly.');

    // ─── TEST 5: VERIFY SIGNATURE & PROCESS REFERRAL REWARDS ───
    console.log('\n⏳ Test 5: Simulating signature verification checkout update...');
    const mockPaymentId = `pay_mock_${Math.random().toString(36).substring(4)}`;
    const mockSignature = crypto
      .createHmac('sha256', ENV.RAZORPAY_KEY_SECRET)
      .update(`${mockPaymentId}|${orderData.orderId}`)
      .digest('hex');

    const verifyRes = await refereeClient.post('/payments/verify', {
      razorpayOrderId: orderData.orderId,
      razorpayPaymentId: mockPaymentId,
      razorpaySignature: mockSignature,
    });

    if (!verifyRes.data.success) {
      throw new Error(`Payment verification failed: ${verifyRes.data.message}`);
    }
    console.log('✅ Signature verification accepted.');

    // Check referee upgraded
    const refereeFinal = await User.findById(referee._id);
    if (!refereeFinal || refereeFinal.subscription.plan !== 'gold' || refereeFinal.subscription.status !== 'active') {
      throw new Error('Referee was not upgraded to gold.');
    }
    console.log(`✅ Referee subscription status upgraded to Gold.`);

    // Check Coupon usedCount incremented
    const couponFinal = await Coupon.findOne({ code: 'SHIVA50' });
    if (!couponFinal || couponFinal.usedCount !== 1) {
      throw new Error('Coupon usedCount was not incremented.');
    }
    console.log('✅ Coupon usedCount incremented.');

    // Verify ReferralReward database records
    const referrerReward = await ReferralReward.findOne({ referrer: referrer._id, referee: referee._id });
    if (!referrerReward || referrerReward.amount !== 200 || referrerReward.status !== 'completed') {
      throw new Error('Referrer reward not created correctly.');
    }
    console.log('✅ Referrer reward ₹200 created as completed.');

    const refereeReward = await ReferralReward.findOne({ referrer: referrer._id, referee: referee._id });
    // Wait, let's verify both were created. In our query:
    const refereeRewardCheck = await ReferralReward.findOne({ referee: referee._id, amount: 100 });
    if (!refereeRewardCheck || refereeRewardCheck.status !== 'completed') {
      throw new Error('Referee reward not created correctly.');
    }
    console.log('✅ Referee reward ₹100 created as completed.');

    // ─── TEST 6: GET ANALYTICS ───
    console.log('\n⏳ Test 6: Checking Referrer dashboard analytics...');
    const analyticsRes = await referrerClient.get('/referrals/analytics');
    if (!analyticsRes.data.success) {
      throw new Error(`Failed to fetch referrer analytics: ${analyticsRes.data.message}`);
    }

    const analytics = analyticsRes.data.data;
    console.log('✅ Analytics fetched successfully:');
    console.log(`   Total Invited: ${analytics.totalReferredCount}`);
    console.log(`   Successful Upgrades: ${analytics.successfulReferredCount}`);
    console.log(`   Total Cashback Earned: ${analytics.totalRewardsEarned}`);
    
    if (analytics.totalReferredCount !== 1 || analytics.totalRewardsEarned !== 200) {
      throw new Error('Referrer analytics metrics are incorrect.');
    }

    const friendEntry = analytics.referralList[0];
    console.log(`   Friend List Verification: name=${friendEntry.name}, status=${friendEntry.status}, reward=${friendEntry.rewardAmount}`);
    if (friendEntry.status !== 'upgraded' || friendEntry.rewardAmount !== 200) {
      throw new Error('Friend upgrade listing or reward is incorrect.');
    }

    // ─── TEST 7: CLAIM REWARD ───
    console.log('\n⏳ Test 7: Claiming Referrer reward cashback...');
    const claimRes = await referrerClient.post(`/referrals/rewards/${referrerReward._id}/claim`);
    if (!claimRes.data.success) {
      throw new Error(`Claim failed: ${claimRes.data.message}`);
    }
    console.log(`✅ Cashback claim response success: "${claimRes.data.message}"`);

    // Verify status updated in DB
    const rewardCheck = await ReferralReward.findById(referrerReward._id);
    if (!rewardCheck || rewardCheck.status !== 'claimed' || !rewardCheck.claimedAt) {
      throw new Error('DB check failed: reward status was not updated to claimed.');
    }
    console.log('✅ DB verified reward status is now "claimed" with timestamp.');

    // Attempt to claim again
    try {
      await referrerClient.post(`/referrals/rewards/${referrerReward._id}/claim`);
      throw new Error('Failing test: Allowed to claim reward twice.');
    } catch (err: any) {
      if (err.response?.status === 400) {
        console.log('✅ Blocked duplicate reward claims successfully.');
      } else {
        throw err;
      }
    }

    console.log('\n🏆 ALL REFERRAL & COUPON TESTS PASSED SUCCESSFULLY! 🏆');

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
