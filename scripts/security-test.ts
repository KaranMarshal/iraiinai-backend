import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { User } from '../src/models/User';
import { Profile } from '../src/models/Profile';
import { AIFraudService } from '../src/services/aiFraud.service';
import { Chat } from '../src/models/Chat';
import { Match } from '../src/models/Match';
import { ModerationService } from '../src/services/moderation.service';

async function runSecurityTest() {
  console.log('Connecting to database...');
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/iraiinai_dev');
  console.log('Connected.');

  console.log('--- Setting up Test Data ---');
  // 1. Create a dummy bot user
  const botId = new mongoose.Types.ObjectId();
  const botUser = new User({
    _id: botId,
    email: `spambot_${Date.now()}@test.com`,
    password: 'password123',
    phone: `+1000${Math.floor(Math.random() * 900000)}`,
    status: 'active',
    role: 'user',
    trustScore: 100,
    isShadowBanned: false
  });
  await botUser.save();

  const botProfile = new Profile({
    user: botId,
    name: 'Amanda (IG: crypto_amanda)',
    gender: 'female',
    dob: new Date('1998-01-01'),
    photos: ['https://example.com/bot1.jpg'], // single photo
    bio: 'Follow me on IG: crypto_amanda and add me on WhatsApp: +1234567890. I teach crypto investment.',
    isVerified: false,
    location: {
      country: 'USA',
      state: 'CA',
      city: 'Los Angeles'
    }
  });
  await botProfile.save();

  // 2. Create a normal user
  const normalUserId = new mongoose.Types.ObjectId();
  const normalUser = new User({
    _id: normalUserId,
    email: `normal_${Date.now()}@test.com`,
    password: 'password123',
    phone: `+1999${Math.floor(Math.random() * 900000)}`,
    status: 'active',
    role: 'user',
    trustScore: 100,
    isShadowBanned: false
  });
  await normalUser.save();

  const normalProfile = new Profile({
    user: normalUserId,
    name: 'John Doe',
    gender: 'male',
    dob: new Date('1990-01-01'),
    photos: ['https://example.com/real1.jpg', 'https://example.com/real2.jpg'],
    bio: 'Just a normal guy looking for a serious relationship.',
    isVerified: true,
    location: {
      country: 'USA',
      state: 'NY',
      city: 'New York'
    }
  });
  await normalProfile.save();

  // 3. Create a Match & Chat
  const match = await Match.create({
    user1: normalUserId,
    user2: botId,
    status: 'matched'
  });

  const chat = await Chat.create({
    match: match._id,
    participants: [normalUserId, botId],
    messages: []
  });

  console.log('\n--- Running AI Fraud Scan ---');
  const shadowbannedCount = await AIFraudService.scanCluster();
  console.log(`Scan complete. Shadowbanned users: ${shadowbannedCount}`);

  // Fetch bot to check score
  const updatedBot = await User.findById(botId);
  console.log('Bot Trust Score:', updatedBot?.trustScore);
  console.log('Bot Shadowbanned?', updatedBot?.isShadowBanned);

  console.log('\n--- Simulating Fast-Linking in Chat ---');
  // Simulate the logic in socket.service
  let processedText = 'Hey cutie! Send money to my cashapp http://cash.app/$scam';
  let isHidden = false;

  const userMessageCount = chat.messages.filter(m => m.sender.toString() === botId.toString()).length;
  if (userMessageCount < 3 && (processedText.includes('http') || /\d{8,}/.test(processedText))) {
      updatedBot!.trustScore = Math.max(0, updatedBot!.trustScore - 40);
      if (updatedBot!.trustScore < 30) updatedBot!.isShadowBanned = true;
      await updatedBot!.save();
      console.log(`Bot sent link too fast. Trust Score dropped to ${updatedBot!.trustScore}. ShadowBanned: ${updatedBot!.isShadowBanned}`);
  }

  // Scan with ModerationService
  const scanResult = ModerationService.scan(processedText);
  if (!scanResult.safe) {
      updatedBot!.trustScore = Math.max(0, updatedBot!.trustScore - (scanResult.severity === 'high' ? 50 : 20));
      if (updatedBot!.trustScore < 30) updatedBot!.isShadowBanned = true;
      await updatedBot!.save();
      console.log(`Bot message flagged (${scanResult.severity}). Trust Score dropped to ${updatedBot!.trustScore}. ShadowBanned: ${updatedBot!.isShadowBanned}`);
  }

  if (updatedBot?.isShadowBanned) {
      console.log('Bot is shadowbanned! Message will be hidden.');
      isHidden = true;
  }

  chat.messages.push({
    sender: botId,
    text: 'EncryptedTextHere', // Mocking encryption
    isRead: false,
    isHidden,
    timestamp: new Date()
  } as any);
  await chat.save();

  console.log('\n--- Normal User Views Chat ---');
  const updatedChat = await Chat.findById(chat._id);
  const visibleMessages = updatedChat!.messages.filter(msg => !msg.isHidden || msg.sender.toString() === normalUserId.toString());
  console.log(`Total messages in DB: ${updatedChat!.messages.length}`);
  console.log(`Messages visible to Normal User: ${visibleMessages.length}`);

  console.log('\n--- Bot Views Chat ---');
  const botVisibleMessages = updatedChat!.messages.filter(msg => !msg.isHidden || msg.sender.toString() === botId.toString());
  console.log(`Messages visible to Bot: ${botVisibleMessages.length}`);

  // Cleanup
  console.log('\nCleaning up test data...');
  await User.deleteMany({ _id: { $in: [botId, normalUserId] } });
  await Profile.deleteMany({ user: { $in: [botId, normalUserId] } });
  await Match.deleteOne({ _id: match._id });
  await Chat.deleteOne({ _id: chat._id });
  
  console.log('Test completed successfully.');
  process.exit(0);
}

runSecurityTest().catch(console.error);
