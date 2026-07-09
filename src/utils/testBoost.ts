import axios from 'axios';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { InterestRequest } from '../models/InterestRequest';
import { Match } from '../models/Match';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Premium Profile Boosting Integration Tests...\n');

  try {
    // Connect to database to verify setup
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // Trigger auto-provisioning for test users
    console.log('⏳ Triggering auto-provisioning for mock_user_1, mock_user_2, and mock_user_3...');
    
    const client1 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_1' },
    });

    const client2 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_2' },
    });

    const client3 = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: 'Bearer mock_user_3' },
    });

    // Make a dummy request to trigger provisioning
    await client1.get('/auth/me');
    await client2.get('/auth/me');
    await client3.get('/auth/me');
    console.log('✅ Mock users auto-provisioned.');

    // Fetch the provisioned user documents
    const user1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_1' });
    const user2 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_2' });
    const user3 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_3' });

    if (!user1 || !user2 || !user3) {
      throw new Error('Auto-provisioning failed to find mock users in MongoDB.');
    }

    console.log(`   User 1 (Male/Premium tester) ID: ${user1._id}`);
    console.log(`   User 2 (Female/Spotlight target) ID: ${user2._id}`);
    console.log(`   User 3 (Female/Regular candidate) ID: ${user3._id}`);

    // Set up profiles to ensure valid matches
    console.log('⏳ Setting up matching profiles and preferences in database...');
    
    // User 1 profile (Male looking for Hindu female in Chennai/Madurai, age 20-35)
    await Profile.findOneAndUpdate(
      { user: user1._id },
      {
        name: 'Arjun Sundar',
        gender: 'male',
        dob: new Date('1995-05-15'),
        religion: 'Hindu',
        motherTongue: 'Tamil',
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        education: { qualification: 'B.Tech', fieldOfStudy: 'Computer Science', college: 'Anna University' },
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai', 'Madurai'],
          religions: ['Hindu']
        },
        isVerified: true
      },
      { upsert: true }
    );

    // User 2 profile (Female, Spotlight candidate)
    await Profile.findOneAndUpdate(
      { user: user2._id },
      {
        name: 'Spotlight Match Priya',
        gender: 'female',
        dob: new Date('1998-08-15'),
        religion: 'Hindu',
        motherTongue: 'Tamil',
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        education: { qualification: 'B.Tech', fieldOfStudy: 'IT', college: 'Anna University' },
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai'],
          religions: ['Hindu']
        },
        isVerified: true
      },
      { upsert: true }
    );

    // User 3 profile (Female, Regular candidate)
    await Profile.findOneAndUpdate(
      { user: user3._id },
      {
        name: 'Regular Match Ananya',
        gender: 'female',
        dob: new Date('1999-11-22'),
        religion: 'Hindu',
        motherTongue: 'Tamil',
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        education: { qualification: 'B.Tech', fieldOfStudy: 'IT', college: 'Anna University' },
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai'],
          religions: ['Hindu']
        },
        isVerified: true
      },
      { upsert: true }
    );

    // Clear any active boosts and interactions to prevent exclusions
    await InterestRequest.deleteMany({
      $or: [
        { sender: { $in: [user1._id, user2._id, user3._id] } },
        { receiver: { $in: [user1._id, user2._id, user3._id] } }
      ]
    });
    await Match.deleteMany({
      $or: [
        { user1: { $in: [user1._id, user2._id, user3._id] } },
        { user2: { $in: [user1._id, user2._id, user3._id] } }
      ]
    });

    await Profile.updateMany(
      { user: { $in: [user1._id, user2._id, user3._id] } },
      { $unset: { boost: "" } }
    );
    console.log('✅ Profiles and preferences configured, active boosts and interactions cleared.');

    // ─── TEST 1: FREE TRIAL BOOST ACTIVATION ───
    console.log('\n⏳ Test 1: Activating Free Trial Boost (should last 1 hour)...');
    
    // Set user 1 to free status
    user1.subscription = { plan: 'free', status: 'inactive' };
    await user1.save();

    const freeBoostRes = await client1.post('/profile/boost/activate', {
      boostType: 'spotlight'
    });

    if (!freeBoostRes.data.success) {
      throw new Error(`Free trial boost activation failed: ${freeBoostRes.data.message}`);
    }

    console.log('✅ Free boost activation returned success!');
    console.log(`   Duration: ${freeBoostRes.data.data.boostDurationHours} hour(s)`);
    console.log(`   Upgrade Required: ${freeBoostRes.data.data.premiumUpgradeRequired}`);
    console.log(`   Expiration: ${freeBoostRes.data.data.boostExpiresAt}`);

    if (freeBoostRes.data.data.boostDurationHours !== 1) {
      throw new Error(`Expected free boost duration to be 1 hour, got ${freeBoostRes.data.data.boostDurationHours}`);
    }
    if (!freeBoostRes.data.data.premiumUpgradeRequired) {
      throw new Error('Expected premiumUpgradeRequired to be true for free trial boost.');
    }

    // Verify DB update
    const dbProfile1Free = await Profile.findOne({ user: user1._id });
    if (!dbProfile1Free?.boost?.isBoosted || dbProfile1Free.boost.boostType !== 'spotlight') {
      throw new Error('Verification failed: Boost status not correctly updated in MongoDB.');
    }
    console.log('✅ Verified free boost status stored in Database.');


    // ─── TEST 2: PREMIUM BOOST ACTIVATION ───
    console.log('\n⏳ Test 2: Activating Premium Boost (should last 24 hours)...');
    
    // Upgrade user 1 to platinum plan
    user1.subscription = {
      plan: 'platinum',
      status: 'active',
      expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    };
    await user1.save();

    const premiumBoostRes = await client1.post('/profile/boost/activate', {
      boostType: 'trending'
    });

    if (!premiumBoostRes.data.success) {
      throw new Error(`Premium boost activation failed: ${premiumBoostRes.data.message}`);
    }

    console.log('✅ Premium boost activation returned success!');
    console.log(`   Duration: ${premiumBoostRes.data.data.boostDurationHours} hour(s)`);
    console.log(`   Upgrade Required: ${premiumBoostRes.data.data.premiumUpgradeRequired}`);
    console.log(`   Expiration: ${premiumBoostRes.data.data.boostExpiresAt}`);

    if (premiumBoostRes.data.data.boostDurationHours !== 24) {
      throw new Error(`Expected premium boost duration to be 24 hours, got ${premiumBoostRes.data.data.boostDurationHours}`);
    }
    if (premiumBoostRes.data.data.premiumUpgradeRequired) {
      throw new Error('Expected premiumUpgradeRequired to be false for active platinum plan.');
    }

    // Verify DB update
    const dbProfile1Premium = await Profile.findOne({ user: user1._id });
    if (!dbProfile1Premium?.boost?.isBoosted || dbProfile1Premium.boost.boostType !== 'trending') {
      throw new Error('Verification failed: Premium boost status not updated in MongoDB.');
    }
    console.log('✅ Verified premium boost status stored in Database.');


    // ─── TEST 3: SPOTLIGHT CAROUSEL ON DASHBOARD ───
    console.log('\n⏳ Test 3: Checking Spotlight Profiles on Home Dashboard...');
    
    // Set user 2 to be boosted to spotlight (valid for 2 hours)
    const expiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
    await Profile.updateOne(
      { user: user2._id },
      {
        boost: {
          isBoosted: true,
          boostExpiresAt: expiry,
          boostType: 'spotlight'
        }
      }
    );

    // Call Dashboard endpoint as user 1 with cache buster
    const dashboardRes = await client1.get(`/profile/dashboard?t=${Date.now()}`);
    if (!dashboardRes.data.success) {
      throw new Error(`Dashboard fetch failed: ${dashboardRes.data.message}`);
    }

    const { spotlight, recommended } = dashboardRes.data.data;
    console.log(`✅ Dashboard data loaded.`);
    console.log(`   Spotlight list size: ${spotlight.length}`);

    // User 2 (Priya) should be in spotlight, User 3 (Ananya) should NOT be in spotlight
    const isPriyaInSpotlight = spotlight.some((p: any) => p.user.toString() === user2._id.toString());
    const isAnanyaInSpotlight = spotlight.some((p: any) => p.user.toString() === user3._id.toString());

    if (!isPriyaInSpotlight) {
      throw new Error('Verification failed: Boosted spotlight user (Priya) not found in spotlight profiles.');
    }
    if (isAnanyaInSpotlight) {
      throw new Error('Verification failed: Non-boosted user (Ananya) incorrectly included in spotlight profiles.');
    }
    console.log('✅ Verified that only spotlight-boosted users appear in the Spotlight section.');


    // ─── TEST 4: MATCH DISCOVERY QUEUE RANK BUBBLING ───
    console.log('\n⏳ Test 4: Checking Discovery Deck Rank Bubbling Logic...');
    
    // Fetch discovery matches for user 1
    const discoveryRes = await client1.get('/matches/discovery');
    if (!discoveryRes.data.success) {
      throw new Error(`Discovery deck fetch failed: ${discoveryRes.data.message}`);
    }

    const matches = discoveryRes.data.data;
    console.log(`✅ Discovery matches loaded. Total profiles: ${matches.length}`);

    // Verify rank score calculation and sorting
    const priyaMatch = matches.find((m: any) => m.user.toString() === user2._id.toString());
    const ananyaMatch = matches.find((m: any) => m.user.toString() === user3._id.toString());

    if (!priyaMatch || !ananyaMatch) {
      throw new Error('Verification failed: Did not find both Priya and Ananya in discovery response.');
    }

    console.log(`   Priya Match Score: ${priyaMatch.matchScore}% | Rank Score: ${priyaMatch.rankScore} (Spotlight Boosted)`);
    console.log(`   Ananya Match Score: ${ananyaMatch.matchScore}% | Rank Score: ${ananyaMatch.rankScore} (Not Boosted)`);

    // Verify Priya's rankScore is matchScore + 20
    if (priyaMatch.rankScore !== priyaMatch.matchScore + 20) {
      throw new Error(`Priya rankScore is incorrect: expected ${priyaMatch.matchScore + 20}, got ${priyaMatch.rankScore}`);
    }

    // Verify Ananya's rankScore equals matchScore (since not boosted)
    if (ananyaMatch.rankScore !== ananyaMatch.matchScore) {
      throw new Error(`Ananya rankScore is incorrect: expected ${ananyaMatch.matchScore}, got ${ananyaMatch.rankScore}`);
    }

    // Verify Priya is sorted above Ananya (unless Ananya's natural score is > 20% higher, but they have similar fields, so they are close)
    const priyaIndex = matches.findIndex((m: any) => m.user.toString() === user2._id.toString());
    const ananyaIndex = matches.findIndex((m: any) => m.user.toString() === user3._id.toString());

    if (priyaIndex > ananyaIndex) {
      throw new Error(`Sorting logic failed: Boosted user (index ${priyaIndex}) is ranked below regular user (index ${ananyaIndex})`);
    }

    console.log('✅ Verified that Spotlight boosts correctly adjust rankScore sorting (+20 weight) and bubble matches up.');

    console.log('\n🏆 ALL PREMIUM PROFILE BOOSTING INTEGRATION TESTS PASSED SUCCESSFULLY! 🏆');

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
