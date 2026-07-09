import axios from 'axios';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Match } from '../models/Match';
import { InterestRequest } from '../models/InterestRequest';
import { Horoscope } from '../models/Horoscope';
import { MatchmakingService } from '../services/matchmaking.service';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Matchmaking System & Recommendation Tests...\n');

  try {
    // 1. Connect to MongoDB
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // ─── PART 1: UNIT TESTS FOR MATCHMAKING SERVICE ───
    console.log('\n--- PART 1: MatchmakingService Unit Tests ---');

    const searcherProfile = {
      name: 'Searcher User',
      gender: 'male',
      dob: new Date('1995-05-15'), // age 31 in 2026
      religion: 'Hindu',
      caste: 'Iyer',
      motherTongue: 'Tamil',
      location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
      education: { qualification: 'B.Tech' },
      income: 1500000,
      occupation: 'Software Engineer',
      preferences: {
        ageRange: { min: 25, max: 30 },
        locations: ['Chennai'],
        religions: ['Hindu'],
        minIncome: 1000000
      }
    };

    // Candidate 1: Perfect Match candidate
    const perfectCandidate = {
      name: 'Priya Iyer (Perfect Match)',
      gender: 'female',
      dob: new Date('1998-08-15'), // age 28 (matches age preference 25-30)
      religion: 'Hindu', // shares religion
      caste: 'Iyer', // shares caste
      motherTongue: 'Tamil', // shares mother tongue
      location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' }, // same city
      education: { qualification: 'B.Tech' }, // same education tier (tier 2)
      income: 1200000, // meets income preference
      occupation: 'IT Engineer', // working professional
      preferences: {
        minIncome: 1000000
      }
    };

    console.log('⏳ Running Case A: Perfect Compatibility Score...');
    const resultPerfect = MatchmakingService.calculateMatchScore(searcherProfile, perfectCandidate);
    console.log(`   Perfect Candidate Match Score: ${resultPerfect.score}/100`);
    console.log(`   Reasons: ${resultPerfect.reasons.join(' • ')}`);
    console.log(`   Breakdown:`, resultPerfect.breakdown);

    if (resultPerfect.score < 95) {
      throw new Error(`Expected Perfect Match score to be near 100, got ${resultPerfect.score}`);
    }
    console.log('✅ Perfect Match score calculation verified.');

    // Candidate 2: Partially Compatible candidate
    const partialCandidate = {
      name: 'Ananya Selvaraj (Partial Match)',
      gender: 'female',
      dob: new Date('1993-11-22'), // age 33 (outside preference 25-30 by 3 years)
      religion: 'Hindu', // shares religion
      caste: 'Pillai', // different caste
      motherTongue: 'Tamil', // shares mother tongue
      location: { city: 'Madurai', state: 'Tamil Nadu', country: 'India' }, // different city, same state
      education: { qualification: 'M.Sc' }, // different tier (tier 3 vs tier 2)
      income: 800000, // lower income
      occupation: 'Teacher', // working professional
      preferences: {
        minIncome: 500000
      }
    };

    console.log('\n⏳ Running Case B: Partial Compatibility Score...');
    const resultPartial = MatchmakingService.calculateMatchScore(searcherProfile, partialCandidate);
    console.log(`   Partial Candidate Match Score: ${resultPartial.score}/100`);
    console.log(`   Reasons: ${resultPartial.reasons.join(' • ')}`);
    console.log(`   Breakdown:`, resultPartial.breakdown);

    if (resultPartial.score >= 90 || resultPartial.score <= 40) {
      throw new Error(`Expected Partial Match score to be medium, got ${resultPartial.score}`);
    }
    console.log('✅ Partial Match score calculation verified.');

    // Candidate 3: Uncompatible candidate
    const poorCandidate = {
      name: 'Sarah Jones (Poor Match)',
      gender: 'female',
      dob: new Date('1985-02-10'), // age 41 (way outside preference)
      religion: 'Christian', // different religion
      caste: 'None', // different caste
      motherTongue: 'English', // different tongue
      location: { city: 'London', state: 'Greater London', country: 'United Kingdom' }, // different country
      education: { qualification: 'High School' }, // tier 1 vs tier 2
      income: 0, // no income
      occupation: 'Not Working', // not working
      preferences: {
        minIncome: 0
      }
    };

    console.log('\n⏳ Running Case C: Poor Compatibility Score...');
    const resultPoor = MatchmakingService.calculateMatchScore(searcherProfile, poorCandidate);
    console.log(`   Poor Candidate Match Score: ${resultPoor.score}/100`);
    console.log(`   Breakdown:`, resultPoor.breakdown);

    if (resultPoor.score > 35) {
      throw new Error(`Expected Poor Match score to be very low, got ${resultPoor.score}`);
    }
    console.log('✅ Poor Match score calculation verified.');


    // ─── PART 2: INTEGRATION TESTS FOR RECOMMENDATIONS & FILTERS ───
    console.log('\n--- PART 2: Recommendation & Filter Integration Tests ---');

    console.log('⏳ Provisioning mock users and profiles in MongoDB...');
    
    // Auto-provision 4 test accounts
    const clientMe = axios.create({ baseURL: BASE_URL, headers: { Authorization: 'Bearer mock_match_me' } });
    const clientOpp1 = axios.create({ baseURL: BASE_URL, headers: { Authorization: 'Bearer mock_match_opp1' } });
    const clientOpp2 = axios.create({ baseURL: BASE_URL, headers: { Authorization: 'Bearer mock_match_opp2' } });
    const clientOpp3 = axios.create({ baseURL: BASE_URL, headers: { Authorization: 'Bearer mock_match_opp3' } });

    await clientMe.get('/auth/me');
    await clientOpp1.get('/auth/me');
    await clientOpp2.get('/auth/me');
    await clientOpp3.get('/auth/me');

    const userMe = await User.findOne({ firebaseId: 'mock-user-uid-mock_match_me' });
    const userOpp1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_match_opp1' });
    const userOpp2 = await User.findOne({ firebaseId: 'mock-user-uid-mock_match_opp2' });
    const userOpp3 = await User.findOne({ firebaseId: 'mock-user-uid-mock_match_opp3' });

    if (!userMe || !userOpp1 || !userOpp2 || !userOpp3) {
      throw new Error('Failed to find provisioned integration mock users in DB.');
    }

    // Clean up previous test interactions
    await Match.deleteMany({
      $or: [
        { user1: { $in: [userMe._id, userOpp1._id, userOpp2._id, userOpp3._id] } },
        { user2: { $in: [userMe._id, userOpp1._id, userOpp2._id, userOpp3._id] } }
      ]
    });
    await InterestRequest.deleteMany({
      $or: [
        { sender: { $in: [userMe._id, userOpp1._id, userOpp2._id, userOpp3._id] } },
        { receiver: { $in: [userMe._id, userOpp1._id, userOpp2._id, userOpp3._id] } }
      ]
    });
    await Horoscope.deleteMany({
      user: { $in: [userMe._id, userOpp1._id, userOpp2._id, userOpp3._id] }
    });
    console.log('✅ Interactions and Horoscopes cleared.');

    // Save Profile: Searcher (Male looking for female in Chennai)
    const profileMe = await Profile.findOneAndUpdate(
      { user: userMe._id },
      {
        name: 'Karan Marshal',
        gender: 'male',
        dob: new Date('1994-06-15'),
        religion: 'Hindu',
        motherTongue: 'Tamil',
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        education: { qualification: 'B.Tech', fieldOfStudy: 'IT', college: 'Anna University' },
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai'],
          religions: ['Hindu']
        },
        income: 2000000,
        occupation: 'Lead Architect',
        isVerified: true
      },
      { upsert: true, new: true }
    );

    // Profile: Opp1 (Female, Chennai, compatible, Sevvai Dosham)
    const profileOpp1 = await Profile.findOneAndUpdate(
      { user: userOpp1._id },
      {
        name: 'Spotlight Priya',
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
        income: 1200000,
        occupation: 'Software Engineer',
        isVerified: true
      },
      { upsert: true, new: true }
    );

    // Profile: Opp2 (Female, Chennai, compatible, Swiped Exclude test)
    const profileOpp2 = await Profile.findOneAndUpdate(
      { user: userOpp2._id },
      {
        name: 'Swipe Exclude Ananya',
        gender: 'female',
        dob: new Date('1999-11-22'),
        religion: 'Hindu',
        motherTongue: 'Tamil',
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        education: { qualification: 'B.Tech' },
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai'],
          religions: ['Hindu']
        },
        income: 900000,
        occupation: 'Architect',
        isVerified: true
      },
      { upsert: true, new: true }
    );

    // Profile: Opp3 (Female, Chennai, compatible, Interest Exclude test)
    const profileOpp3 = await Profile.findOneAndUpdate(
      { user: userOpp3._id },
      {
        name: 'Interest Exclude Meera',
        gender: 'female',
        dob: new Date('1997-04-10'),
        religion: 'Hindu',
        motherTongue: 'Tamil',
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        education: { qualification: 'B.Tech' },
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai'],
          religions: ['Hindu']
        },
        income: 800000,
        occupation: 'Pianist',
        isVerified: true
      },
      { upsert: true, new: true }
    );

    // Create Horoscopes
    await Horoscope.create([
      {
        user: userOpp1._id,
        profile: profileOpp1._id,
        rashi: 'Simha (Leo)',
        nakshatra: 'Pooram',
        manglikStatus: 'yes',
        doshaDetails: { sevvaiDosham: true, raguKethuDosham: false },
        birthPlace: { city: 'Chennai', state: 'Tamil Nadu' },
        birthTime: '14:30',
        isVerified: true
      },
      {
        user: userOpp3._id,
        profile: profileOpp3._id,
        rashi: 'Mesha (Aries)',
        nakshatra: 'Ashwini',
        manglikStatus: 'no',
        doshaDetails: { sevvaiDosham: false, raguKethuDosham: true },
        birthPlace: { city: 'Chennai', state: 'Tamil Nadu' },
        birthTime: '09:15',
        isVerified: true
      }
    ]);

    console.log('✅ Mock Profiles and Horoscopes configured.');

    // --- TEST 2: GENDER SEGREGATION & QUEUE FETCH ---
    console.log('\n⏳ Test 2: Fetching Discovery Deck & Validating Gender Segregation...');
    const discoveryRes1 = await clientMe.get('/matches/discovery');
    
    if (!discoveryRes1.data.success) {
      throw new Error(`Discovery fetch failed: ${discoveryRes1.data.message}`);
    }

    const matches1 = discoveryRes1.data.data;
    console.log(`   Loaded matches: ${matches1.length} profile(s)`);
    
    // Assert all matches are female (opposite of Karan - male)
    for (const match of matches1) {
      if (match.gender !== 'female') {
        throw new Error(`Exclusion Violation: Male match returned to male searcher: ${match.name}`);
      }
    }
    console.log('✅ Verified: All recommended profiles are opposite gender.');

    // Assert Priya, Ananya, and Meera are inside recommendations
    const hasPriya = matches1.some((m: any) => m.user.toString() === userOpp1._id.toString());
    const hasAnanya = matches1.some((m: any) => m.user.toString() === userOpp2._id.toString());
    const hasMeera = matches1.some((m: any) => m.user.toString() === userOpp3._id.toString());

    if (!hasPriya || !hasAnanya || !hasMeera) {
      throw new Error('Verification failed: Candidate test profiles not present in recommendation list.');
    }
    console.log('✅ Verified: Eligible mock candidates successfully retrieved.');


    // --- TEST 3: SWIPED PROFILE EXCLUSION ---
    console.log('\n⏳ Test 3: Swiping card and checking deck exclusions...');
    
    // Swipe Opp2 (Ananya) -> "passed"
    const swipeRes = await clientMe.post('/matches/swipe', {
      targetProfileId: profileOpp2._id.toString(),
      action: 'passed'
    });

    if (!swipeRes.data.success) {
      throw new Error(`Swipe action failed: ${swipeRes.data.message}`);
    }
    console.log('✅ Registered pass swipe for Ananya.');

    // Re-fetch discovery deck
    const discoveryRes2 = await clientMe.get('/matches/discovery');
    const matches2 = discoveryRes2.data.data;

    const hasAnanyaAfterSwipe = matches2.some((m: any) => m.user.toString() === userOpp2._id.toString());
    if (hasAnanyaAfterSwipe) {
      throw new Error('Exclusion Violation: Swiped profile (Ananya) is still returned in recommendation deck!');
    }
    console.log('✅ Verified: Swiped profiles are correctly excluded from recommendations.');


    // --- TEST 4: INTEREST REQUEST EXCLUSION ---
    console.log('\n⏳ Test 4: Sending Interest Proposal and checking deck exclusions...');
    
    // Send Interest request to Opp3 (Meera)
    const interestRes = await clientMe.post('/matches/interest/send', {
      targetUserId: userOpp3._id.toString(),
      message: 'Hello, I like your profile.'
    });

    if (!interestRes.data.success) {
      throw new Error(`Interest send failed: ${interestRes.data.message}`);
    }
    console.log('✅ Registered proposal to Meera.');

    // Re-fetch discovery deck
    const discoveryRes3 = await clientMe.get('/matches/discovery');
    const matches3 = discoveryRes3.data.data;

    const hasMeeraAfterInterest = matches3.some((m: any) => m.user.toString() === userOpp3._id.toString());
    if (hasMeeraAfterInterest) {
      throw new Error('Exclusion Violation: Profile with active interest request (Meera) is still returned in recommendations!');
    }
    console.log('✅ Verified: Profiles with active interest requests are excluded from matches.');


    // --- TEST 5: PREFERENCE RELAXATION ---
    console.log('\n⏳ Test 5: Setting impossible preferences to verify Preference Relaxation...');
    
    // Configure userMe preferences to look for location 'NonExistentCity' with compatible ageRange
    await Profile.updateOne(
      { user: userMe._id },
      {
        preferences: {
          ageRange: { min: 25, max: 30 },
          locations: ['NonExistentCity'],
          religions: ['Hindu']
        }
      }
    );

    // Call discovery: strict query has 0 matches. Asserts relaxation kicks in and returns candidates
    const discoveryRes4 = await clientMe.get('/matches/discovery');
    const matches4 = discoveryRes4.data.data;
    console.log(`   Loaded matches after strict relaxation: ${matches4.length} profile(s)`);

    // Verify Spotlight Priya (which matches relaxed criteria) is returned!
    const hasPriyaRelaxed = matches4.some((m: any) => m.user.toString() === userOpp1._id.toString());
    if (!hasPriyaRelaxed || matches4.length === 0) {
      throw new Error('Verification failed: Preference relaxation did not relax queries or returned empty results.');
    }
    console.log('✅ Verified: Preference Relaxation triggers and loads relaxed candidate profiles.');

    // Reset userMe preferences back to normal Chennai query
    await Profile.updateOne(
      { user: userMe._id },
      {
        preferences: {
          ageRange: { min: 20, max: 35 },
          locations: ['Chennai'],
          religions: ['Hindu']
        }
      }
    );


    // ─── PART 3: ASTROLOGICAL FILTERING & SEARCH TESTS ───
    console.log('\n--- PART 3: Astrological Filtering & Search Tests ---');

    // Test A: Search by Sevvai Dosham
    console.log('⏳ Test A: Searching with astrological filter (sevvaiDosham: yes)...');
    const searchRes1 = await clientMe.post('/profile/search', {
      horoscope: { sevvaiDosham: 'yes' }
    });

    if (!searchRes1.data.success) {
      throw new Error(`Search sevvaiDosham failed: ${searchRes1.data.message}`);
    }

    const searchProfiles1 = searchRes1.data.data.profiles;
    console.log(`   Search results with Sevvai Dosham: ${searchProfiles1.length}`);

    const hasPriyaDosha = searchProfiles1.some((p: any) => p.user.toString() === userOpp1._id.toString());
    const hasMeeraDosha = searchProfiles1.some((p: any) => p.user.toString() === userOpp3._id.toString());

    if (!hasPriyaDosha) {
      throw new Error('Verification failed: Sevvai-Dosham-positive profile (Priya) not returned.');
    }
    if (hasMeeraDosha) {
      throw new Error('Verification failed: Sevvai-Dosham-negative profile (Meera) incorrectly returned.');
    }
    console.log('✅ Verified: Astrological sevvaiDosham filter correctly intersects profiles and horoscopes.');

    // Test B: Search by Rashi
    console.log('\n⏳ Test B: Searching with Rashi (rashi: Simha (Leo))...');
    const searchRes2 = await clientMe.post('/profile/search', {
      horoscope: { rashi: 'Simha (Leo)' }
    });
    
    const searchProfiles2 = searchRes2.data.data.profiles;
    console.log(`   Search results with Rashi: ${searchProfiles2.length}`);

    const hasPriyaRashi = searchProfiles2.some((p: any) => p.user.toString() === userOpp1._id.toString());
    const hasMeeraRashi = searchProfiles2.some((p: any) => p.user.toString() === userOpp3._id.toString());

    if (!hasPriyaRashi) {
      throw new Error('Verification failed: Leo-Rashi profile (Priya) not returned.');
    }
    if (hasMeeraRashi) {
      throw new Error('Verification failed: Aries-Rashi profile (Meera) incorrectly returned.');
    }
    console.log('✅ Verified: Astrological Rashi filter works correctly.');


    // ─── PART 4: PREMIUM SEARCH GATING LIMITS ───
    console.log('\n--- PART 4: Premium Search Gating Limits ---');

    // Test A: Free User using premium filters
    console.log('⏳ Test A: Free user triggering premium filters (caste)...');
    
    // Set userMe subscription to free
    userMe.subscription = { plan: 'free', status: 'inactive' };
    await userMe.save();

    const freeSearchRes = await clientMe.post('/profile/search', {
      caste: 'Iyer'
    });

    if (!freeSearchRes.data.success) {
      throw new Error(`Free Search failed: ${freeSearchRes.data.message}`);
    }

    const freeSearchPayload = freeSearchRes.data.data;
    console.log(`   Free Search Profiles returned: ${freeSearchPayload.profiles.length}`);
    console.log(`   Upgrade Required flag: ${freeSearchPayload.premiumUpgradeRequired}`);

    if (!freeSearchPayload.premiumUpgradeRequired) {
      throw new Error('Security Gating Failure: free account using premium filter did not set premiumUpgradeRequired.');
    }
    if (freeSearchPayload.profiles.length > 2) {
      throw new Error(`Security Gating Failure: free account using premium filter returned more than 2 profiles: ${freeSearchPayload.profiles.length}`);
    }
    console.log('✅ Verified: Free account searches are correctly capped at 2 matches with upgrade flags.');

    // Test B: Premium User using premium filters
    console.log('\n⏳ Test B: Premium user triggering premium filters (caste)...');
    
    // Upgrade userMe to Gold Plan
    userMe.subscription = { plan: 'gold', status: 'active' };
    await userMe.save();

    const premSearchRes = await clientMe.post('/profile/search', {
      caste: 'Iyer'
    });

    if (!premSearchRes.data.success) {
      throw new Error(`Premium Search failed: ${premSearchRes.data.message}`);
    }

    const premSearchPayload = premSearchRes.data.data;
    console.log(`   Premium Search Profiles returned: ${premSearchPayload.profiles.length}`);
    console.log(`   Upgrade Required flag: ${premSearchPayload.premiumUpgradeRequired}`);

    if (premSearchPayload.premiumUpgradeRequired) {
      throw new Error('Functional Failure: Premium account flagged as requiring upgrade.');
    }
    console.log('✅ Verified: Premium account searches return complete results with upgrade flags unset.');


    // ─── PART 5: API ROBUSTNESS & VALIDATION ───
    console.log('\n--- PART 5: API Robustness & Malformed Payloads ---');

    console.log('⏳ Test A: Sending invalid string income bounds...');
    const badIncomeRes = await clientMe.post('/profile/search', {
      minIncome: 'invalid-string',
      maxIncome: -5000
    });
    
    // Assert endpoint parses successfully and doesn't crash the server
    if (!badIncomeRes.data.success) {
      throw new Error(`Robustness check failed: endpoint crashed with bad income input`);
    }
    console.log('✅ Verified: Search endpoint handles invalid income criteria without crashing.');

    console.log('\n⏳ Test B: Sending empty search queries...');
    const emptyRes = await clientMe.post('/profile/search', {});
    if (!emptyRes.data.success) {
      throw new Error(`Robustness check failed: empty search query failed`);
    }
    console.log('✅ Verified: Search endpoint handles empty filters successfully.');

    console.log('\n🏆 ALL IRAIINAI MATCHMAKING & SYSTEM TESTS PASSED SUCCESSFULLY! 🏆');

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
