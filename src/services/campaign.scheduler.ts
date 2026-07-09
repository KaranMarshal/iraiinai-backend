import { Campaign } from '../models/Campaign';
import { User } from '../models/User';
import { Notification } from '../models/Notification';
import { AIFraudService } from './aiFraud.service';
import { logger } from '../utils/logger';

export class CampaignScheduler {
  private static timer: NodeJS.Timeout | null = null;

  /**
   * Starts the Campaign Scheduler polling daemon.
   * Runs every 60 seconds.
   */
  static start() {
    if (this.timer) return;
    
    logger.info('[CampaignScheduler] Daemon initialized. Polling every 60s for scheduled campaigns.');
    
    // Poll immediately, then set interval
    this.processPendingCampaigns();
    AIFraudService.scanCluster().catch(e => logger.error('Fraud scan error: ' + e));

    this.timer = setInterval(() => {
       this.processPendingCampaigns();
       AIFraudService.scanCluster().catch(e => logger.error('Fraud scan error: ' + e));
    }, 60000);
  }

  static stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private static async processPendingCampaigns() {
    try {
      const now = new Date();
      
      // Find all campaigns that are pending and should be sent by now
      const campaigns = await Campaign.find({
        status: 'pending',
        scheduledAt: { $lte: now }
      });

      if (campaigns.length === 0) return;

      for (const campaign of campaigns) {
        await this.executeCampaign(campaign);
      }
    } catch (error: any) {
      logger.error(`[CampaignScheduler] Failed to poll campaigns: ${error.message}`);
    }
  }

  private static async executeCampaign(campaign: any) {
    try {
      logger.info(`[CampaignScheduler] Starting execution for Campaign: "${campaign.title}"`);
      
      // Lock campaign
      campaign.status = 'processing';
      await campaign.save();

      // Query active users targeting subscription level
      const userQuery: any = { isActive: true };
      
      if (campaign.targetPlan && campaign.targetPlan !== 'all') {
        if (campaign.targetPlan === 'free') {
           userQuery['$or'] = [
             { 'subscription.status': { $ne: 'active' } },
             { 'subscription.plan': { $exists: false } }
           ];
        } else if (campaign.targetPlan === 'premium') {
           userQuery['subscription.status'] = 'active';
        } else {
           userQuery['subscription.plan'] = campaign.targetPlan;
           userQuery['subscription.status'] = 'active';
        }
      }

      const users = await User.find(userQuery).select('_id');
      const userIds = users.map(u => u._id);

      if (userIds.length === 0) {
        campaign.status = 'completed';
        campaign.sentCount = 0;
        await campaign.save();
        logger.info(`[CampaignScheduler] Campaign "${campaign.title}" completed. No recipients matched criteria.`);
        return;
      }

      let sent = 0;
      // Note: We use a loop and 'create' rather than 'insertMany' so that the Notification schema's 
      // 'post(save)' hook fires correctly, pushing the FCM notification!
      for (const id of userIds) {
        try {
          await Notification.create({
            recipient: id,
            type: 'promotional',
            title: campaign.title,
            body: campaign.body,
            isRead: false,
            dataPayload: new Map([['type', 'promotional'], ['campaignId', campaign._id.toString()]]),
          });
          sent++;
        } catch (deliveryError: any) {
           logger.error(`[CampaignScheduler] Failed to deliver to ${id}: ${deliveryError.message}`);
        }
      }

      campaign.status = 'completed';
      campaign.sentCount = sent;
      await campaign.save();

      logger.info(`[CampaignScheduler] Campaign "${campaign.title}" successfully delivered to ${sent} users.`);

    } catch (error: any) {
      logger.error(`[CampaignScheduler] Campaign execution failed for ID ${campaign._id}: ${error.message}`);
      campaign.status = 'failed';
      await campaign.save();
    }
  }
}
