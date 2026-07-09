import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { User } from '../src/models/User';
import { Profile } from '../src/models/Profile';
import { Match } from '../src/models/Match';
import { AIChatSession } from '../src/models/AIChatSession';
import { AIService } from '../src/services/ai.service';

async function runChatbotTest() {
  console.log('Connecting to database...');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/iraiinai_dev');
  console.log('Connected.\n');

  console.log('--- Setting up Test Data ---');
  // 1. Create User
  const myUserId = new mongoose.Types.ObjectId();
  const myUser = new User({
    _id: myUserId,
    email: `test_${Date.now()}@test.com`,
    password: 'password123',
    phone: `+1999${Math.floor(Math.random() * 900000)}`,
    status: 'active',
  });
  await myUser.save();

  const myProfile = new Profile({
    user: myUserId,
    name: 'Karan',
    gender: 'male',
    dob: new Date('1995-05-15'),
    location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
    career: { occupation: 'Software Engineer' },
    interests: ['Photography', 'Travel', 'Coding']
  });
  await myProfile.save();

  // 2. Create Partner
  const partnerId = new mongoose.Types.ObjectId();
  const partnerUser = new User({
    _id: partnerId,
    email: `partner_${Date.now()}@test.com`,
    password: 'password123',
    phone: `+1888${Math.floor(Math.random() * 900000)}`,
    status: 'active',
  });
  await partnerUser.save();

  const partnerProfile = new Profile({
    user: partnerId,
    name: 'Priya',
    gender: 'female',
    dob: new Date('1997-08-20'),
    location: { city: 'Bangalore', state: 'Karnataka', country: 'India' },
    career: { occupation: 'Data Scientist' },
    interests: ['Reading', 'Travel', 'Coffee']
  });
  await partnerProfile.save();

  // 3. Create Match
  const match = await Match.create({
    user1: myUserId,
    user2: partnerId,
    status: 'matched'
  });

  // 4. Create AI Chat Session
  const session = await AIChatSession.create({
    user: myUserId,
    contextMatchId: match._id,
    messages: []
  });

  console.log('\n--- Simulating AI Chat ---');
  
  const userMessage = "Hi! I just matched with Priya. I see she likes Travel and Coffee. I want to ask her out for coffee this weekend but I'm nervous. What should I say?";
  console.log(`User: ${userMessage}`);

  session.messages.push({ role: 'user', text: userMessage, timestamp: new Date() } as any);
  
  const sessionHistory = session.messages.map(m => ({ role: m.role, text: m.text }));

  // Call the AI Service
  const aiResponse = await AIService.chatWithAssistant(userMessage, sessionHistory, myProfile, partnerProfile);
  
  console.log(`\nLove Coach: ${aiResponse}`);

  session.messages.push({ role: 'assistant', text: aiResponse, timestamp: new Date() } as any);
  await session.save();

  const savedSession = await AIChatSession.findById(session._id);
  console.log(`\nSession saved to DB. Total messages: ${savedSession?.messages.length}`);

  console.log('\nCleaning up test data...');
  await User.deleteMany({ _id: { $in: [myUserId, partnerId] } });
  await Profile.deleteMany({ user: { $in: [myUserId, partnerId] } });
  await Match.deleteOne({ _id: match._id });
  await AIChatSession.deleteOne({ _id: session._id });

  console.log('Test completed successfully.');
  process.exit(0);
}

runChatbotTest().catch(console.error);
