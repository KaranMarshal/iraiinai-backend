import axios from 'axios';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { InterestRequest } from '../models/InterestRequest';
import { Notification } from '../models/Notification';
import { Match } from '../models/Match';
import { User } from '../models/User';
import { Profile } from '../models/Profile';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Matrimony Interest Request Integration Tests...\n');

  try {
    // Connect to database to clean up beforehand
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB for setup.');

    // We will find users if they already exist, so we can clean their history
    // First, let\'s trigger mock auth to auto-provision them.
    // We can do this by making a simple request with each token.
    console.log('⏳ Triggering auto-provisioning for mock_user_1 and mock_user_2...');
    
    const client1 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_1' },
    });

    const client2 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_2' },
    });

    // Make a dummy request to trigger provisioning
    await client1.get('/auth/me');
    await client2.get('/auth/me');
    console.log('✅ Mock users auto-provisioned.');

    // Fetch the provisioned user documents
    const user1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_1' });
    const user2 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_2' });

    if (!user1 || !user2) {
      throw new Error('Auto-provisioning failed to create mock users in MongoDB.');
    }

    console.log(`   User 1 ID: ${user1._id} (${user1.email})`);
    console.log(`   User 2 ID: ${user2._id} (${user2.email})`);

    // Ensure user2\'s profile has gender \'female\' to be realistic and test matchmaking filters if needed,
    // though the direct endpoints don\'t restrict gender. Let\'s make it clean anyway.
    await Profile.updateOne({ user: user2._id }, { gender: 'female' });

    // Clean up previous test runs for these users
    await InterestRequest.deleteMany({
      $or: [
        { sender: user1._id, receiver: user2._id },
        { sender: user2._id, receiver: user1._id }
      ]
    });
    await Match.deleteMany({
      $or: [
        { user1: user1._id, user2: user2._id },
        { user1: user2._id, user2: user1._id }
      ]
    });
    await Notification.deleteMany({
      recipient: { $in: [user1._id, user2._id] }
    });
    console.log('✅ Cleared previous test data from InterestRequest, Match, and Notification.');

    // ─── TEST 1: SEND INTEREST REQUEST ───
    console.log('\n⏳ Test 1: Sending Interest Request from User 1 to User 2...');
    const sendRes = await client1.post('/matches/interest/send', {
      targetUserId: user2._id.toString(),
      message: 'I would love to connect with you. I really like your profile.'
    });

    if (!sendRes.data.success) {
      throw new Error(`Send interest failed: ${sendRes.data.message}`);
    }

    const requestDoc = sendRes.data.data;
    console.log('✅ Interest Request sent successfully!');
    console.log(`   Request ID: ${requestDoc._id}`);
    console.log(`   Status: ${requestDoc.status}`);
    console.log(`   Message: "${requestDoc.message}"`);

    // Verify InterestRequest is in DB
    const dbRequest = await InterestRequest.findById(requestDoc._id);
    if (!dbRequest || dbRequest.status !== 'pending') {
      throw new Error('Verification failed: Interest request document not found or status not pending.');
    }
    console.log('✅ Verified InterestRequest stored in Database with "pending" status.');

    // Verify Notification exists for User 2
    const dbNotif = await Notification.findOne({
      recipient: user2._id,
      sender: user1._id,
      type: 'interest_request'
    });
    if (!dbNotif) {
      throw new Error('Verification failed: Notification for interest request not found for receiver.');
    }
    console.log(`✅ Verified Notification created for receiver: "${dbNotif.title}" - "${dbNotif.body}"`);

    // ─── TEST 2: DUPLICATE PREVENTION ───
    console.log('\n⏳ Test 2: Trying to send duplicate interest request...');
    try {
      await client1.post('/matches/interest/send', {
        targetUserId: user2._id.toString(),
        message: 'Duplicate request test.'
      });
      throw new Error('Vulnerability: Duplicate interest request was not blocked!');
    } catch (err: any) {
      if (err.response?.status === 400) {
        console.log('✅ Duplicate request correctly blocked with 400 Bad Request!');
        console.log(`   Backend Response: "${err.response.data.message}"`);
      } else {
        throw err;
      }
    }

    // ─── TEST 3: FETCH INTEREST HISTORY ───
    console.log('\n⏳ Test 3: Fetching Interest History for User 2 (Receiver)...');
    const historyRes = await client2.get('/matches/interest/history');
    if (!historyRes.data.success) {
      throw new Error(`Fetch history failed: ${historyRes.data.message}`);
    }

    const { incoming, outgoing } = historyRes.data.data;
    console.log(`✅ History retrieved successfully!`);
    console.log(`   Incoming requests count: ${incoming.length}`);
    console.log(`   Outgoing requests count: ${outgoing.length}`);

    const receivedRequest = incoming.find((i: any) => i._id.toString() === requestDoc._id.toString());
    if (!receivedRequest) {
      throw new Error('Verification failed: Sent request not found in receiver\'s incoming list.');
    }
    console.log(`   Found request in incoming. Message: "${receivedRequest.message}"`);
    console.log(`   Sender Profile Name: ${receivedRequest.profile?.name}`);

    // ─── TEST 4: RESPOND TO INTEREST (ACCEPT) ───
    console.log('\n⏳ Test 4: Responding to Interest Request (Accept) by User 2...');
    const respondRes = await client2.post(`/matches/interest/${requestDoc._id}/respond`, {
      action: 'accepted'
    });

    if (!respondRes.data.success) {
      throw new Error(`Respond to interest failed: ${respondRes.data.message}`);
    }

    const { interestRequest: updatedRequest, match } = respondRes.data.data;
    console.log('✅ Response processed successfully!');
    console.log(`   Updated Request Status: ${updatedRequest.status}`);
    console.log(`   Match Status: ${match.status}`);
    console.log(`   Match Compatibility Score: ${match.compatibilityScore}%`);
    console.log(`   Match AI Reasoning (short): ${match.aiReasoning.substring(0, 100)}...`);

    // Verify InterestRequest is status \'accepted\'
    const finalRequest = await InterestRequest.findById(requestDoc._id);
    if (!finalRequest || finalRequest.status !== 'accepted') {
      throw new Error('Verification failed: Interest request status is not accepted in DB.');
    }
    console.log('✅ Verified InterestRequest status updated to "accepted" in Database.');

    // Verify Match created and has compatibility reasoning
    const dbMatch = await Match.findOne({
      $or: [
        { user1: user1._id, user2: user2._id },
        { user1: user2._id, user2: user1._id }
      ]
    });
    if (!dbMatch || dbMatch.status !== 'matched') {
      throw new Error('Verification failed: Mutual match document not found or status not "matched".');
    }
    console.log(`✅ Verified Match document created with status "matched" and compatibility score ${dbMatch.compatibilityScore}%.`);

    // Verify Notification exists for User 1 (Sender)
    const dbAcceptNotif = await Notification.findOne({
      recipient: user1._id,
      sender: user2._id,
      type: 'interest_accept'
    });
    if (!dbAcceptNotif) {
      throw new Error('Verification failed: Notification for interest acceptance not found for sender.');
    }
    console.log(`✅ Verified Notification created for sender: "${dbAcceptNotif.title}" - "${dbAcceptNotif.body}"`);

    console.log('\n🏆 ALL MATRIMONY INTEREST REQUEST INTEGRATION TESTS PASSED SUCCESSFULLY! 🏆');

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
