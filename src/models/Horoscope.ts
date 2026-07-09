import { Schema, model, Document, Types } from 'mongoose';

export interface IHoroscope extends Document {
  user: Types.ObjectId;
  profile: Types.ObjectId;
  rashi?: string;         // Moon sign
  nakshatra?: string;     // Star
  lagnam?: string;        // Ascendant
  manglikStatus: 'yes' | 'no' | 'partial' | 'unknown';
  doshaDetails: {
    sevvaiDosham: boolean;  // Mars dosha - critical in Tamil matrimony
    raguKethuDosham: boolean;
    details?: string;
  };
  birthPlace: {
    city: string;
    state: string;
    country: string;
  };
  birthTime: string;      // HH:MM format
  horoscopeChart: {
    rashiGrid: string[]; // 12-box chart array mapping planets to zodiac houses
    amsamGrid: string[]; // Amsam chart array
  };
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const HoroscopeSchema = new Schema<IHoroscope>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    profile: { type: Schema.Types.ObjectId, ref: 'Profile', required: true, unique: true },
    rashi: { type: String },
    nakshatra: { type: String },
    lagnam: { type: String },
    manglikStatus: {
      type: String,
      enum: ['yes', 'no', 'partial', 'unknown'],
      default: 'unknown',
    },
    doshaDetails: {
      sevvaiDosham: { type: Boolean, default: false },
      raguKethuDosham: { type: Boolean, default: false },
      details: { type: String },
    },
    birthPlace: {
      city: { type: String, required: true },
      state: { type: String, required: true },
      country: { type: String, default: 'India' },
    },
    birthTime: { type: String, required: true },
    horoscopeChart: {
      rashiGrid: [{ type: String }],
      amsamGrid: [{ type: String }],
    },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Horoscope = model<IHoroscope>('Horoscope', HoroscopeSchema);
export default Horoscope;
