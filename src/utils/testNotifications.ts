import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Notification } from '../models/Notification';
import { DeviceSession } from '../models/DeviceSession';

import { FirebaseService } from '../services/firebase.service';

// Mock FirebaseService
let mockFirebaseSendCalledArgs: any[] = [];
const originalSendToUser = FirebaseService.sendToUser;
FirebaseService.sendToUser = async (...args: any[]) => {
  mockFirebaseSendCalledArgs = args;
  return true;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
  console.log('🚀 Starting IraiInai Firebase Push Notification System Tests...\n');

  try {
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // Drop stale index if it exists
    await User.collection.dropIndex('firebaseId_1').catch(() => {});

    // 1. Setup mock user and device session
    let user1 = await User.findOne({ email: 'notif_test@iraiinai.temporary' });
    if (!user1) {
      user1 = await User.create({
        email: 'notif_test@iraiinai.temporary',
        phone: '1112223334',
        role: 'user',
        subscription: { plan: 'free', status: 'inactive' },
      });
    }

    let profile1 = await Profile.findOne({ user: user1._id });
    if (!profile1) {
      profile1 = await Profile.create({
        user: user1._id,
        name: 'Notif Tester',
        gender: 'female',
        dob: new Date('1998-01-01'),
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        isVerified: true,
      });
    }

    // Assign FCM token
    await DeviceSession.findOneAndUpdate(
      { userId: user1._id, deviceId: 'test-device-id' },
      { fcmToken: 'test-fcm-token-1234', lastActive: new Date(), refreshToken: 'mock-refresh-token' },
      { upsert: true }
    );
    console.log('✅ Assigned FCM token to User.');

    // Reset Mock
    mockFirebaseSendCalledArgs = [];

    // 2. Test Notification Creation Triggers FCM
    console.log('\n⏳ Testing Mongoose post-save FCM Hook...');
    
    await Notification.create({
      recipient: user1._id,
      type: 'profile_view',
      title: 'Profile Viewed',
      body: `Someone viewed your profile.`,
      dataPayload: new Map([['type', 'profile_view']]),
      isRead: false,
    });

    // Wait for async hook execution
    await delay(1000);

    const callArgs = mockFirebaseSendCalledArgs;
    if (callArgs.length === 0) {
      throw new Error('FirebaseService.sendToUser was NOT called.');
    }

    if (callArgs[0] !== user1._id.toString()) throw new Error('Incorrect recipient ID');
    if (callArgs[1] !== 'Profile Viewed') throw new Error('Incorrect title');
    if (callArgs[2] !== 'Someone viewed your profile.') throw new Error('Incorrect body');
    if (callArgs[3].type !== 'profile_view') throw new Error('Incorrect payload');

    console.log('✅ FCM Hook successfully triggered and parsed payload correctly!');

    console.log('\n🏆 ALL NOTIFICATION TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
  } finally {
    FirebaseService.sendToUser = originalSendToUser;
    await mongoose.disconnect();
    console.log('\n🔌 Cleaned up connections.');
  }
};

runTests();
