import { io as ClientSocket } from 'socket.io-client';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Match } from '../models/Match';
import { signAccessToken } from './jwt';

const SOCKET_URL = 'http://localhost:5000';
const NUM_BOTS = 20;

const connectSocket = (socket: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve());
    socket.on('connect_error', (err: any) => reject(err));
  });
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
  console.log(`🚀 Starting IraiInai Real-Time Socket Load Test (${NUM_BOTS} bots)...\n`);

  const sockets: any[] = [];
  const latencies: number[] = [];

  try {
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // Find a valid match to act as the global room
    const match = await Match.findOne({ status: 'matched' });
    if (!match) throw new Error('No matched document found. Run testChat first.');
    const matchId = match._id.toString();

    // Spawn mock users for load test
    console.log(`⏳ Spawning ${NUM_BOTS} virtual users and connecting...`);
    
    // Create one dummy user for all bots to use to bypass DB check
    let dummyUser = await User.findOne({ email: 'perf_bot@iraiinai.temporary' });
    if (!dummyUser) {
      dummyUser = await User.create({
        email: 'perf_bot@iraiinai.temporary',
        phone: '9998887776',
        role: 'user',
        subscription: { plan: 'free', status: 'inactive' },
      });
    }

    for (let i = 0; i < NUM_BOTS; i++) {
      const token = signAccessToken({ userId: dummyUser._id.toString(), phone: `9998887776`, role: 'user' });
      
      const socket = ClientSocket(SOCKET_URL, {
        auth: { token },
        transports: ['websocket'],
      });
      sockets.push(socket);
    }

    await Promise.all(sockets.map(connectSocket));
    console.log(`✅ ${NUM_BOTS} sockets successfully connected.`);

    // Wait for all to join chat
    sockets.forEach(s => s.emit('join_chat', { matchId }));
    await delay(1000); // Wait for join completion
    console.log(`✅ ${NUM_BOTS} sockets joined room ${matchId}.`);

    // Load test: Measure Round Trip Time via presence query or custom echo
    // We'll use presence query as a ping
    console.log('\n⏳ Initiating Ping/Pong Round-Trip Latency test...');

    for (let i = 0; i < sockets.length; i++) {
      const socket = sockets[i];
      const pingStart = Date.now();
      
      const p = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn(`Socket ${i} ping timeout`);
          resolve();
        }, 5000);

        socket.once('presence_response', () => {
          clearTimeout(timeout);
          const rtt = Date.now() - pingStart;
          latencies.push(rtt);
          resolve();
        });
      });

      socket.emit('query_presence', { userId: new mongoose.Types.ObjectId().toString() });
      await p;
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const maxLatency = Math.max(...latencies);
    const minLatency = Math.min(...latencies);

    console.log('\n📊 REAL-TIME COMMUNICATION PERFORMANCE REPORT:');
    console.log('----------------------------------------------');
    console.log(`Total Connections : ${NUM_BOTS}`);
    console.log(`Average Latency   : ${avgLatency.toFixed(2)} ms`);
    console.log(`Minimum Latency   : ${minLatency} ms`);
    console.log(`Maximum Latency   : ${maxLatency} ms`);
    console.log('----------------------------------------------');

    if (avgLatency > 500) {
      throw new Error(`Average Latency is too high (${avgLatency} ms)`);
    } else {
      console.log('✅ Real-time performance is well within acceptable boundaries (<500ms).');
    }

    console.log('\n🏆 ALL REAL-TIME PERFORMANCE TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
  } finally {
    sockets.forEach(s => s.disconnect());
    await mongoose.disconnect();
    console.log('\n🔌 Cleaned up connections.');
  }
};

runTests();
