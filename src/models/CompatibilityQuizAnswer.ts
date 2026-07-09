import { Schema, model, Document, Types } from 'mongoose';

export interface IQuizResponse {
  questionId: string;
  category: 'lifestyle' | 'personality' | 'values' | 'goals';
  questionText: string;
  selectedOption: string;
  optionLabel: string;
}

export interface ICompatibilityQuizAnswer extends Document {
  user: Types.ObjectId;
  responses: IQuizResponse[];
  createdAt: Date;
  updatedAt: Date;
}

const QuizResponseSchema = new Schema<IQuizResponse>({
  questionId: { type: String, required: true },
  category: {
    type: String,
    enum: ['lifestyle', 'personality', 'values', 'goals'],
    required: true,
  },
  questionText: { type: String, required: true },
  selectedOption: { type: String, required: true },
  optionLabel: { type: String, required: true },
});

const CompatibilityQuizAnswerSchema = new Schema<ICompatibilityQuizAnswer>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    responses: [QuizResponseSchema],
  },
  { timestamps: true }
);

export const CompatibilityQuizAnswer = model<ICompatibilityQuizAnswer>(
  'CompatibilityQuizAnswer',
  CompatibilityQuizAnswerSchema
);
export default CompatibilityQuizAnswer;
