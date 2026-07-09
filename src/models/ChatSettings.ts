import { Schema, model, Document, Types } from 'mongoose';

export type MessageExpiryHours = 0 | 24 | 168 | 720; // 0 = off, 168 = 7d, 720 = 30d

export interface IChatSettings extends Document {
  matchId: Types.ObjectId;       // 1:1 with Match
  mediaEnabled: boolean;         // Can participants share images/video/audio?
  linkSharingEnabled: boolean;   // Are URLs stripped/blocked?
  screenshotProtection: boolean; // Is screenshot capture disabled on both ends?
  messageExpiryHours: MessageExpiryHours; // Auto-delete messages after N hours (0 = off)
  lastExpiryRunAt?: Date;        // Timestamp of last expiry cleanup job
  createdAt: Date;
  updatedAt: Date;
}

const ChatSettingsSchema = new Schema<IChatSettings>(
  {
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, unique: true, index: true },
    mediaEnabled: { type: Boolean, default: true },
    linkSharingEnabled: { type: Boolean, default: false }, // Off by default for safety
    screenshotProtection: { type: Boolean, default: true }, // On by default
    messageExpiryHours: {
      type: Number,
      enum: [0, 24, 168, 720],
      default: 0,
    },
    lastExpiryRunAt: { type: Date },
  },
  { timestamps: true }
);

export const ChatSettings = model<IChatSettings>('ChatSettings', ChatSettingsSchema);
export default ChatSettings;
