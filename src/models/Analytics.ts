import { Schema, model, Document, Types } from 'mongoose';

export interface IAnalytics extends Document {
  user?: Types.ObjectId; // User triggering the telemetry event (optional)
  eventType: 'login' | 'profile_view' | 'swipe_like' | 'swipe_pass' | 'premium_upgrade' | 'chat_sent';
  deviceInfo?: {
    platform: 'android' | 'ios' | 'web';
    osVersion?: string;
  };
  durationSeconds?: number; // Session duration or search time
  metadata?: Record<string, string>; // Extra dynamic metrics tracking data
  createdAt: Date;
}

const AnalyticsSchema = new Schema<IAnalytics>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    eventType: {
      type: String,
      enum: ['login', 'profile_view', 'swipe_like', 'swipe_pass', 'premium_upgrade', 'chat_sent'],
      required: true,
      index: true,
    },
    deviceInfo: {
      platform: { type: String, enum: ['android', 'ios', 'web'] },
      osVersion: { type: String },
    },
    durationSeconds: { type: Number },
    metadata: { type: Map, of: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Analytics = model<IAnalytics>('Analytics', AnalyticsSchema);
export default Analytics;
