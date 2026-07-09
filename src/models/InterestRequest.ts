import { Schema, model, Document, Types } from 'mongoose';

export interface IInterestRequest extends Document {
  sender: Types.ObjectId; // User sending interest request
  receiver: Types.ObjectId; // User receiving interest request
  status: 'pending' | 'accepted' | 'rejected';
  message?: string; // Optional custom message (proposal note)
  createdAt: Date;
  updatedAt: Date;
}

const InterestRequestSchema = new Schema<IInterestRequest>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    message: { type: String },
  },
  { timestamps: true }
);

// Prevent duplicate interest requests between the same users
InterestRequestSchema.index({ sender: 1, receiver: 1 }, { unique: true });

export const InterestRequest = model<IInterestRequest>('InterestRequest', InterestRequestSchema);
export default InterestRequest;
