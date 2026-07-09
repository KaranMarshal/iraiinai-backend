import axios from 'axios';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Home Dashboard API Integration Tests...\n');

  try {
    // Connect to database to check setup
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB for verification.');

    // We will trigger mock auth to auto-provision user_1.
    console.log('⏳ Triggering auto-provisioning for mock_user_1...');
    
    const client = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_1' },
    });

    // Make a dummy request to trigger provisioning
    await client.get('/auth/me');
    console.log('✅ Mock user auto-provisioned.');

    const user1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_1' });
    if (!user1) {
      throw new Error('Auto-provisioning failed to create mock user in MongoDB.');
    }

    console.log(`   User ID: ${user1._id} (${user1.email})`);

    // Let's check how many profiles we have.
    // Ensure we have at least a few opposite-gender profiles seeded.
    const femaleProfilesCount = await Profile.countDocuments({ gender: 'female' });
    console.log(`✅ Profiles in DB: ${femaleProfilesCount} female profiles.`);

    // ─── TEST: FETCH DASHBOARD DATA ───
    console.log('\n⏳ Test 1: Fetching Dashboard Data (GET /profile/dashboard)...');
    const dashboardRes = await client.get('/profile/dashboard');

    if (!dashboardRes.data.success) {
      throw new Error(`Fetch dashboard failed: ${dashboardRes.data.message}`);
    }

    const { recentlyActive, premium, recommended, trending } = dashboardRes.data.data;
    
    console.log('✅ Dashboard Data fetched successfully!');
    console.log(`   Recently Active list: ${recentlyActive.length} profile(s)`);
    console.log(`   Premium Profiles list: ${premium.length} profile(s)`);
    console.log(`   Recommended Profiles list: ${recommended.length} profile(s)`);
    console.log(`   Trending Matches list: ${trending.length} profile(s)`);

    // Validate recommended match properties
    if (recommended.length > 0) {
      const topRec = recommended[0];
      console.log(`\n✅ Validating Recommended Profile schema:`);
      console.log(`   Name: ${topRec.name}`);
      console.log(`   Gender: ${topRec.gender}`);
      console.log(`   Match Score: ${topRec.matchScore}%`);
      console.log(`   Match Reasons: ${topRec.matchReasons?.join(', ')}`);
      if (topRec.matchScore === undefined || !Array.isArray(topRec.matchReasons)) {
        throw new Error('Verification failed: Recommended profile lacks matchScore or matchReasons.');
      }
    }

    // Validate premium structures
    if (premium.length > 0) {
      console.log(`\n✅ Validating Premium profile reference:`);
      console.log(`   Premium Name: ${premium[0].name}`);
    }

    console.log('\n🏆 ALL HOME DASHBOARD INTEGRATION TESTS PASSED SUCCESSFULLY! 🏆');

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
