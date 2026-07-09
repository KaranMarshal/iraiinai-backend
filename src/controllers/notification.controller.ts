import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { DeviceSession } from '../models/DeviceSession';
import { Notification } from '../models/Notification';
import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import { FirebaseService } from '../services/firebase.service';
import { sendResponse } from '../utils/helpers';
import { logger } from '../utils/logger';

export class NotificationController {
  /**
   * POST /notifications/token
   * Register or update the FCM registration token for a device session
   */
  static registerToken = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { deviceId, fcmToken } = req.body;
      if (!deviceId || !fcmToken) {
        return sendResponse(res, 400, false, 'Missing deviceId or fcmToken.');
      }

      const userId = req.user?._id;

      // Find the user's active session for this specific device and update the FCM token
      const session = await DeviceSession.findOneAndUpdate(
        { userId, deviceId, isRevoked: false },
        { fcmToken, lastActive: new Date() },
        { new: true }
      );

      if (!session) {
        // Fallback: if no active session is found, auto-create one so push notifications still function
        const newSession = await DeviceSession.create({
          userId,
          refreshToken: 'temp-push-session-' + Date.now(),
          deviceId,
          fcmToken,
          deviceName: 'Mobile Device',
          os: 'Unknown',
          ipAddress: req.ip || req.socket.remoteAddress,
          lastActive: new Date(),
          isRevoked: false,
        });
        logger.info(`Auto-created DeviceSession for push registration. ID: ${newSession._id}`);
      } else {
        logger.info(`Updated FCM token on DeviceSession ID: ${session._id} for user: ${req.user?.email}`);
      }

      return sendResponse(res, 200, true, 'FCM push registration token saved successfully.');
    } catch (error: any) {
      logger.error(`registerToken error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to register push token.');
    }
  };

  /**
   * GET /notifications
   * Fetch user's in-app notification history
   */
  static getNotifications = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?._id;
      const limit = parseInt(req.query.limit as string) || 50;
      const page = parseInt(req.query.page as string) || 1;
      const skip = (page - 1) * limit;

      const notifications = await Notification.find({ recipient: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Notification.countDocuments({ recipient: userId });

      return sendResponse(res, 200, true, 'Notifications retrieved successfully.', {
        notifications,
        pagination: {
          total,
          limit,
          page,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error: any) {
      logger.error(`getNotifications error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to fetch notification history.');
    }
  };

  /**
   * PATCH /notifications/:id/read
   * Mark a specific notification as read
   */
  static markRead = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const userId = req.user?._id;

      const notification = await Notification.findOneAndUpdate(
        { _id: id, recipient: userId },
        { isRead: true },
        { new: true }
      );

      if (!notification) {
        return sendResponse(res, 404, false, 'Notification record not found.');
      }

      return sendResponse(res, 200, true, 'Notification marked as read.', notification);
    } catch (error: any) {
      logger.error(`markRead error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to update notification status.');
    }
  };

  /**
   * PATCH /notifications/read-all
   * Mark all user's notifications as read
   */
  static markAllRead = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?._id;

      await Notification.updateMany(
        { recipient: userId, isRead: false },
        { isRead: true }
      );

      return sendResponse(res, 200, true, 'All notifications marked as read.');
    } catch (error: any) {
      logger.error(`markAllRead error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to mark notifications as read.');
    }
  };

  /**
   * POST /notifications/admin/broadcast
   * Schedule a promotional campaign to all users or a targeted subscription plan (admin only)
   */
  static broadcastNotification = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { title, body, targetPlan, scheduledAt } = req.body; 
      if (!title || !body) {
        return sendResponse(res, 400, false, 'Missing title or body content.');
      }

      const scheduleTime = scheduledAt ? new Date(scheduledAt) : new Date();

      const campaign = await Campaign.create({
        title,
        body,
        targetPlan: targetPlan || 'all',
        scheduledAt: scheduleTime,
        status: 'pending',
      });

      logger.info(`[Admin Broadcast] Scheduled push campaign: "${title}" for ${scheduleTime}`);

      return sendResponse(
        res,
        200,
        true,
        `Campaign successfully scheduled for ${scheduleTime.toLocaleString()}`,
        campaign
      );
    } catch (error: any) {
      logger.error(`broadcastNotification error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to schedule promotional campaign.');
    }
  };

  /**
   * GET /notifications/admin/campaigns
   * Retrieve all notification campaigns
   */
  static getCampaigns = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const campaigns = await Campaign.find().sort({ createdAt: -1 });
      return sendResponse(res, 200, true, 'Campaigns retrieved successfully.', campaigns);
    } catch (error: any) {
      logger.error(`getCampaigns error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to retrieve campaigns.');
    }
  };

  /**
   * DELETE /notifications/admin/campaigns/:id
   * Cancel a pending campaign
   */
  static cancelCampaign = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const campaign = await Campaign.findById(id);

      if (!campaign) {
        return sendResponse(res, 404, false, 'Campaign not found.');
      }

      if (campaign.status !== 'pending') {
        return sendResponse(res, 400, false, 'Cannot cancel a campaign that has already started or completed.');
      }

      await Campaign.deleteOne({ _id: id });
      return sendResponse(res, 200, true, 'Campaign cancelled successfully.');
    } catch (error: any) {
      logger.error(`cancelCampaign error: ${error.message}`);
      return sendResponse(res, 500, false, 'Failed to cancel campaign.');
    }
  };
}
