import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger';
import { ENV } from '../config/env';
import { DeviceSession } from '../models/DeviceSession';

// Initialize Firebase Admin SDK
try {
  let serviceAccount: any = null;

  // We can either provide a path to a JSON file or base64 encoded JSON string in ENV
  const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccountKey.json';
  const resolvedPath = path.resolve(process.cwd(), saPath);

  if (fs.existsSync(resolvedPath)) {
    serviceAccount = require(resolvedPath);
    initializeApp({
      credential: cert(serviceAccount),
    });
    logger.info('Firebase Admin SDK initialized successfully via serviceAccountKey.json');
  } else {
    logger.warn(`Firebase Admin SDK not initialized: Could not find serviceAccountKey at ${resolvedPath}. Push notifications will be mocked.`);
  }
} catch (error: any) {
  logger.error(`Error initializing Firebase Admin SDK: ${error.message}`);
}

export class FirebaseService {
  /**
   * Send a general push notification to a specific user by their MongoDB User ID.
   * Finds all active device sessions with FCM tokens for the user.
   */
  static async sendToUser(
    userId: string,
    title: string,
    body: string,
    dataPayload: Record<string, string> = {}
  ): Promise<boolean> {
    try {
      // Find active device sessions that have an fcmToken
      const sessions = await DeviceSession.find({
        userId,
        isRevoked: false,
        fcmToken: { $exists: true, $ne: null }
      });

      if (!sessions || sessions.length === 0) {
        logger.info(`Push notification skipped: User ${userId} has no registered FCM tokens.`);
        return false;
      }

      const tokens = sessions.map(session => session.fcmToken as string);

      if (getApps().length === 0) {
        logger.info(`[Push Notification Mock] To User ${userId} (${tokens.length} devices): [${title}] ${body}`);
        return true; // Return true in mock mode
      }

      const message = {
        notification: {
          title,
          body,
        },
        data: dataPayload,
        tokens,
      };

      const response = await getMessaging().sendEachForMulticast(message);
      
      logger.info(`Push notification sent to User ${userId}. Success: ${response.successCount}, Failures: ${response.failureCount}`);

      // Handle invalid tokens (e.g., uninstalled app)
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp: any, idx: number) => {
          if (!resp.success) {
            failedTokens.push(tokens[idx]);
          }
        });

        if (failedTokens.length > 0) {
          // Remove invalid FCM tokens from sessions
          await DeviceSession.updateMany(
            { fcmToken: { $in: failedTokens } },
            { $unset: { fcmToken: 1 } }
          );
          logger.info(`Cleaned up ${failedTokens.length} invalid FCM tokens.`);
        }
      }

      return response.successCount > 0;
    } catch (error: any) {
      logger.error(`Failed to send push notification to User ${userId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Send a chat alert notification
   */
  static async sendChatNotification(userId: string, senderName: string, messagePreview: string, chatId: string) {
    return this.sendToUser(
      userId,
      `New Message from ${senderName}`,
      messagePreview,
      { type: 'chat', chatId }
    );
  }

  /**
   * Send a match notification
   */
  static async sendMatchNotification(userId: string, matchName: string, matchId: string) {
    return this.sendToUser(
      userId,
      `You have a new match!`,
      `${matchName} has matched with your profile. Tap to start a conversation!`,
      { type: 'match', matchId }
    );
  }

  /**
   * Send a subscription alert
   */
  static async sendSubscriptionAlert(userId: string, planName: string, action: 'renewed' | 'expired') {
    const title = action === 'renewed' ? 'Subscription Renewed' : 'Subscription Expired';
    const body = action === 'renewed' 
      ? `Your ${planName} subscription has been successfully renewed. Enjoy premium features!`
      : `Your ${planName} subscription has expired. Renew now to keep premium benefits.`;
      
    return this.sendToUser(userId, title, body, { type: 'subscription', action });
  }

  /**
   * Send a profile view notification
   */
  static async sendProfileViewNotification(userId: string, viewerName: string) {
    return this.sendToUser(
      userId,
      `Someone viewed your profile!`,
      `${viewerName} just viewed your profile. Check them out!`,
      { type: 'profile_view' }
    );
  }
}
