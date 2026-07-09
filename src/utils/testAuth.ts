import axios from 'axios';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { DeviceSession } from '../models/DeviceSession';
import { Profile } from '../models/Profile';
import { Otp } from '../models/Otp';
import { ENV } from '../config/env';

const BASE_URL = 'http://localhost:5000/api/v1';

const runTests = async () => {
  console.log('🚀 Starting IraiInai Passwordless Authentication & Session Security Lifecycle Tests...\n');

  try {
    // ─── SETUP & CLEANUP ───
    console.log('⏳ Connecting to MongoDB for cleanup...');
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    const testPhone = '+919999999999';
    const testEmail = 'test-auth-user@iraiinai.com';

    // Delete existing test data
    const existingUsers = await User.find({
      $or: [{ phone: testPhone }, { email: testEmail }]
    });

    if (existingUsers.length > 0) {
      const userIds = existingUsers.map(u => u._id);
      await User.deleteMany({ _id: { $in: userIds } });
      await Profile.deleteMany({ user: { $in: userIds } });
      await DeviceSession.deleteMany({ userId: { $in: userIds } });
      console.log(`🧹 Cleaned up ${existingUsers.length} existing test user(s) and their sessions.`);
    }

    await Otp.deleteMany({ identifier: { $in: [testPhone, testEmail] } });
    console.log('🧹 Cleaned up OTP codes.\n');

    // ─── 1. PHONE OTP REQUEST ───
    console.log('⏳ Test 1: Request Phone OTP...');
    const reqOtpRes = await axios.post(`${BASE_URL}/auth/request-otp`, {
      phone: testPhone
    });
    if (reqOtpRes.data.success) {
      console.log('✅ Phone OTP requested successfully!');
    } else {
      throw new Error('Phone OTP request failed.');
    }

    // Verify OTP record exists in DB
    const phoneOtpRecord = await Otp.findOne({ identifier: testPhone, channel: 'phone' });
    if (!phoneOtpRecord) {
      throw new Error('Phone OTP record not found in MongoDB.');
    }
    console.log(`   OTP code generated in DB: ${phoneOtpRecord.otp}\n`);

    // ─── 2. PHONE OTP VERIFICATION & REGISTRATION ───
    console.log('⏳ Test 2: Verify Phone OTP (Confirming login & session creation)...');
    const verifyOtpRes = await axios.post(`${BASE_URL}/auth/verify-otp`, {
      phone: testPhone,
      code: '123456', // using universal bypass code
      deviceId: 'test-device-phone-999',
      deviceName: 'Pixel 8 Simulator',
      os: 'Android'
    });

    if (!verifyOtpRes.data.success) {
      throw new Error(`OTP verification failed: ${verifyOtpRes.data.message}`);
    }

    const { accessToken, refreshToken, user: loggedInUser } = verifyOtpRes.data.data;
    console.log('✅ Authenticated successfully!');
    console.log(`   User ID: ${loggedInUser._id}`);
    console.log(`   User Phone: ${loggedInUser.phone}`);
    console.log(`   Access Token: ${accessToken.substring(0, 25)}...`);
    console.log(`   Refresh Token: ${refreshToken.substring(0, 25)}...\n`);

    const authClient = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    // ─── 3. FETCH PROFILE & SESSION INFO (/auth/me) ───
    console.log('⏳ Test 3: Load active session profile (/auth/me)...');
    const meRes = await authClient.get('/auth/me');
    if (meRes.data.success && meRes.data.data.phone === testPhone) {
      console.log('✅ User session loaded correctly!\n');
    } else {
      throw new Error('Failed to load user session.');
    }

    // ─── 4. DEVICE SESSION LISTING (/auth/devices) ───
    console.log('⏳ Test 4: Retrieve active device sessions...');
    const devicesRes = await authClient.get('/auth/devices');
    const devices = devicesRes.data.data;
    if (devices.length === 1 && devices[0].deviceId === 'test-device-phone-999') {
      console.log('✅ Active devices retrieved successfully!');
      console.log(`   Active Device: ${devices[0].deviceName} (${devices[0].os})`);
      console.log(`   IP Address: ${devices[0].ipAddress}\n`);
    } else {
      throw new Error('Device session list incorrect.');
    }

    // ─── 5. TOKEN REFRESH ROTATION ───
    console.log('⏳ Test 5: Refreshing session (Rotating tokens)...');
    const refreshRes = await axios.post(`${BASE_URL}/auth/refresh`, {
      refreshToken,
      deviceId: 'test-device-phone-999'
    });

    if (!refreshRes.data.success) {
      throw new Error(`Token refresh failed: ${refreshRes.data.message}`);
    }

    const { accessToken: newAccess, refreshToken: newRefresh } = refreshRes.data.data;
    console.log('✅ Tokens successfully rotated!');
    console.log(`   New Access Token: ${newAccess.substring(0, 25)}...`);
    console.log(`   New Refresh Token: ${newRefresh.substring(0, 25)}...\n`);

    // ─── 6. REPLAY ATTACK DETECTION (Security Invalidation) ───
    console.log('⏳ Test 6: Replaying old (rotated) refresh token...');
    console.log('   (Backend should detect token reuse, revoke all sessions, and reject with 403)');
    try {
      await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken, // presenting the OLD refresh token
        deviceId: 'test-device-phone-999'
      });
      throw new Error('Replay attack was not blocked! Security vulnerability detected.');
    } catch (err: any) {
      if (err.response?.status === 403) {
        console.log('✅ Replay attack successfully blocked with 403 Forbidden!');
      } else {
        throw err;
      }
    }
    // Verify all sessions were indeed revoked
    console.log('\n⏳ Test 6b: Verifying session containment (New/rotated tokens should now be invalid)...');
    try {
      await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken: newRefresh, // new token should also be revoked now
        deviceId: 'test-device-phone-999'
      });
      throw new Error('New refresh token is still valid. Session containment failed.');
    } catch (err: any) {
      if (err.response?.status === 403) {
        console.log('✅ Session containment verified. New tokens correctly revoked!\n');
      } else {
        throw err;
      }
    }

    // ─── 7. EMAIL OTP FLOW ───
    console.log('⏳ Test 7: Request Email OTP...');
    const reqEmailRes = await axios.post(`${BASE_URL}/auth/request-email-otp`, {
      email: testEmail
    });
    if (reqEmailRes.data.success) {
      console.log('✅ Email OTP requested successfully!');
    } else {
      throw new Error('Email OTP request failed.');
    }

    // Verify OTP record exists in DB
    const emailOtpRecord = await Otp.findOne({ identifier: testEmail, channel: 'email' });
    if (!emailOtpRecord) {
      throw new Error('Email OTP record not found in MongoDB.');
    }
    console.log(`   Email OTP generated in DB: ${emailOtpRecord.otp}`);

    console.log('⏳ Test 7b: Verify Email OTP...');
    const verifyEmailRes = await axios.post(`${BASE_URL}/auth/verify-email-otp`, {
      email: testEmail,
      code: '123456',
      deviceId: 'test-device-email-888',
      deviceName: 'iPhone 15 Simulator',
      os: 'iOS'
    });
    if (verifyEmailRes.data.success) {
      console.log('✅ Email OTP verified successfully!');
    } else {
      throw new Error('Email OTP verification failed.');
    }

    const emailUserAccessToken = verifyEmailRes.data.data.accessToken;
    const emailClient = axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${emailUserAccessToken}` }
    });

    // Verify we can access active devices of this email user
    const emailDevicesRes = await emailClient.get('/auth/devices');
    console.log(`   Email User active devices: ${emailDevicesRes.data.data.length}\n`);

    // ─── 8. DEVICE SESSION REVOCATION ───
    console.log('⏳ Test 8: Revoking device session (DELETE /auth/devices/:deviceId)...');
    const revokeRes = await emailClient.delete(`/auth/devices/test-device-email-888`);
    if (revokeRes.data.success) {
      console.log('✅ Device session revoked successfully!');
    } else {
      throw new Error('Failed to revoke device session.');
    }

    // Verify that access token is now invalid (since session was revoked)
    console.log('⏳ Test 8b: Verifying access token rejection after revocation...');
    try {
      await emailClient.get('/auth/me');
      throw new Error('Access token was not rejected after session revocation!');
    } catch (err: any) {
      if (err.response?.status === 401 || err.response?.status === 403) {
        console.log(`✅ Access denied as expected: ${err.response.status} (${err.response.data.message})`);
      } else {
        throw err;
      }
    }

    // ─── 9. LOGOUT ───
    console.log('\n⏳ Test 9: Logging out of a fresh phone login session...');
    const reLoginRes = await axios.post(`${BASE_URL}/auth/verify-otp`, {
      phone: testPhone,
      code: '123456',
      deviceId: 'test-device-phone-final',
      deviceName: 'Test Phone final'
    });
    const finalRefreshToken = reLoginRes.data.data.refreshToken;

    const logoutRes = await axios.post(`${BASE_URL}/auth/logout`, {
      refreshToken: finalRefreshToken
    });
    if (logoutRes.data.success) {
      console.log('✅ Logout completed successfully!');
    } else {
      throw new Error('Logout request failed.');
    }

    // Verify refresh token is invalid
    console.log('⏳ Test 9b: Verifying token refresh fails after logout...');
    try {
      await axios.post(`${BASE_URL}/auth/refresh`, {
        refreshToken: finalRefreshToken,
        deviceId: 'test-device-phone-final'
      });
      throw new Error('Token refresh succeeded after logout!');
    } catch (err: any) {
      if (err.response?.status === 403) {
        console.log('✅ Refresh token rejected with 403 as expected after logout.');
      } else {
        throw err;
      }
    }

    console.log('\n🏆 ALL PASSWORDLESS AUTHENTICATION & LIFE-CYCLE TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
    if (error.response) {
      console.error(`   Status Code: ${error.response.status}`);
      console.error(`   Response Message:`, error.response.data);
    }
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
  }
};

runTests();
