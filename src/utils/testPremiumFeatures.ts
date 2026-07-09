import axios from 'axios';
import mongoose from 'mongoose';
import { io as ClientSocket } from 'socket.io-client';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Match } from '../models/Match';
import { Chat } from '../models/Chat';

const BASE_URL = 'http://localhost:5000/api/v1';
const SOCKET_URL = 'http://localhost:5000';

const connectSocket = (socket: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err: any) => reject(err));
  });
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
  console.log('🚀 Starting IraiInai Premium Features Integration Tests...\n');

  let socket1: any;

  try {
    // 1. Connect to MongoDB
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // Clear any previous crashed dummy test users/profiles
    await User.deleteMany({ email: { $in: [/dummy_/, 'mock_user_1@iraiinai.com', 'mock_user_2@iraiinai.com'] } });
    await User.deleteMany({ phone: { $in: ['+919999999999', '+919876543210'] } });
    await User.deleteMany({ firebaseId: { $in: ['mock-user-uid-mock_user_1', 'mock-user-uid-mock_user_2'] } });
    await Profile.deleteMany({ name: { $in: [/Dummy/, 'Mock User 1', 'Mock User 2'] } });
    console.log('✅ Previous dummy test data cleared.');

    // 2. Setup mock users
    let user1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_1' });
    if (!user1) {
      user1 = await User.create({
        firebaseId: 'mock-user-uid-mock_user_1',
        email: 'mock_user_1@iraiinai.com',
        phone: '+919876543210',
        role: 'user',
        subscription: { plan: 'free', status: 'inactive' },
        unlockedContacts: []
      });
    } else {
      user1.email = 'mock_user_1@iraiinai.com';
      user1.phone = '+919876543210';
      user1.subscription = { plan: 'free', status: 'inactive' };
      user1.unlockedContacts = [];
      await user1.save();
    }

    let user2 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_2' });
    if (!user2) {
      user2 = await User.create({
        firebaseId: 'mock-user-uid-mock_user_2',
        email: 'mock_user_2@iraiinai.com',
        phone: '+919999999999',
        role: 'user',
        subscription: { plan: 'free', status: 'inactive' },
        unlockedContacts: []
      });
    } else {
      user2.email = 'mock_user_2@iraiinai.com';
      user2.phone = '+919999999999';
      user2.subscription = { plan: 'free', status: 'inactive' };
      user2.unlockedContacts = [];
      await user2.save();
    }

    const uid1 = user1._id.toString();
    const uid2 = user2._id.toString();
    console.log(`✅ Mock users initialized. User 1: ${uid1}, User 2: ${uid2}`);

    // Setup profiles
    let profile1 = await Profile.findOne({ user: user1._id });
    if (!profile1) {
      profile1 = await Profile.create({
        user: user1._id,
        name: 'Arjun Sundar',
        gender: 'male',
        dob: new Date('1995-05-15'),
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        isVerified: true
      });
    }

    let profile2 = await Profile.findOne({ user: user2._id });
    if (!profile2) {
      profile2 = await Profile.create({
        user: user2._id,
        name: 'Priya Iyer',
        gender: 'female',
        dob: new Date('1998-08-15'),
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        isVerified: true
      });
    }
    console.log('✅ Profiles verified.');

    // Remove any existing matches & chats
    await Match.deleteMany({
      $or: [
        { user1: user1._id, user2: user2._id },
        { user1: user2._id, user2: user1._id }
      ]
    });
    await Chat.deleteMany({ participants: { $all: [user1._id, user2._id] } });

    // Setup API clients
    const client1 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_1' }
    });

    const client2 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_2' }
    });

    // ─── TEST 1: CONTACT DETAILS MASKING (Free User) ───
    console.log('\n⏳ Test 1: Verifying contact details masking for Free user...');
    
    const profileRes1 = await client1.get(`/profile/${profile2._id}`);
    const loadedProfile = profileRes1.data.data;
    
    console.log(`   Loaded Profile: ${loadedProfile.name}`);
    console.log(`   Contact Details: Email: ${loadedProfile.contactDetails?.email}, Phone: ${loadedProfile.contactDetails?.phone}`);
    console.log(`   Is Unlocked: ${loadedProfile.contactDetails?.isUnlocked}`);

    if (loadedProfile.contactDetails?.isUnlocked) {
      throw new Error('Verification failed: Contact details should be locked for Free users.');
    }
    if (!loadedProfile.contactDetails?.email.includes('***') || 
        (loadedProfile.contactDetails?.phone !== 'N/A' && !loadedProfile.contactDetails?.phone.includes('******'))) {
      throw new Error('Verification failed: Contact details are not masked correctly.');
    }
    console.log('✅ Masking verified successfully.');

    // ─── TEST 2: CONTACT UNLOCKING GATING (Free User) ───
    console.log('\n⏳ Test 2: Attempting to unlock contact as Free user...');
    try {
      await client1.post(`/profile/unlock-contact/${profile2._id}`);
      throw new Error('Expected 403 upgrade_required, but unlock succeeded.');
    } catch (err: any) {
      if (err.response?.status !== 403 || err.response?.data?.code !== 'upgrade_required') {
        throw new Error(`Unexpected error response: ${err.response?.status} / ${err.response?.data?.code}`);
      }
      console.log(`   Correctly blocked with status: ${err.response.status}, code: ${err.response.data.code}`);
      console.log('✅ Unlocking gated for Free users.');
    }

    // Upgrade user 1 to premium Gold
    user1.subscription = { plan: 'gold', status: 'active' };
    await user1.save();
    console.log('   User upgraded to Gold tier.');

    // ─── TEST 3: CONTACT UNLOCKING SUCCESS (Gold User) ───
    console.log('\n⏳ Test 3: Unlocking contact details as Gold user...');
    const unlockRes = await client1.post(`/profile/unlock-contact/${profile2._id}`);
    if (!unlockRes.data.success) {
      throw new Error(`Unlock failed: ${unlockRes.data.message}`);
    }
    console.log(`   Unlocked Details: Email: ${unlockRes.data.data.email}, Phone: ${unlockRes.data.data.phone}`);
    if (unlockRes.data.data.email !== 'mock_user_2@iraiinai.com' || unlockRes.data.data.phone !== '+919999999999') {
      throw new Error('Unlocked details are incorrect.');
    }
    console.log('✅ Contact details unlocked successfully.');

    // Verify profile fetch returns unlocked details now
    const profileRes2 = await client1.get(`/profile/${profile2._id}`);
    const loadedProfileUnlocked = profileRes2.data.data;
    if (!loadedProfileUnlocked.contactDetails?.isUnlocked || loadedProfileUnlocked.contactDetails?.email !== 'mock_user_2@iraiinai.com') {
      throw new Error('Verification failed: Subsequent profile view did not return unlocked details.');
    }
    console.log('✅ Verification of persistence confirmed.');

    // ─── TEST 4: UNLOCK LIMIT GATING ───
    console.log('\n⏳ Test 4: Testing contact unlock limit gating...');
    // Create 10 dummy users and unlock them to hit the limit of 10
    const dummyUserIds = [];
    for (let i = 0; i < 10; i++) {
      const dummyUser = await User.create({
        firebaseId: `mock-user-dummy-${i}-${Math.random()}`,
        email: `dummy_${i}@example.com`,
        phone: `+91000000000${i}`,
        role: 'user',
        subscription: { plan: 'free', status: 'inactive' }
      });
      const dummyProfile = await Profile.create({
        user: dummyUser._id,
        name: `Dummy ${i}`,
        gender: 'female',
        dob: new Date('1996-01-01'),
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' }
      });
      dummyUserIds.push(dummyUser._id);
    }
    
    // Add 9 dummy users to unlockedContacts (making total 10 along with Priya Iyer)
    const freshUser1 = await User.findById(uid1);
    if (!freshUser1) throw new Error('User 1 not found for limit test.');
    freshUser1.unlockedContacts = [user2._id, ...dummyUserIds.slice(0, 9)];
    await freshUser1.save();

    console.log(`   Unlocked contacts size: ${freshUser1.unlockedContacts.length} (Limit: 10)`);

    // Try to unlock the 11th dummy user
    const target11thProfile = await Profile.findOne({ user: dummyUserIds[9] });
    try {
      await client1.post(`/profile/unlock-contact/${target11thProfile?._id}`);
      throw new Error('Expected 403 limit_reached, but unlock succeeded.');
    } catch (err: any) {
      if (err.response?.status !== 403 || err.response?.data?.code !== 'limit_reached') {
        throw new Error(`Unexpected error response: ${err.response?.status} / ${err.response?.data?.code}`);
      }
      console.log(`   Correctly blocked with status: ${err.response.status}, code: ${err.response.data.code}`);
      console.log('✅ Contact unlock limits enforced correctly.');
    }

    // Clean up dummy users
    await User.deleteMany({ _id: { $in: dummyUserIds } });
    await Profile.deleteMany({ user: { $in: dummyUserIds } });

    // Reset user 1 to free
    const finalUser1 = await User.findById(uid1);
    if (finalUser1) {
      finalUser1.subscription = { plan: 'free', status: 'inactive' };
      finalUser1.unlockedContacts = [];
      await finalUser1.save();
    }

    // Setup mutual match and chat room for Socket testing
    const match = await Match.create({
      user1: user1._id,
      user2: user2._id,
      status: 'matched',
      compatibilityScore: 90
    });

    const chat = await Chat.create({
      match: match._id,
      participants: [user1._id, user2._id],
      messages: [],
      lastMessageAt: new Date()
    });

    // ─── TEST 5: CHAT MESSAGE LIMIT GATING (Free User) ───
    console.log('\n⏳ Test 5: Testing socket message limit gating for Free user...');

    // Populat chat with 10 dummy messages from mock_user_1
    const dummyMessages = Array.from({ length: 10 }).map((_, idx) => ({
      _id: new mongoose.Types.ObjectId(),
      sender: user1!._id,
      text: 'Encrypted message placeholder', // test doesn't read text content
      isRead: false,
      timestamp: new Date(Date.now() - (10 - idx) * 60 * 1000)
    }));

    chat.messages = dummyMessages;
    await chat.save();
    console.log('   Populated chat with 10 messages from sender.');

    // Connect Client Socket
    socket1 = ClientSocket(SOCKET_URL, {
      auth: { token: 'Bearer mock_user_1' },
      transports: ['websocket']
    });

    await connectSocket(socket1);
    console.log('   Client Socket connected.');

    // Join room
    socket1.emit('join_chat', { matchId: match._id.toString() });
    await delay(100);

    // Try to send the 11th message
    let limitExceededFired = false;
    
    socket1.on('message_blocked', (payload: any) => {
      console.log(`   Received message_blocked event: reason: ${payload.reason}, message: ${payload.message}`);
      if (payload.reason === 'chat_limit_exceeded') {
        limitExceededFired = true;
      }
    });

    socket1.emit('send_message', {
      matchId: match._id.toString(),
      text: 'This message should be blocked!'
    });

    await delay(500);

    if (!limitExceededFired) {
      throw new Error('Verification failed: 11th message was not blocked.');
    }
    console.log('✅ Chat message limits gated successfully.');

    // Clean up
    await Match.deleteMany({ _id: match._id });
    await Chat.deleteMany({ _id: chat._id });

    console.log('\n🏆 ALL PREMIUM FEATURES INTEGRATION TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
    if (error.response) {
      console.error(`   Status Code: ${error.response.status}`);
      console.error(`   Response Message:`, error.response.data);
    }
  } finally {
    if (socket1) socket1.disconnect();
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB.');
  }
};

runTests();
