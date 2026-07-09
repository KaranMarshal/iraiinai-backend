import { Schema, model, Document, Types } from 'mongoose';

export interface IBudgetItem {
  category: 'hall' | 'photographer' | 'catering' | 'decoration' | 'other';
  name: string;
  allocatedAmount: number;
  spentAmount: number;
  paidStatus: 'unpaid' | 'deposit_paid' | 'fully_paid';
}

export interface IGuest {
  name: string;
  side: 'bride' | 'groom' | 'mutual';
  rsvpStatus: 'pending' | 'attending' | 'declined';
  phone?: string;
}

export interface IVendor {
  category: 'hall' | 'photographer' | 'catering' | 'decoration' | 'other';
  businessName: string;
  contactPerson: string;
  phone: string;
  status: 'searching' | 'contacted' | 'booked';
  cost: number;
  notes?: string;
}

export interface IChecklistItem {
  task: string;
  dueDate?: Date;
  completed: boolean;
  notes?: string;
}

export interface IWeddingPlanner extends Document {
  user1: Types.ObjectId;
  user2: Types.ObjectId;
  matchId: Types.ObjectId;
  totalBudget: number;
  budgetItems: IBudgetItem[];
  guests: IGuest[];
  vendors: IVendor[];
  checklist: IChecklistItem[];
  weddingDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BudgetItemSchema = new Schema<IBudgetItem>({
  category: {
    type: String,
    enum: ['hall', 'photographer', 'catering', 'decoration', 'other'],
    required: true,
  },
  name: { type: String, required: true },
  allocatedAmount: { type: Number, default: 0 },
  spentAmount: { type: Number, default: 0 },
  paidStatus: {
    type: String,
    enum: ['unpaid', 'deposit_paid', 'fully_paid'],
    default: 'unpaid',
  },
});

const GuestSchema = new Schema<IGuest>({
  name: { type: String, required: true },
  side: { type: String, enum: ['bride', 'groom', 'mutual'], default: 'mutual' },
  rsvpStatus: { type: String, enum: ['pending', 'attending', 'declined'], default: 'pending' },
  phone: { type: String },
});

const VendorSchema = new Schema<IVendor>({
  category: {
    type: String,
    enum: ['hall', 'photographer', 'catering', 'decoration', 'other'],
    required: true,
  },
  businessName: { type: String, required: true },
  contactPerson: { type: String, required: true },
  phone: { type: String, required: true },
  status: { type: String, enum: ['searching', 'contacted', 'booked'], default: 'searching' },
  cost: { type: Number, default: 0 },
  notes: { type: String },
});

const ChecklistItemSchema = new Schema<IChecklistItem>({
  task: { type: String, required: true },
  dueDate: { type: Date },
  completed: { type: Boolean, default: false },
  notes: { type: String },
});

const WeddingPlannerSchema = new Schema<IWeddingPlanner>(
  {
    user1: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    user2: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, unique: true },
    totalBudget: { type: Number, default: 3000000 },
    budgetItems: [BudgetItemSchema],
    guests: [GuestSchema],
    vendors: [VendorSchema],
    checklist: [ChecklistItemSchema],
    weddingDate: { type: Date },
  },
  { timestamps: true }
);

export const WeddingPlanner = model<IWeddingPlanner>('WeddingPlanner', WeddingPlannerSchema);
export default WeddingPlanner;
