import { Schema, model, Document, Types } from 'mongoose';

export interface IAdminLog extends Document {
  admin: Types.ObjectId; // Admin user taking the action
  action: 'verify_profile' | 'suspend_user' | 'ban_user' | 'resolve_report' | 'update_config';
  targetUser?: Types.ObjectId; // User affected by the action
  details: string; // Explanatory text for the log entry
  ipAddress?: string;
  createdAt: Date;
}

const AdminLogSchema = new Schema<IAdminLog>(
  {
    admin: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: {
      type: String,
      enum: ['verify_profile', 'suspend_user', 'ban_user', 'resolve_report', 'update_config'],
      required: true,
    },
    targetUser: { type: Schema.Types.ObjectId, ref: 'User' },
    details: { type: String, required: true },
    ipAddress: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } } // No update edits on logs
);

export const AdminLog = model<IAdminLog>('AdminLog', AdminLogSchema);
export default AdminLog;
