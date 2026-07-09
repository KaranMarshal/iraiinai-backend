import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { DeviceSession } from '../models/DeviceSession';

const checkDb = async () => {
  await mongoose.connect(ENV.MONGO_URI);
  console.log('Connected to MongoDB.');

  const sessions = await DeviceSession.find({});
  console.log(`Found ${sessions.length} sessions in DB:`);
  for (const s of sessions) {
    console.log(`- ID: ${s._id}`);
    console.log(`  User: ${s.userId}`);
    console.log(`  Device: ${s.deviceName}`);
    console.log(`  Revoked: ${s.isRevoked}`);
    console.log(`  Token: ${s.refreshToken.substring(0, 50)}...`);
  }

  await mongoose.disconnect();
};

checkDb();
