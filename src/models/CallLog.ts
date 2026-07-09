import { Schema, model, Document, Types } from 'mongoose';

export type CallType = 'voice' | 'video';
export type CallStatus = 'answered' | 'missed' | 'declined' | 'failed' | 'ongoing';

export interface ICallLog extends Document {
  caller: Types.ObjectId;
  callee: Types.ObjectId;
  matchId: Types.ObjectId;
  callType: CallType;
  status: CallStatus;
  channelName: string;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  createdAt: Date;
  updatedAt: Date;
}

const CallLogSchema = new Schema<ICallLog>(
  {
    caller: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    callee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true },
    callType: { type: String, enum: ['voice', 'video'], required: true },
    status: {
      type: String,
      enum: ['answered', 'missed', 'declined', 'failed', 'ongoing'],
      default: 'ongoing',
    },
    channelName: { type: String, required: true },
    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number },
  },
  { timestamps: true }
);

CallLogSchema.index({ caller: 1, createdAt: -1 });
CallLogSchema.index({ callee: 1, createdAt: -1 });
CallLogSchema.index({ matchId: 1 });

export const CallLog = model<ICallLog>('CallLog', CallLogSchema);
export default CallLog;
