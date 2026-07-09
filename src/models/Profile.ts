import { Schema, model, Document, Types } from 'mongoose';

export interface IProfile extends Document {
  user: Types.ObjectId; // Reference to MongoDB User ID
  name: string;
  gender: 'male' | 'female' | 'other';
  dob: Date;
  age?: number;
  maritalStatus?: 'never_married' | 'divorced' | 'widowed' | 'awaiting_divorce' | 'separated' | 'single';
  religion?: string;
  caste?: string;
  community?: string;
  motherTongue?: string;
  occupation?: string;
  income?: number; // Annual income in local currency
  location: {
    city: string;
    state: string;
    country: string;
  };
  bio?: string;
  interests: string[];
  education?: {
    qualification?: string;
    fieldOfStudy?: string;
    college?: string;
  };
  career?: {
    occupation?: string;
    companyName?: string;
    annualIncome?: string;
    employedIn?: string;
    workLocation?: string;
  };
  familyDetails?: {
    fatherOccupation?: string;
    motherOccupation?: string;
    siblingsInfo?: string;
    familyType?: string;
    familyStatus?: string;
  };
  photos: string[]; // URLs of photos stored in Firebase Storage
  photoPrivacy?: 'visible_to_all' | 'visible_to_premium' | 'request_only' | 'hidden';
  photoAccessGrants?: Types.ObjectId[];
  videoIntroUrl?: string;
  voiceIntroUrl?: string;
  videoIntroPrivacy?: 'visible_to_all' | 'visible_to_premium' | 'request_only' | 'hidden';
  voiceIntroPrivacy?: 'visible_to_all' | 'visible_to_premium' | 'request_only' | 'hidden';
  isVerified: boolean;
  idProofUrl?: string;
  idProofType?: 'aadhaar' | 'pan' | 'voter_id' | 'driving_license' | '';
  verificationStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  foodHabits?: 'vegetarian' | 'non_vegetarian' | 'eggetarian' | 'vegan' | '';
  lifestyleType?: 'traditional' | 'moderate' | 'modern' | '';
  familyValues?: 'orthodox' | 'traditional' | 'moderate' | 'liberal' | '';
  partnerExpectations?: string;
  riskScore?: number;
  isFakeFlagged?: boolean;
  aiSummary?: string; // Cache profile summarization from Gemini
  boost?: {
    isBoosted: boolean;
    boostExpiresAt?: Date;
    boostType?: 'spotlight' | 'trending' | 'standard';
  };
  preferences: {
    ageRange: { min: number; max: number };
    religions: string[];
    locations: string[];
    minIncome?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSchema = new Schema<IProfile>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    name: { type: String, required: true },
    gender: { type: String, enum: ['male', 'female', 'other'], required: true },
    dob: { type: Date, required: true },
    age: { type: Number },
    maritalStatus: { type: String, enum: ['never_married', 'divorced', 'widowed', 'awaiting_divorce', 'separated', 'single'] },
    religion: { type: String },
    caste: { type: String },
    community: { type: String },
    motherTongue: { type: String },
    occupation: { type: String },
    income: { type: Number },
    location: {
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, required: true, default: 'India' },
    },
    bio: { type: String },
    interests: [{ type: String }],
    education: {
      qualification: { type: String },
      fieldOfStudy: { type: String },
      college: { type: String },
    },
    career: {
      occupation: { type: String },
      companyName: { type: String },
      annualIncome: { type: String },
      employedIn: { type: String },
      workLocation: { type: String },
    },
    familyDetails: {
      fatherOccupation: { type: String },
      motherOccupation: { type: String },
      siblingsInfo: { type: String },
      familyType: { type: String, enum: ['nuclear', 'joint', 'extended', ''] },
      familyStatus: { type: String, enum: ['middle_class', 'upper_middle_class', 'rich', 'wealthy', ''] },
    },
    photos: [{ type: String }],
    photoPrivacy: {
      type: String,
      enum: ['visible_to_all', 'visible_to_premium', 'request_only', 'hidden'],
      default: 'visible_to_all',
    },
    photoAccessGrants: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    videoIntroUrl: { type: String },
    voiceIntroUrl: { type: String },
    videoIntroPrivacy: {
      type: String,
      enum: ['visible_to_all', 'visible_to_premium', 'request_only', 'hidden'],
      default: 'visible_to_all',
    },
    voiceIntroPrivacy: {
      type: String,
      enum: ['visible_to_all', 'visible_to_premium', 'request_only', 'hidden'],
      default: 'visible_to_all',
    },
    isVerified: { type: Boolean, default: false },
    idProofUrl: { type: String, default: '' },
    idProofType: { type: String, enum: ['aadhaar', 'pan', 'voter_id', 'driving_license', ''], default: '' },
    verificationStatus: { type: String, enum: ['none', 'pending', 'approved', 'rejected'], default: 'none' },
    foodHabits: { type: String, enum: ['vegetarian', 'non_vegetarian', 'eggetarian', 'vegan', ''], default: '' },
    lifestyleType: { type: String, enum: ['traditional', 'moderate', 'modern', ''], default: '' },
    familyValues: { type: String, enum: ['orthodox', 'traditional', 'moderate', 'liberal', ''], default: '' },
    partnerExpectations: { type: String, default: '' },
    riskScore: { type: Number, default: 0 },
    isFakeFlagged: { type: Boolean, default: false },
    aiSummary: { type: String },
    boost: {
      isBoosted: { type: Boolean, default: false },
      boostExpiresAt: { type: Date },
      boostType: { type: String, enum: ['spotlight', 'trending', 'standard'], default: 'standard' }
    },
    preferences: {
      ageRange: {
        min: { type: Number, default: 21 },
        max: { type: Number, default: 35 },
      },
      religions: [{ type: String }],
      locations: [{ type: String }],
      minIncome: { type: Number },
    },
  },
  { timestamps: true }
);

// Indexes for fast filtering
ProfileSchema.index({ gender: 1, 'location.state': 1, age: 1 });
ProfileSchema.index({ 'location.city': 1 });
ProfileSchema.index({ user: 1 });

export const Profile = model<IProfile>('Profile', ProfileSchema);
export default Profile;
