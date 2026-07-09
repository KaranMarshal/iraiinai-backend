import { Schema, model, Document } from 'mongoose';

export interface IContent extends Document {
  type: 'banner' | 'blog' | 'announcement';
  title: string;
  body?: string; // HTML, Markdown, or plain text
  imageUrl?: string;
  linkUrl?: string; // Where the banner/blog links to
  isActive: boolean;
  priority: number; // For ordering banners
  createdAt: Date;
  updatedAt: Date;
}

const ContentSchema = new Schema<IContent>(
  {
    type: { type: String, enum: ['banner', 'blog', 'announcement'], required: true },
    title: { type: String, required: true },
    body: { type: String },
    imageUrl: { type: String },
    linkUrl: { type: String },
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Content = model<IContent>('Content', ContentSchema);
export default Content;
