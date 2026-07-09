import { Schema, model, Document, Types } from 'mongoose';

export interface IProfileDraft extends Document {
  user: Types.ObjectId;
  stepData: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ProfileDraftSchema = new Schema<IProfileDraft>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    stepData: { type: Schema.Types.Map, of: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const ProfileDraft = model<IProfileDraft>('ProfileDraft', ProfileDraftSchema);
export default ProfileDraft;
