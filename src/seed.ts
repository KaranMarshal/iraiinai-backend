import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from './models/User';
import { Profile } from './models/Profile';

dotenv.config();

const MOCK_FEMALE_PROFILES = [
  {
    name: 'Priya Swaminathan',
    dob: new Date('1998-08-15'),
    gender: 'female',
    location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
    occupation: 'Lead AI Engineer',
    religion: 'Hindu',
    motherTongue: 'Tamil',
    education: {
      qualification: 'B.Tech / B.E.',
      fieldOfStudy: 'Computer Science',
      college: 'Anna University (CEG), Chennai'
    },
    career: {
      occupation: 'Lead AI Engineer',
      companyName: 'Google Research',
      annualIncome: '₹30–50 Lakhs',
      employedIn: 'private',
      workLocation: 'Bangalore'
    },
    bio: 'Fascinated by the intersection of technology and art. Trained Carnatic singer, avid reader, and loves exploring ancient South Indian temple architecture on weekends.',
    interests: ['Carnatic Music', 'Reading', 'AI Research', 'Temples'],
    photos: [],
    isVerified: true,
    aiSummary: 'An intellectually curious engineer blending ancient Tamil heritage with cutting-edge artificial intelligence.',
    preferences: { ageRange: { min: 21, max: 35 }, religions: [], locations: [] },
    boost: { isBoosted: true, boostType: 'spotlight', boostExpiresAt: new Date(Date.now() + 18 * 60 * 60 * 1000) }
  },
  {
    name: 'Ananya Iyer',
    dob: new Date('2000-11-22'),
    gender: 'female',
    location: { city: 'Madurai', state: 'Tamil Nadu', country: 'India' },
    occupation: 'Architect & Restorer',
    religion: 'Hindu',
    motherTongue: 'Tamil',
    education: {
      qualification: 'B.Arch',
      fieldOfStudy: 'Design & Architecture',
      college: 'SAP, Anna University'
    },
    career: {
      occupation: 'Architect & Restorer',
      companyName: 'Heritage Preservation Collective',
      annualIncome: '₹8–12 Lakhs',
      employedIn: 'private',
      workLocation: 'Madurai'
    },
    bio: 'Designing modern spaces with traditional Tamil elements. Love sketching old structures, sipping filter coffee, and learning Bharatanatyam.',
    interests: ['Architecture', 'Sketching', 'Bharatanatyam', 'Filter Coffee'],
    photos: [],
    isVerified: true,
    aiSummary: 'A creative visual designer restoring history through architecture while enjoying life\'s simple moments.',
    preferences: { ageRange: { min: 21, max: 35 }, religions: [], locations: [] },
  }
];

const MOCK_MALE_PROFILES = [
  {
    name: 'Vignesh Ramaswamy',
    dob: new Date('1995-04-10'),
    gender: 'male',
    location: { city: 'Coimbatore', state: 'Tamil Nadu', country: 'India' },
    occupation: 'Organic Agriculturist',
    religion: 'Hindu',
    motherTongue: 'Tamil',
    education: {
      qualification: 'M.Sc',
      fieldOfStudy: 'Agriculture & Biotech',
      college: 'Tamil Nadu Agricultural University'
    },
    career: {
      occupation: 'Organic Agriculturist',
      companyName: 'GreenEarth Agro-Farms',
      annualIncome: '₹10–20 Lakhs',
      employedIn: 'business',
      workLocation: 'Coimbatore'
    },
    bio: 'Passionate about sustainable living and heritage preservation. Managing a family-owned agro-farm. Looking for someone who values simplicity, nature, and deep conversations.',
    interests: ['Farming', 'Sustainability', 'Trekking', 'Cooking'],
    photos: [],
    isVerified: true,
    aiSummary: 'A grounded nature-lover committed to organic living and preserving agricultural ancestry.',
    preferences: { ageRange: { min: 21, max: 35 }, religions: [], locations: [] },
    boost: { isBoosted: true, boostType: 'spotlight', boostExpiresAt: new Date(Date.now() + 18 * 60 * 60 * 1000) }
  },
  {
    name: 'Karthikeyan Subramanian',
    dob: new Date('1997-03-05'),
    gender: 'male',
    location: { city: 'Trichy', state: 'Tamil Nadu', country: 'India' },
    occupation: 'Product Designer',
    religion: 'Hindu',
    motherTongue: 'Tamil',
    education: {
      qualification: 'B.Des',
      fieldOfStudy: 'Design & Interaction',
      college: 'NID Ahmedabad'
    },
    career: {
      occupation: 'Product Designer',
      companyName: 'Acoustic Labs',
      annualIncome: '₹20–30 Lakhs',
      employedIn: 'private',
      workLocation: 'Chennai'
    },
    bio: 'Visualizer by day, photographer by night. I find beauty in the chaos of local festivals. Always down for road trips, filter coffee, and acoustic guitar sessions.',
    interests: ['Photography', 'Music', 'Travel', 'Product Design'],
    photos: [],
    isVerified: true,
    aiSummary: 'An artistic product designer capturing Tamil Nadu\'s cultural essence through photography and acoustic music.',
    preferences: { ageRange: { min: 21, max: 35 }, religions: [], locations: [] }
  }
];

const seedDatabase = async () => {
  try {
    const uri = process.env.MONGO_URI || 'mongodb://admin:secretpassword@localhost:27017/iraiinai?authSource=admin';
    await mongoose.connect(uri);
    console.log('Connected to DB');

    // Create a mock user for each profile
    const allMocks = [...MOCK_FEMALE_PROFILES, ...MOCK_MALE_PROFILES];
    
    for (let i = 0; i < allMocks.length; i++) {
      const mock = allMocks[i];
      const phone = `+91999999990${i}`;
      
      let user = await User.findOne({ phone });
      if (!user) {
        user = new User({
          phone,
          isPhoneVerified: true,
          role: 'user',
          status: 'active'
        });
        await user.save();
      }

      let profile = await Profile.findOne({ user: user._id });
      if (!profile) {
        profile = new Profile({
          user: user._id,
          ...mock
        });
        await profile.save();
        console.log(`Created profile for ${mock.name}`);
      } else {
        console.log(`Profile already exists for ${mock.name}`);
      }
    }

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding database:', err);
    process.exit(1);
  }
};

seedDatabase();
