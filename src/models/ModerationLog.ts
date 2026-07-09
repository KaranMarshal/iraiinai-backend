import { Schema, model, Document, Types } from 'mongoose';

export type FlagSeverity = 'low' | 'medium' | 'high';

export interface IModerationLog extends Document {
  sender: Types.ObjectId;
  recipient: Types.ObjectId;
  matchId: Types.ObjectId;
  messageText: string;          // Plaintext of the flagged message (NOT stored for high)
  flags: string[];              // List of rule IDs that triggered (e.g. 'phone_number', 'explicit')
  severity: FlagSeverity;
  action: 'blocked' | 'delivered' | 'delivered_flagged';
  reviewedBy?: Types.ObjectId;  // Admin who reviewed
  reviewedAt?: Date;
  reviewNote?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ModerationLogSchema = new Schema<IModerationLog>(
  {
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    messageText: { type: String, default: '[REDACTED]' }, // High severity messages are redacted
    flags: [{ type: String }],
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['blocked', 'delivered', 'delivered_flagged'],
      required: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNote: { type: String },
  },
  { timestamps: true }
);

ModerationLogSchema.index({ severity: 1, action: 1, createdAt: -1 });
ModerationLogSchema.index({ sender: 1, createdAt: -1 });

export const ModerationLog = model<IModerationLog>('ModerationLog', ModerationLogSchema);
export default ModerationLog;
