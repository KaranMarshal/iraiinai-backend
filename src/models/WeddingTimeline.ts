import { Schema, model, Document, Types } from 'mongoose';

export interface ITimelineEvent {
  title: string;
  stage: 'registration' | 'matching' | 'chat' | 'family_meeting' | 'engagement' | 'wedding';
  date?: Date;
  completed: boolean;
  notes?: string;
  memories: string[]; // Array of photo URLs uploaded for this stage
}

export interface IWeddingTimeline extends Document {
  user1: Types.ObjectId;
  user2: Types.ObjectId;
  matchId: Types.ObjectId;
  stages: ITimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
}

const TimelineEventSchema = new Schema<ITimelineEvent>({
  title: { type: String, required: true },
  stage: {
    type: String,
    enum: ['registration', 'matching', 'chat', 'family_meeting', 'engagement', 'wedding'],
    required: true,
  },
  date: { type: Date },
  completed: { type: Boolean, default: false },
  notes: { type: String, default: '' },
  memories: [{ type: String, default: [] }],
});

const WeddingTimelineSchema = new Schema<IWeddingTimeline>(
  {
    user1: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    user2: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    stages: [TimelineEventSchema],
  },
  { timestamps: true }
);

// Unique index to ensure only one timeline document exists per match
WeddingTimelineSchema.index({ matchId: 1 }, { unique: true });
WeddingTimelineSchema.index({ user1: 1, user2: 1 });

export const WeddingTimeline = model<IWeddingTimeline>('WeddingTimeline', WeddingTimelineSchema);
export default WeddingTimeline;
