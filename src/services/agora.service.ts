import { RtcTokenBuilder, RtcRole } from 'agora-token';
import { AGORA_CONFIG, isAgoraConfigured } from '../config/agora';
import { logger } from '../utils/logger';

export interface AgoraTokenResult {
  token: string;
  channelName: string;
  uid: number;
  expiresAt: number;
}

export class AgoraService {
  /**
   * Generate a short-lived Agora RTC token for a given channel + user.
   * channelName: typically the matchId string
   * userId: a numeric UID derived from the user's MongoDB ObjectId
   */
  static generateRtcToken(channelName: string, mongoUserId: string): AgoraTokenResult {
    if (!isAgoraConfigured()) {
      // Return a mock token in development when credentials are not set
      logger.warn('Agora not configured — returning mock token for development.');
      return {
        token: `mock_agora_token_${channelName}`,
        channelName,
        uid: AgoraService.toNumericUid(mongoUserId),
        expiresAt: Math.floor(Date.now() / 1000) + AGORA_CONFIG.tokenExpirySeconds,
      };
    }

    const uid = AgoraService.toNumericUid(mongoUserId);
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const expiresAt = currentTimestamp + AGORA_CONFIG.tokenExpirySeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_CONFIG.appId,
      AGORA_CONFIG.appCertificate,
      channelName,
      uid,
      RtcRole.PUBLISHER,
      expiresAt,
      expiresAt
    );

    logger.info(`Agora token generated for channel="${channelName}" uid=${uid}`);
    return { token, channelName, uid, expiresAt };
  }

  /**
   * Derive a stable 32-bit unsigned integer UID from a MongoDB ObjectId hex string.
   * Takes the last 8 hex chars (4 bytes) and converts to unsigned int.
   */
  static toNumericUid(mongoId: string): number {
    const hex = mongoId.replace(/[^0-9a-fA-F]/g, '').slice(-8);
    return parseInt(hex || '1', 16) >>> 0; // >>> 0 ensures unsigned 32-bit
  }
}
