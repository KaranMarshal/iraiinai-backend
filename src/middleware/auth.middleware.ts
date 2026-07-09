import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/User';
import { Profile } from '../models/Profile';
import { DeviceSession } from '../models/DeviceSession';
import { logger } from '../utils/logger';
import { sendResponse } from '../utils/helpers';
import { verifyAccessToken, JWTPayload } from '../utils/jwt';

// Extend Express Request type locally
export interface AuthenticatedRequest extends Request {
  user?: IUser;
  tokenPayload?: JWTPayload;
}

/**
 * Authenticate JWT access tokens for API requests
 */
export const authenticateUser = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return sendResponse(res, 401, false, 'No authorization token provided.');
    }

    const token = authHeader.split(' ')[1];

    // Development bypass for Admin UI testing
    if (process.env.NODE_ENV !== 'production' && token === 'mock-admin-token') {
      const adminUser = await User.findOne({ email: 'admin@iraiinai.com' });
      if (adminUser) {
        req.user = adminUser;
        return next();
      }
      // If no admin user exists, create a dummy one for the request
      req.user = { _id: '000000000000000000000000', role: 'admin', email: 'admin@iraiinai.com' } as any;
      return next();
    }

    // Development bypass for integration testing
    if (process.env.NODE_ENV !== 'production' && token.startsWith('mock')) {
      const firebaseId = `mock-user-uid-${token}`;
      let user = await User.findOne({ firebaseId });
      if (!user) {
        // Auto-provision a basic mock user
        const isFirstAdmin = (await User.countDocuments()) === 0;
        user = await User.create({
          firebaseId,
          phone: `+919999999${Math.floor(100 + Math.random() * 900)}`,
          email: `${token}@iraiinai.com`,
          role: isFirstAdmin ? 'admin' : 'user',
          subscription: { plan: 'free', status: 'inactive' },
        });
      }

      // Also ensure a mock profile exists for this user
      let profile = await Profile.findOne({ user: user._id });
      if (!profile) {
        profile = await Profile.create({
          user: user._id,
          name: token.replace(/[^a-zA-Z0-9]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          gender: token.includes('opp') || token.includes('2') || token.includes('female') ? 'female' : 'male',
          dob: new Date('1998-01-01'),
          location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
          religion: 'Hindu',
          motherTongue: 'Tamil',
          interests: ['Reading', 'Music'],
          isVerified: true
        });
      }

      req.user = user;
      return next();
    }

    let payload: JWTPayload | null = null;

    try {
      payload = verifyAccessToken(token);
    } catch (err: any) {
      if (err instanceof jwt.TokenExpiredError) {
        logger.warn('JWT access token has expired.');
        return res.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Access token expired. Please refresh your session.',
        });
      }
      logger.error(`JWT Verification Failed: ${err.message}`);
      return sendResponse(res, 403, false, 'Invalid or expired access token.', err.message);
    }

    req.tokenPayload = payload;

    // Verify session is active if sessionId is bound to access token
    if (payload.sessionId) {
      const session = await DeviceSession.findById(payload.sessionId);
      if (!session || session.isRevoked) {
        logger.warn(`Rejected access token: Session ${payload.sessionId} is revoked.`);
        return res.status(401).json({
          success: false,
          code: 'SESSION_REVOKED',
          message: 'Your session has been terminated. Please log in again.',
        });
      }
    }

    // Fetch user
    const user = await User.findById(payload.userId);
    if (!user) {
      return sendResponse(res, 401, false, 'User no longer exists.');
    }

    req.user = user;
    next();
  } catch (error: any) {
    logger.error(`Authentication Middleware Error: ${error.message}`);
    return sendResponse(res, 500, false, 'Internal server authentication error.', error.message);
  }
};

/**
 * Authorize only specific roles
 */
export const authorizeRoles = (...roles: ('user' | 'admin')[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return sendResponse(res, 401, false, 'User is not authenticated.');
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(`User ${req.user.phone} attempted unauthorized access to role-protected endpoint (requires: ${roles.join(',')}).`);
      return sendResponse(res, 403, false, 'Access denied. Unauthorized role permissions.');
    }

    next();
  };
};

/**
 * Legacy admin check helper (uses authorizeRoles('admin') under the hood)
 */
export const requireAdmin = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  authorizeRoles('admin')(req, res, next);
};
