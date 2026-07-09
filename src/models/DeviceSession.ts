import { Schema, model, Document } from 'mongoose';

export interface IDeviceSession extends Document {
  userId: Schema.Types.ObjectId;
  refreshToken: string;
  deviceId: string;
  deviceName?: string;
  os?: string;
  ipAddress?: string;
  fcmToken?: string;
  lastActive: Date;
  isRevoked: boolean;
  revokedAt?: Date;
  rotatedTokens: string[];
  createdAt: Date;
  updatedAt: Date;
}

const DeviceSessionSchema = new Schema<IDeviceSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshToken: { type: String, required: true, unique: true, index: true },
    rotatedTokens: { type: [String], default: [], index: true },
    deviceId: { type: String, required: true, index: true },
    deviceName: { type: String },
    os: { type: String },
    ipAddress: { type: String },
    fcmToken: { type: String, index: true },
    lastActive: { type: Date, default: Date.now },
    isRevoked: { type: Boolean, default: false },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);

export const DeviceSession = model<IDeviceSession>('DeviceSession', DeviceSessionSchema);
export default DeviceSession;
