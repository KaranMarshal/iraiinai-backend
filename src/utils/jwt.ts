import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import crypto from 'crypto';

export interface JWTPayload {
  userId: string;
  phone?: string;
  email?: string;
  role: 'user' | 'admin';
  sessionId?: string;
}

export interface RefreshJWTPayload extends JWTPayload {
  sessionId: string;
  nonce?: string;
}

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

/**
 * Sign JWT Access Token
 */
export const signAccessToken = (payload: JWTPayload): string => {
  return jwt.sign(payload, ENV.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
};

/**
 * Sign JWT Refresh Token
 */
export const signRefreshToken = (payload: JWTPayload, sessionId: string): string => {
  const refreshPayload: RefreshJWTPayload = {
    ...payload,
    sessionId,
    nonce: crypto.randomUUID(),
  };
  // Use a secret derivative for refresh tokens
  const refreshSecret = ENV.JWT_SECRET + '_refresh';
  return jwt.sign(refreshPayload, refreshSecret, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
};

/**
 * Verify JWT Access Token
 * Returns decoded payload, or throws error
 */
export const verifyAccessToken = (token: string): JWTPayload => {
  return jwt.verify(token, ENV.JWT_SECRET) as JWTPayload;
};

/**
 * Verify JWT Refresh Token
 * Returns decoded payload, or throws error
 */
export const verifyRefreshToken = (token: string): RefreshJWTPayload => {
  const refreshSecret = ENV.JWT_SECRET + '_refresh';
  return jwt.verify(token, refreshSecret) as RefreshJWTPayload;
};
