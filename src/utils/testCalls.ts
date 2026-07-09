import { io as ClientSocket } from 'socket.io-client';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Match } from '../models/Match';
import { CallLog } from '../models/CallLog';
import { signAccessToken } from './jwt';

const SOCKET_URL = 'http://localhost:5000';

const connectSocket = (socket: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err: any) => reject(err));
  });
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
  console.log('🚀 Starting IraiInai Call Signaling Integration Tests...\n');

  let socket1: any;
  let socket2: any;

  try {
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // 1. Setup users and matches (using the same mock users from testChat)
    const user1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_1' });
    const user2 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_2' });

    if (!user1 || !user2) throw new Error('Mock users not found. Run test:chat first.');

    // Enforce platinum for video call
    user1.subscription = { plan: 'platinum', status: 'active' };
    await user1.save();

    const match = await Match.findOne({
      $or: [
        { user1: user1._id, user2: user2._id },
        { user1: user2._id, user2: user1._id },
      ],
      status: 'matched'
    });

    if (!match) throw new Error('Mutual match not found.');
    const matchId = match._id.toString();

    // 2. Connect sockets
    console.log('\n⏳ Connecting Sockets...');
    const token1 = signAccessToken({ userId: user1._id.toString(), phone: '000', role: 'user' });
    const token2 = signAccessToken({ userId: user2._id.toString(), phone: '000', role: 'user' });

    socket1 = ClientSocket(SOCKET_URL, { auth: { token: token1 }, transports: ['websocket'] });
    socket2 = ClientSocket(SOCKET_URL, { auth: { token: token2 }, transports: ['websocket'] });

    await Promise.all([connectSocket(socket1), connectSocket(socket2)]);
    console.log('✅ Both client sockets connected.');

    // Clean up old call logs for this match
    await CallLog.deleteMany({ matchId });

    // 3. Test Call Initiation
    console.log('\n⏳ Testing call_initiate...');
    let incomingCallData: any = null;
    let callRingingData: any = null;

    socket2.on('incoming_call', (data: any) => incomingCallData = data);
    socket1.on('call_ringing', (data: any) => callRingingData = data);

    socket1.emit('call_initiate', { matchId, callType: 'video', callerName: 'Mock User 1' });
    await delay(1000);

    if (!incomingCallData) throw new Error('callee did not receive incoming_call');
    if (!callRingingData) throw new Error('caller did not receive call_ringing');

    const callLogId = incomingCallData.callLogId;
    console.log(`✅ Call initiated successfully. CallLog ID: ${callLogId}`);

    // Verify DB CallLog created
    let log = await CallLog.findById(callLogId);
    if (!log || log.status !== 'ongoing') throw new Error('CallLog not created or status not ongoing');

    // 4. Test Call Acceptance
    console.log('\n⏳ Testing call_accepted...');
    let callAcceptedData: any = null;
    socket1.on('call_accepted', (data: any) => callAcceptedData = data);

    socket2.emit('call_accepted', { callLogId, matchId });
    await delay(1000);

    if (!callAcceptedData) throw new Error('caller did not receive call_accepted');
    
    log = await CallLog.findById(callLogId);
    if (!log || log.status !== 'answered') throw new Error('CallLog status not updated to answered');
    console.log('✅ Call accepted successfully.');

    // 5. Test Call End
    console.log('\n⏳ Testing call_ended...');
    let callEndedData: any = null;
    socket2.on('call_ended', (data: any) => callEndedData = data);

    socket1.emit('call_ended', { callLogId, matchId, durationSeconds: 45 });
    await delay(1000);

    if (!callEndedData || callEndedData.reason !== 'hung_up') throw new Error('callee did not receive call_ended with hung_up');
    
    log = await CallLog.findById(callLogId);
    if (!log || log.durationSeconds !== 45) throw new Error('CallLog duration not saved correctly');
    console.log('✅ Call ended successfully.');

    // 6. Test Free Tier Gate
    console.log('\n⏳ Testing call_initiate gate for Free users...');
    user1.subscription = { plan: 'free', status: 'inactive' };
    await user1.save();

    let callErrorData: any = null;
    socket1.on('call_error', (data: any) => callErrorData = data);
    socket1.emit('call_initiate', { matchId, callType: 'video', callerName: 'Mock User 1' });
    await delay(1000);

    if (!callErrorData) throw new Error('Free user was able to bypass call gate!');
    console.log(`✅ Call correctly blocked for free user: ${callErrorData.message}`);

    console.log('\n🏆 ALL CALL SIGNALING TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
  } finally {
    if (socket1) socket1.disconnect();
    if (socket2) socket2.disconnect();
    await mongoose.disconnect();
    console.log('\n🔌 Cleaned up connections.');
  }
};

runTests();
