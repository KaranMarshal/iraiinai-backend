import { Schema, model, Document, Types } from 'mongoose';

export interface IRecommendation extends Document {
  user: Types.ObjectId; // The user receiving recommendations
  targetUser: Types.ObjectId; // The recommended profile
  score: number; // AI compatibility rating (0-100)
  reasoning?: string; // Summary of why this profile is recommended
  vectorSimilarity?: number; // Score from MongoDB Atlas vector search
  status: 'active' | 'swiped' | 'expired';
  generatedAt: Date;
}

const RecommendationSchema = new Schema<IRecommendation>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    targetUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    reasoning: { type: String },
    vectorSimilarity: { type: Number },
    status: {
      type: String,
      enum: ['active', 'swiped', 'expired'],
      default: 'active',
      index: true,
    },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Prevent redundant recommendations for the same target
RecommendationSchema.index({ user: 1, targetUser: 1 }, { unique: true });

export const Recommendation = model<IRecommendation>('Recommendation', RecommendationSchema);
export default Recommendation;
