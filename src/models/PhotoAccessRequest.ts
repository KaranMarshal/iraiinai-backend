import { Schema, model, Document, Types } from 'mongoose';

export interface IPhotoAccessRequest extends Document {
  requester: Types.ObjectId; // User requesting photo access
  recipient: Types.ObjectId; // User whose photos are being requested
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

const PhotoAccessRequestSchema = new Schema<IPhotoAccessRequest>(
  {
    requester: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

// Unique compound index so a user cannot request another's photos multiple times
PhotoAccessRequestSchema.index({ requester: 1, recipient: 1 }, { unique: true });

export const PhotoAccessRequest = model<IPhotoAccessRequest>(
  'PhotoAccessRequest',
  PhotoAccessRequestSchema
);
export default PhotoAccessRequest;
