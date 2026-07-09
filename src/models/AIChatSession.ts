import { Schema, model, Document, Types } from 'mongoose';

export interface IAIChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
}

export interface IAIChatSession extends Document {
  user: Types.ObjectId;
  contextMatchId?: Types.ObjectId; // Optional: If the session is scoped to a specific match
  messages: IAIChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const AIChatMessageSchema = new Schema<IAIChatMessage>({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
});

const AIChatSessionSchema = new Schema<IAIChatSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    contextMatchId: { type: Schema.Types.ObjectId, ref: 'Match' },
    messages: [AIChatMessageSchema],
  },
  { timestamps: true }
);

// Indexes
AIChatSessionSchema.index({ user: 1, updatedAt: -1 });

export const AIChatSession = model<IAIChatSession>('AIChatSession', AIChatSessionSchema);
export default AIChatSession;
