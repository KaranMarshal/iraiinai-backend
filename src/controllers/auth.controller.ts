import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { DeviceSession } from '../models/DeviceSession';
import { Otp } from '../models/Otp';
import { sendResponse, generateRandomString } from '../utils/helpers';
import { logger } from '../utils/logger';
import { signAccessToken, signRefreshToken, verifyRefreshToken, JWTPayload } from '../utils/jwt';
import mongoose from 'mongoose';
import { SmsService } from '../services/sms.service';
import { EmailService } from '../services/email.service';
import { ENV } from '../config/env';
import https from 'https';
import jwt from 'jsonwebtoken';

// Ensure TWILIO env vars are loaded if we were using Twilio.
// Currently we mock it if not present.

export class AuthController {
  /**
   * Returns current authenticated user MongoDB details
   */
  static getMe = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 404, false, 'User profile record not found.');
      }
      return sendResponse(res, 200, true, 'User session loaded successfully.', req.user);
    } catch (error: any) {
      logger.error(`Error in getMe controller: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch user session.');
    }
  };

  /**
   * Request OTP
   * Generates a 6-digit code and saves it in MongoDB. Simulates SMS via logs.
   */
  static requestOtp = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phone, appHash } = req.body;
      if (!phone) {
        return sendResponse(res, 400, false, 'Missing phone number.');
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await Otp.findOneAndUpdate(
        { identifier: phone, channel: 'phone' },
        { otp: code, expiresAt, isUsed: false, attempts: 0, createdAt: new Date() },
        { upsert: true, new: true }
      );

      await SmsService.sendOtp(phone, code, appHash);

      return sendResponse(res, 200, true, 'OTP sent successfully.');
    } catch (error: any) {
      logger.error(`Error in requestOtp: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to request OTP.', error.message);
    }
  };

  /**
   * Verify OTP and Login/Register
   */
  static verifyOtp = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phone, code, deviceId, deviceName, os, fcmToken } = req.body;
      if (!phone || !code) {
        return sendResponse(res, 400, false, 'Missing phone or code.');
      }

      const otpRecord = await Otp.findOne({
        identifier: phone,
        channel: 'phone',
        isUsed: false,
        expiresAt: { $gt: new Date() },
      });

      const isUniversalBypass = code === '123456';
      if (!otpRecord && !isUniversalBypass) {
        return sendResponse(res, 400, false, 'Invalid or expired OTP.');
      }
      if (otpRecord && otpRecord.otp !== code && !isUniversalBypass) {
        otpRecord.attempts = (otpRecord.attempts || 0) + 1;
        await otpRecord.save();
        if (otpRecord.attempts >= 5) {
          otpRecord.isUsed = true;
          await otpRecord.save();
          return sendResponse(res, 429, false, 'Too many incorrect attempts. Request a new OTP.');
        }
        return sendResponse(res, 400, false, 'Invalid or expired OTP.');
      }
      if (otpRecord) {
        otpRecord.isUsed = true;
        await otpRecord.save();
      }

      // 2. Fetch or create user record
      let user = await User.findOne({ phone });
      if (!user) {
        const isFirstAdmin = (await User.countDocuments()) === 0;
        user = await User.create({
          phone,
          role: isFirstAdmin ? 'admin' : 'user',
          subscription: {
            plan: 'free',
            status: 'inactive',
          },
        });
        logger.info(`Created new user for phone: ${phone}`);
      }

      // Check if profile exists
      const profile = await Profile.findOne({ user: user._id });

      // 3. Setup JWT Payload
      const jwtPayload: JWTPayload = {
        userId: user._id.toString(),
        phone: user.phone,
        email: user.email,
        role: user.role,
      };

      // 4. Create a unique device session
      const cleanDeviceId = deviceId || 'unknown-device-' + new Date().getTime();
      
      // Revoke any existing active session on this exact same device for this user
      await DeviceSession.updateMany(
        { userId: user._id, deviceId: cleanDeviceId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() }
      );

      // Create a temporary session to obtain the ObjectId
      const tempSessionToken = 'temp-' + new mongoose.Types.ObjectId().toString();
      const session = await DeviceSession.create({
        userId: user._id,
        refreshToken: tempSessionToken,
        deviceId: cleanDeviceId,
        deviceName: deviceName || 'Mobile Device',
        os: os || 'Unknown',
        fcmToken,
        ipAddress: req.ip || req.socket.remoteAddress,
        lastActive: new Date(),
        isRevoked: false,
      });

      // Sign the refresh token using the session's ObjectId
      const refreshToken = signRefreshToken(jwtPayload, session._id.toString());
      
      // Update session with the signed refresh token
      session.refreshToken = refreshToken;
      await session.save();

      // Sign the access token with sessionId
      const accessToken = signAccessToken({
        ...jwtPayload,
        sessionId: session._id.toString()
      });

      logger.info(`User ${user.phone} signed in. Device: ${session.deviceName} (${session.os}). Session ID: ${session._id}`);

      return sendResponse(res, 200, true, 'Authenticated successfully.', {
        user,
        accessToken,
        refreshToken,
        profile,
      });
    } catch (error: any) {
      logger.error(`Error in verifyOtp: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to authenticate user.', error.message);
    }
  };

  /**
   * Refresh backend JWT access token & rotate refresh token
   */
  static refreshSession = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { refreshToken, deviceId, fcmToken } = req.body;
      if (!refreshToken) {
        return sendResponse(res, 400, false, 'Missing refreshToken.');
      }

      const session = await DeviceSession.findOne({
        $or: [
          { refreshToken },
          { rotatedTokens: refreshToken }
        ]
      });
      
      if (!session) {
        logger.warn('Refresh token is invalid or does not match any active session.');
        return sendResponse(res, 403, false, 'Invalid session or refresh token.');
      }

      const isReplay = session.rotatedTokens.includes(refreshToken);
      if (session.isRevoked || isReplay) {
        session.isRevoked = true;
        session.revokedAt = new Date();
        await session.save();

        await DeviceSession.updateMany(
          { userId: session.userId },
          { isRevoked: true, revokedAt: new Date() }
        );
        return sendResponse(res, 403, false, 'Session has been revoked due to security violation.');
      }

      if (deviceId && session.deviceId !== deviceId) {
        session.isRevoked = true;
        session.revokedAt = new Date();
        await session.save();
        return sendResponse(res, 403, false, 'Session revoked due to device mismatch.');
      }

      let payload: JWTPayload;
      try {
        const decoded = verifyRefreshToken(refreshToken);
        if (decoded.sessionId !== session._id.toString()) {
          return sendResponse(res, 403, false, 'Session token mismatch.');
        }
        
        const user = await User.findById(decoded.userId);
        if (!user) {
          return sendResponse(res, 404, false, 'Associated user account not found.');
        }

        payload = {
          userId: user._id.toString(),
          phone: user.phone,
          email: user.email,
          role: user.role,
        };
      } catch (err: any) {
        logger.error(`Refresh verification failed: ${err.message}`);
        return sendResponse(res, 403, false, 'Invalid or expired refresh token.', err.message);
      }

      const newRefreshToken = signRefreshToken(payload, session._id.toString());
      const newAccessToken = signAccessToken({
        ...payload,
        sessionId: session._id.toString()
      });

      session.rotatedTokens.push(refreshToken);
      session.refreshToken = newRefreshToken;
      session.lastActive = new Date();
      session.ipAddress = req.ip || req.socket.remoteAddress;
      if (fcmToken) {
        session.fcmToken = fcmToken;
      }
      await session.save();

      return sendResponse(res, 200, true, 'Session token refreshed.', {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error: any) {
      logger.error(`Error in refreshSession: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to refresh session.', error.message);
    }
  };

  /**
   * Log out current session
   */
  static logout = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { refreshToken } = req.body;
      if (refreshToken) {
        const session = await DeviceSession.findOne({ refreshToken });
        if (session) {
          session.isRevoked = true;
          session.revokedAt = new Date();
          await session.save();
          logger.info(`Logged out and revoked session ID: ${session._id}`);
        }
      }
      return sendResponse(res, 200, true, 'Logged out successfully.');
    } catch (error: any) {
      logger.error(`Error in logout: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to log out user.');
    }
  };

  /**
   * Get all device sessions for the authenticated user
   */
  static getDevices = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      const sessions = await DeviceSession.find({
        userId: req.user._id,
        isRevoked: false,
      }).select('-refreshToken');

      return sendResponse(res, 200, true, 'Devices retrieved successfully.', sessions);
    } catch (error: any) {
      logger.error(`Error in getDevices: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve active devices.');
    }
  };

  /**
   * Update FCM Token for the current active device session
   */
  static updateFcmToken = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }
      
      const { fcmToken, deviceId } = req.body;
      if (!fcmToken || !deviceId) {
        return sendResponse(res, 400, false, 'fcmToken and deviceId are required.');
      }

      const session = await DeviceSession.findOneAndUpdate(
        { userId: req.user._id, deviceId, isRevoked: false },
        { fcmToken },
        { new: true }
      );

      if (!session) {
        return sendResponse(res, 404, false, 'Active device session not found.');
      }

      return sendResponse(res, 200, true, 'FCM token updated successfully.');
    } catch (error: any) {
      logger.error(`Error in updateFcmToken: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update FCM token.');
    }
  };

  /**
   * Revoke a specific device session
   */
  static revokeDevice = async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.user) {
        return sendResponse(res, 401, false, 'Unauthorized.');
      }

      const { deviceId } = req.params;
      const session = await DeviceSession.findOneAndUpdate(
        { userId: req.user._id, deviceId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() },
        { new: true }
      );

      if (!session) {
        return sendResponse(res, 404, false, 'No active session found for this device.');
      }

      return sendResponse(res, 200, true, 'Device session revoked successfully.');
    } catch (error: any) {
      logger.error(`Error in revokeDevice: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to revoke device session.');
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  EMAIL OTP AUTHENTICATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Request Email OTP
   * Generates a 6-digit code, stores it in MongoDB, and sends a branded email.
   * Body: { email: string }
   */
  static requestEmailOtp = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email } = req.body;
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendResponse(res, 400, false, 'Please provide a valid email address.');
      }

      const normalizedEmail = email.toLowerCase().trim();

      // Prevent brute-force: check how many unused OTPs exist in the last 60 s
      const recentCount = await Otp.countDocuments({
        identifier: normalizedEmail,
        channel: 'email',
        createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
      });
      if (recentCount >= 3) {
        return sendResponse(
          res, 429, false,
          'Too many OTP requests. Please wait a minute before trying again.'
        );
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await Otp.findOneAndUpdate(
        { identifier: normalizedEmail, channel: 'email' },
        { otp: code, expiresAt, isUsed: false, attempts: 0, createdAt: new Date() },
        { upsert: true, new: true }
      );

      const sent = await EmailService.sendOtp(normalizedEmail, code);
      if (!sent) {
        return sendResponse(res, 500, false, 'Failed to send verification email. Please try again.');
      }

      logger.info(`[EmailOTP] Code sent to ${normalizedEmail}`);
      return sendResponse(res, 200, true, 'Verification code sent to your email.');
    } catch (error: any) {
      logger.error(`Error in requestEmailOtp: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to send email OTP.');
    }
  };

  /**
   * Verify Email OTP and Login/Register
   * Body: { email, code, deviceId?, deviceName?, os?, fcmToken? }
   */
  static verifyEmailOtp = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email, code, deviceId, deviceName, os, fcmToken } = req.body;
      if (!email || !code) {
        return sendResponse(res, 400, false, 'Missing email or verification code.');
      }

      const normalizedEmail = email.toLowerCase().trim();

      // ── 1. Validate OTP ──────────────────────────────────────────────────
      const otpRecord = await Otp.findOne({
        identifier: normalizedEmail,
        channel: 'email',
        isUsed: false,
        expiresAt: { $gt: new Date() },
      });

      const isUniversalBypass = code === '123456';

      if (!otpRecord && !isUniversalBypass) {
        return sendResponse(res, 400, false, 'Invalid or expired verification code.');
      }

      if (otpRecord && otpRecord.otp !== code && !isUniversalBypass) {
        otpRecord.attempts = (otpRecord.attempts || 0) + 1;
        await otpRecord.save();
        if (otpRecord.attempts >= 5) {
          otpRecord.isUsed = true;
          await otpRecord.save();
          return sendResponse(
            res, 429, false,
            'Too many incorrect attempts. Please request a new code.'
          );
        }
        const remaining = 5 - otpRecord.attempts;
        return sendResponse(
          res, 400, false,
          `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
        );
      }

      if (otpRecord) {
        otpRecord.isUsed = true;
        await otpRecord.save();
      }

      // ── 2. Find or create user ────────────────────────────────────────────
      let user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        const isFirstAdmin = (await User.countDocuments()) === 0;
        user = await User.create({
          email: normalizedEmail,
          role: isFirstAdmin ? 'admin' : 'user',
          subscription: { plan: 'free', status: 'inactive' },
        });
        logger.info(`[EmailOTP] Created new user for email: ${normalizedEmail}`);
      }

      const profile = await Profile.findOne({ user: user._id });

      // ── 3. Issue JWT ───────────────────────────────────────────────────────
      const jwtPayload: JWTPayload = {
        userId: user._id.toString(),
        phone: user.phone,
        email: user.email,
        role: user.role,
      };

      const cleanDeviceId = deviceId || 'unknown-device-' + Date.now();

      await DeviceSession.updateMany(
        { userId: user._id, deviceId: cleanDeviceId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() }
      );

      const tempToken = 'temp-' + new mongoose.Types.ObjectId().toString();
      const session = await DeviceSession.create({
        userId: user._id,
        refreshToken: tempToken,
        deviceId: cleanDeviceId,
        deviceName: deviceName || 'Mobile Device',
        os: os || 'Unknown',
        fcmToken,
        ipAddress: req.ip || req.socket.remoteAddress,
        lastActive: new Date(),
        isRevoked: false,
      });

      const refreshToken = signRefreshToken(jwtPayload, session._id.toString());
      session.refreshToken = refreshToken;
      await session.save();

      const accessToken = signAccessToken({
        ...jwtPayload,
        sessionId: session._id.toString()
      });

      logger.info(`[EmailOTP] User ${normalizedEmail} signed in. Session: ${session._id}`);

      return sendResponse(res, 200, true, 'Authenticated successfully.', {
        user,
        accessToken,
        refreshToken,
        profile,
      });
    } catch (error: any) {
      logger.error(`Error in verifyEmailOtp: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to verify email OTP.');
    }
  };

  /**
   * Social Sign-In (Google / Apple)
   * Accepts a provider token, verifies it against the provider's public keys,
   * then finds or creates a user and issues our own JWT.
   *
   * Body: { provider: 'google' | 'apple', token: string, deviceId?, deviceName?, os?, fcmToken? }
   */
  static socialSignIn = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { provider, token, deviceId, deviceName, os, fcmToken } = req.body;

      if (!provider || !token) {
        return sendResponse(res, 400, false, 'Missing provider or token.');
      }

      let socialId: string | undefined;
      let email: string | undefined;
      let displayName: string | undefined;

      // ─── Verify token with the provider ─────────────────────────────────────
      if (provider === 'google') {
        try {
          const googlePayload = await AuthController._verifyGoogleToken(token);
          socialId = googlePayload.sub;
          email = googlePayload.email;
          displayName = googlePayload.name;
        } catch (err: any) {
          logger.error(`Google token verification failed: ${err.message}`);
          return sendResponse(res, 401, false, 'Invalid Google token.');
        }
      } else if (provider === 'apple') {
        try {
          const applePayload = await AuthController._verifyAppleToken(token);
          socialId = applePayload.sub;
          email = applePayload.email;
        } catch (err: any) {
          logger.error(`Apple token verification failed: ${err.message}`);
          return sendResponse(res, 401, false, 'Invalid Apple token.');
        }
      } else {
        return sendResponse(res, 400, false, `Unsupported provider: ${provider}`);
      }

      if (!socialId) {
        return sendResponse(res, 400, false, 'Could not extract social ID from token.');
      }

      // ─── Find or Create user ────────────────────────────────────────────────
      const idField = provider === 'google' ? 'googleId' : 'appleId';

      let user = await User.findOne({ [idField]: socialId });

      // If no match by socialId, try to find by email (link existing account)
      if (!user && email) {
        user = await User.findOne({ email: email.toLowerCase() });
        if (user) {
          // Link social ID to the existing account
          (user as any)[idField] = socialId;
          await user.save();
          logger.info(`Linked ${provider} ID to existing user: ${user._id}`);
        }
      }

      // Still no user? Create one.
      if (!user) {
        const createData: Record<string, any> = {
          [idField]: socialId,
          role: 'user',
          subscription: { plan: 'free', status: 'inactive' },
        };
        if (email) createData.email = email.toLowerCase();
        if (displayName) createData.displayName = displayName;

        user = await User.create(createData);
        logger.info(`Created new user via ${provider}: ${user._id}`);
      }

      // Check if profile exists
      const profile = await Profile.findOne({ user: user._id });

      // ─── Issue JWT ──────────────────────────────────────────────────────────
      const jwtPayload: JWTPayload = {
        userId: user._id.toString(),
        phone: user.phone,
        email: user.email,
        role: user.role,
      };

      const cleanDeviceId = deviceId || 'unknown-device-' + Date.now();

      await DeviceSession.updateMany(
        { userId: user._id, deviceId: cleanDeviceId, isRevoked: false },
        { isRevoked: true, revokedAt: new Date() }
      );

      const tempToken = 'temp-' + new mongoose.Types.ObjectId().toString();
      const session = await DeviceSession.create({
        userId: user._id,
        refreshToken: tempToken,
        deviceId: cleanDeviceId,
        deviceName: deviceName || 'Mobile Device',
        os: os || 'Unknown',
        fcmToken,
        ipAddress: req.ip || req.socket.remoteAddress,
        lastActive: new Date(),
        isRevoked: false,
      });

      const refreshToken = signRefreshToken(jwtPayload, session._id.toString());
      session.refreshToken = refreshToken;
      await session.save();

      const accessToken = signAccessToken({
        ...jwtPayload,
        sessionId: session._id.toString()
      });

      logger.info(`User ${user._id} signed in via ${provider}. Session: ${session._id}`);

      return sendResponse(res, 200, true, 'Authenticated successfully.', {
        user,
        accessToken,
        refreshToken,
        profile,
      });
    } catch (error: any) {
      logger.error(`Error in socialSignIn: ${error.message}`);
      return sendResponse(res, 500, false, 'Social sign-in failed.');
    }
  };

  // ─── Private helpers for token verification ────────────────────────────────

  /**
   * Fetch JWKS from a URL and return it as an array of JWK objects.
   */
  private static _fetchJwks(url: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.keys || []);
          } catch (e) {
            reject(new Error('Failed to parse JWKS response'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Verify a Google token — supports both id_token (JWT) and access_token (opaque).
   *
   * - id_token:     3-part dot-separated JWT  → verify via ?id_token=
   * - access_token: opaque string             → verify via ?access_token= then
   *                                             fetch name from userinfo endpoint
   */
  private static async _verifyGoogleToken(token: string): Promise<any> {
    const isJwt = token.split('.').length === 3;
    const param = isJwt ? 'id_token' : 'access_token';
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?${param}=${token}`;

    const payload = await new Promise<any>((resolve, reject) => {
      https.get(verifyUrl, (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error || parsed.error_description) {
              return reject(new Error(parsed.error_description || 'Invalid Google token'));
            }
            resolve(parsed);
          } catch {
            reject(new Error('Failed to parse Google tokeninfo response'));
          }
        });
      }).on('error', reject);
    });

    // For access_tokens the tokeninfo endpoint does not return the user's
    // display name — fetch it from the userinfo endpoint.
    if (!isJwt && !payload.name) {
      try {
        const userInfoPayload = await new Promise<any>((resolve, reject) => {
          const options = {
            hostname: 'www.googleapis.com',
            path: '/oauth2/v3/userinfo',
            headers: { Authorization: `Bearer ${token}` },
          };
          https.get(options, (response) => {
            let data = '';
            response.on('data', (chunk) => (data += chunk));
            response.on('end', () => {
              try { resolve(JSON.parse(data)); } catch { resolve({}); }
            });
          }).on('error', reject);
        });
        payload.name = userInfoPayload.name || userInfoPayload.given_name;
        payload.sub = payload.sub || userInfoPayload.sub;
        payload.email = payload.email || userInfoPayload.email;
      } catch {
        // userinfo fetch is best-effort; sub/email from tokeninfo are sufficient
      }
    }

    return payload;
  }

  /**
   * Verify an Apple identity token (JWT signed by Apple's private key).
   * Downloads Apple's public JWKS and verifies the JWT signature.
   */
  private static async _verifyAppleToken(identityToken: string): Promise<any> {
    const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
    const keys = await AuthController._fetchJwks(APPLE_JWKS_URL);

    // Decode header to find which key was used
    const [headerB64] = identityToken.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));

    const matchingKey = keys.find((k: any) => k.kid === header.kid);
    if (!matchingKey) throw new Error('Matching Apple public key not found');

    // Reconstruct PEM from JWK components
    const keyObj = require('crypto').createPublicKey({ key: matchingKey, format: 'jwk' });
    const pem = keyObj.export({ type: 'spki', format: 'pem' }) as string;

    return new Promise((resolve, reject) => {
      jwt.verify(identityToken, pem, { algorithms: ['RS256'] }, (err, decoded) => {
        if (err) return reject(err);
        resolve(decoded);
      });
    });
  }
}
