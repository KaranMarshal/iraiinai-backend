import { Schema, model, Document, Types } from 'mongoose';

export interface ITransaction extends Document {
  user: Types.ObjectId;
  razorpayOrderId?: string;
  razorpaySubscriptionId?: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: string;
  plan: 'silver' | 'gold' | 'platinum';
  status: 'created' | 'paid' | 'failed';
  signatureVerified: boolean;
  couponCode?: string;
  discountApplied?: number;
  invoiceUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    razorpayOrderId: { type: String, unique: true, sparse: true },
    razorpaySubscriptionId: { type: String, sparse: true },
    razorpayPaymentId: { type: String },
    amount: { type: Number, required: true },
    currency: { type: String, required: true, default: 'INR' },
    plan: {
      type: String,
      enum: ['silver', 'gold', 'platinum'],
      required: true,
    },
    status: {
      type: String,
      enum: ['created', 'paid', 'failed'],
      default: 'created',
    },
    signatureVerified: { type: Boolean, default: false },
    couponCode: { type: String },
    discountApplied: { type: Number, default: 0 },
    invoiceUrl: { type: String },
  },
  { timestamps: true }
);

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
export default Transaction;
