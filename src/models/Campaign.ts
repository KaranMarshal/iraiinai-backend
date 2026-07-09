import { Schema, model, Document } from 'mongoose';

export type TargetPlan = 'all' | 'free' | 'premium' | 'silver' | 'gold' | 'platinum';
export type CampaignStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ICampaign extends Document {
  title: string;
  body: string;
  targetPlan: TargetPlan;
  scheduledAt: Date;
  status: CampaignStatus;
  sentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    title: { type: String, required: true },
    body: { type: String, required: true },
    targetPlan: {
      type: String,
      enum: ['all', 'free', 'premium', 'silver', 'gold', 'platinum'],
      default: 'all',
    },
    scheduledAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    sentCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Campaign = model<ICampaign>('Campaign', CampaignSchema);
export default Campaign;
