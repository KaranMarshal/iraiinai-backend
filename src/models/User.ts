import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  firebaseId?: string;
  phone?: string;
  email?: string;
  googleId?: string;
  appleId?: string;
  displayName?: string;
  role: 'user' | 'admin';
  subscription: {
    plan: 'free' | 'silver' | 'gold' | 'platinum';
    status: 'active' | 'inactive';
    expiryDate?: Date;
    razorpaySubscriptionId?: string;
  };
  // ─── Safety & Trust ────────────────────────────────────────────────────────
  trustScore: number;
  isShadowBanned: boolean;
  swipeVelocity: {
    count: number;
    windowStart: Date;
  };
  blockedUsers: Types.ObjectId[];
  unlockedContacts: Types.ObjectId[];
  isActive: boolean;
  isSuspended: boolean;
  suspendedAt?: Date;
  suspendedReason?: string;
  warningCount: number;
  lastWarningAt?: Date;
  // ─── Referral System ────────────────────────────────────────────────────────
  referralCode?: string;
  referredBy?: Types.ObjectId;
  // ─── End Referral ──────────────────────────────────────────────────────────
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    firebaseId: { type: String, unique: true, sparse: true, index: true },
    phone: { type: String, unique: true, sparse: true, index: true },
    email: { type: String, unique: true, sparse: true, lowercase: true },
    googleId: { type: String, unique: true, sparse: true },
    appleId: { type: String, unique: true, sparse: true },
    displayName: { type: String },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    subscription: {
      plan: {
        type: String,
        enum: ['free', 'silver', 'gold', 'platinum'],
        default: 'free',
      },
      status: {
        type: String,
        enum: ['active', 'inactive'],
        default: 'inactive',
      },
      expiryDate: { type: Date },
      razorpaySubscriptionId: { type: String },
    },
    // Safety fields
    trustScore: { type: Number, default: 100, min: 0, max: 100 },
    isShadowBanned: { type: Boolean, default: false },
    swipeVelocity: {
      count: { type: Number, default: 0 },
      windowStart: { type: Date, default: Date.now }
    },
    blockedUsers: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    unlockedContacts: [{ type: Schema.Types.ObjectId, ref: 'User', default: [] }],
    isSuspended: { type: Boolean, default: false },
    suspendedAt: { type: Date },
    suspendedReason: { type: String },
    warningCount: { type: Number, default: 0 },
    lastWarningAt: { type: Date },
    // Referral fields
    referralCode: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Pre-save hook to generate unique referralCode for new users
UserSchema.pre('save', function (next) {
  if (!this.referralCode) {
    const random = Math.floor(1000 + Math.random() * 9000);
    const prefix = this.phone ? this.phone.slice(-4) : 'USER';
    this.referralCode = `IRAI-${prefix}-${random}`;
  }
  next();
});

// Indexes for security daemon
UserSchema.index({ isActive: 1, isShadowBanned: 1, role: 1 });

export const User = model<IUser>('User', UserSchema);
export default User;

