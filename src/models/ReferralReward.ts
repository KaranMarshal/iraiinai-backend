import { Schema, model, Document, Types } from 'mongoose';

export interface IReferralReward extends Document {
  referrer: Types.ObjectId;   // User who sent the invite link/code
  referee: Types.ObjectId;    // New user who registered and upgraded
  rewardType: 'cashback' | 'subscription_extension';
  amount: number;             // Cashback reward amount (in INR)
  status: 'pending' | 'completed' | 'claimed';
  transactionId?: Types.ObjectId; // Reference to referee's payment transaction
  claimedAt?: Date;           // Timestamp when cashback was claimed
  createdAt: Date;
  updatedAt: Date;
}

const ReferralRewardSchema = new Schema<IReferralReward>(
  {
    referrer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referee: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rewardType: { type: String, enum: ['cashback', 'subscription_extension'], default: 'cashback' },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'completed', 'claimed'], default: 'completed' },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    claimedAt: { type: Date },
  },
  { timestamps: true }
);

export const ReferralReward = model<IReferralReward>('ReferralReward', ReferralRewardSchema);
export default ReferralReward;
