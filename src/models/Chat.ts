import { Schema, model, Document, Types } from 'mongoose';

export interface IMessage {
  _id?: Types.ObjectId;
  sender: Types.ObjectId;
  text: string;
  mediaUrl?: string;
  mediaType?: 'text' | 'image' | 'video' | 'audio';
  isRead: boolean;
  isHidden?: boolean;
  timestamp: Date;
}

export interface IChat extends Document {
  match: Types.ObjectId; // Link to the original mutual Match ID
  participants: Types.ObjectId[]; // Array of 2 Users
  messages: IMessage[];
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, default: '' },
  mediaUrl: { type: String },
  mediaType: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
  isRead: { type: Boolean, default: false },
  isHidden: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
});

const ChatSchema = new Schema<IChat>(
  {
    match: { type: Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
    messages: [MessageSchema],
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indexes for pagination and conversation ordering
ChatSchema.index({ participants: 1 });
ChatSchema.index({ lastMessageAt: -1 });

export const Chat = model<IChat>('Chat', ChatSchema);
export default Chat;
