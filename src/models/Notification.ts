import { Schema, model, Document, Types } from 'mongoose';

export interface INotification extends Document {
  recipient: Types.ObjectId; // Target user
  sender?: Types.ObjectId;    // Initiating user (optional)
  type: 'like' | 'match' | 'message' | 'subscription' | 'verification' | 'interest_request' | 'interest_accept' | 'profile_view' | 'promotional';
  title: string;
  body: string;
  dataPayload?: Record<string, string>; // Extra custom notification action params
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User' },
    type: {
      type: String,
      enum: ['like', 'match', 'message', 'subscription', 'verification', 'interest_request', 'interest_accept', 'profile_view', 'promotional'],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    dataPayload: { type: Map, of: String },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Mongoose post-save hook to deliver FCM push notification automatically
NotificationSchema.post('save', async function (doc) {
  try {
    const { FirebaseService } = require('../services/firebase.service');
    const { logger } = require('../utils/logger');

    const payload: Record<string, string> = {};
    if (doc.dataPayload) {
      for (const [key, val] of (doc.dataPayload as any).entries()) {
        payload[key] = String(val);
      }
    }
    
    if (!payload.type) {
      payload.type = doc.type;
    }

    logger.info(`[FCM Hook] Triggered push notification delivery for recipient: ${doc.recipient}`);
    await FirebaseService.sendToUser(doc.recipient.toString(), doc.title, doc.body, payload);
  } catch (err: any) {
    console.error(`[FCM Hook Error] Failed to send push notification: ${err.message}`);
  }
});

export const Notification = model<INotification>('Notification', NotificationSchema);
export default Notification;
