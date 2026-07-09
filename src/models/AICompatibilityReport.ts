import { Schema, model, Document, Types } from 'mongoose';

export interface IAICompatibilityReport extends Document {
  user1: Types.ObjectId;
  user2: Types.ObjectId;
  overallScore: number;
  breakdown: {
    demographics: number;
    lifestyle: number;
    astrology: number;
    values: number;
  };
  details: {
    demographics: string;
    lifestyle: string;
    astrology: string;
    values: string;
  };
  summary: string;
  createdAt: Date;
  updatedAt: Date;
}

const AICompatibilityReportSchema = new Schema<IAICompatibilityReport>(
  {
    user1: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    user2: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    overallScore: { type: Number, required: true, min: 0, max: 100 },
    breakdown: {
      demographics: { type: Number, required: true, min: 0, max: 100 },
      lifestyle: { type: Number, required: true, min: 0, max: 100 },
      astrology: { type: Number, required: true, min: 0, max: 100 },
      values: { type: Number, required: true, min: 0, max: 100 },
    },
    details: {
      demographics: { type: String, required: true },
      lifestyle: { type: String, required: true },
      astrology: { type: String, required: true },
      values: { type: String, required: true },
    },
    summary: { type: String, required: true },
  },
  { timestamps: true }
);

// Compound index to quickly find report between two users in either direction
AICompatibilityReportSchema.index({ user1: 1, user2: 1 }, { unique: true });

export const AICompatibilityReport = model<IAICompatibilityReport>(
  'AICompatibilityReport',
  AICompatibilityReportSchema
);
export default AICompatibilityReport;
