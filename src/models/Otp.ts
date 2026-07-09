import mongoose, { Document, Schema } from 'mongoose';

export type OtpChannel = 'phone' | 'email';

export interface IOtp extends Document {
  identifier: string;   // phone number OR email address
  channel: OtpChannel;
  otp: string;
  expiresAt: Date;
  isUsed: boolean;
  attempts: number;     // verification attempts (lock out after 5)
  createdAt: Date;
}

const otpSchema = new Schema<IOtp>(
  {
    identifier: { type: String, required: true, trim: true, lowercase: true },
    channel: { type: String, enum: ['phone', 'email'], required: true, default: 'phone' },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isUsed: { type: Boolean, default: false },
    attempts: { type: Number, default: 0 },
    // TTL index: MongoDB auto-deletes the doc 10 min after creation
    createdAt: { type: Date, default: Date.now, expires: 600 },
  },
  { timestamps: true }
);

// Fast lookup by identifier + channel
otpSchema.index({ identifier: 1, channel: 1 });

export const Otp = mongoose.model<IOtp>('Otp', otpSchema);
