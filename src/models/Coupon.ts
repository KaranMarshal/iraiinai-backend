import { Schema, model, Document } from 'mongoose';

export interface ICoupon extends Document {
  code: string;               // Unique coupon code, uppercase (e.g. 'IRAI50')
  discountType: 'percentage' | 'fixed'; // Type of discount
  discountValue: number;      // Value of discount (e.g. 50% or ₹200)
  maxUses: number;            // Total allowed uses of the coupon
  usedCount: number;          // Current number of times coupon has been used
  expiryDate: Date;           // Coupon expiration date
  isActive: boolean;          // Active status toggle
  applicablePlans: string[];  // Subscriptions coupon applies to: ['silver', 'gold', 'platinum']
  createdAt: Date;
  updatedAt: Date;
}

const CouponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: ['percentage', 'fixed'], default: 'fixed' },
    discountValue: { type: Number, required: true },
    maxUses: { type: Number, default: 100 },
    usedCount: { type: Number, default: 0 },
    expiryDate: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    applicablePlans: [{ type: String, enum: ['silver', 'gold', 'platinum'] }],
  },
  { timestamps: true }
);

export const Coupon = model<ICoupon>('Coupon', CouponSchema);
export default Coupon;
