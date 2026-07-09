import { Schema, model, Document, Types } from 'mongoose';

export type ReportReason =
  | 'fake_profile'
  | 'inappropriate_messages'
  | 'harassment'
  | 'spam'
  | 'sexual_content'
  | 'minor_safety'
  | 'threats_violence'
  | 'sharing_contact_info'
  | 'other';

export type ReportStatus = 'pending' | 'under_review' | 'resolved' | 'dismissed';
export type ActionTaken = 'none' | 'warning' | 'suspended' | 'banned';

export interface IReportEvidence {
  messageId?: Types.ObjectId;
  screenshotUrl?: string;
  description?: string;
}

export interface IReport extends Document {
  reporter: Types.ObjectId;
  reportedUser: Types.ObjectId;
  matchId?: Types.ObjectId;
  reason: ReportReason;
  description?: string;
  evidence: IReportEvidence[];
  chatContext?: string;        // Encrypted snapshot of recent messages
  status: ReportStatus;
  severity: 'low' | 'medium' | 'high' | 'critical';
  actionTaken: ActionTaken;
  resolvedBy?: Types.ObjectId;
  resolvedAt?: Date;
  adminNotes?: string;
  autoFlagged: boolean;        // True if filed by moderation service (not user)
  createdAt: Date;
  updatedAt: Date;
}

const EvidenceSchema = new Schema<IReportEvidence>({
  messageId: { type: Schema.Types.ObjectId },
  screenshotUrl: { type: String },
  description: { type: String },
});

const ReportSchema = new Schema<IReport>(
  {
    reporter: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedUser: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match' },
    reason: {
      type: String,
      enum: [
        'fake_profile',
        'inappropriate_messages',
        'harassment',
        'spam',
        'sexual_content',
        'minor_safety',
        'threats_violence',
        'sharing_contact_info',
        'other',
      ],
      required: true,
    },
    description: { type: String },
    evidence: { type: [EvidenceSchema], default: [] },
    chatContext: { type: String },
    status: {
      type: String,
      enum: ['pending', 'under_review', 'resolved', 'dismissed'],
      default: 'pending',
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    actionTaken: {
      type: String,
      enum: ['none', 'warning', 'suspended', 'banned'],
      default: 'none',
    },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    adminNotes: { type: String },
    autoFlagged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index for admin query performance
ReportSchema.index({ status: 1, severity: -1, createdAt: -1 });

export const Report = model<IReport>('Report', ReportSchema);
export default Report;
