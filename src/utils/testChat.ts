import { io as ClientSocket } from 'socket.io-client';
import mongoose from 'mongoose';
import { ENV } from '../config/env';
import { User } from '../models/User';
import { Profile } from '../models/Profile';
import { Match } from '../models/Match';
import { Chat } from '../models/Chat';
import { decrypt } from './crypto';
import { signAccessToken } from './jwt';

const SOCKET_URL = 'http://localhost:5000';

const connectSocket = (socket: any): Promise<void> => {
  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      resolve();
    });
    socket.on('connect_error', (err: any) => {
      reject(err);
    });
  });
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const runTests = async () => {
  console.log('🚀 Starting IraiInai Real-Time Secure Chat Integration Tests...\n');

  let socket1: any;
  let socket2: any;

  try {
    // 1. Connect to MongoDB
    await mongoose.connect(ENV.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // 2. Setup mock users
    let user1 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_1' });
    if (!user1) {
      user1 = await User.create({
        firebaseId: 'mock-user-uid-mock_user_1',
        email: 'mock_user_1@iraiinai.temporary',
        role: 'user',
        subscription: { plan: 'gold', status: 'active' },
      });
    } else {
      user1.subscription = { plan: 'gold', status: 'active' };
      await user1.save();
    }

    let user2 = await User.findOne({ firebaseId: 'mock-user-uid-mock_user_2' });
    if (!user2) {
      user2 = await User.create({
        firebaseId: 'mock-user-uid-mock_user_2',
        email: 'mock_user_2@iraiinai.temporary',
        role: 'user',
        subscription: { plan: 'free', status: 'inactive' },
      });
    }

    const uid1 = user1._id.toString();
    const uid2 = user2._id.toString();
    console.log(`✅ Users loaded. User 1: ${uid1}, User 2: ${uid2}`);

    // 3. Setup mock profiles
    let profile1 = await Profile.findOne({ user: user1._id });
    if (!profile1) {
      profile1 = await Profile.create({
        user: user1._id,
        name: 'Mock User 1',
        gender: 'male',
        dob: new Date('1995-01-01'),
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        isVerified: true,
      });
    }

    let profile2 = await Profile.findOne({ user: user2._id });
    if (!profile2) {
      profile2 = await Profile.create({
        user: user2._id,
        name: 'Mock User 2',
        gender: 'female',
        dob: new Date('1997-01-01'),
        location: { city: 'Chennai', state: 'Tamil Nadu', country: 'India' },
        isVerified: true,
      });
    }
    console.log('✅ Profiles verified.');

    // 4. Setup mutual match
    let match = await Match.findOne({
      $or: [
        { user1: user1._id, user2: user2._id },
        { user1: user2._id, user2: user1._id },
      ],
    });

    if (!match) {
      match = await Match.create({
        user1: user1._id,
        user2: user2._id,
        status: 'matched',
        compatibilityScore: 92,
      });
    } else {
      match.status = 'matched';
      await match.save();
    }
    const matchId = match._id.toString();
    console.log(`✅ Mutual match established (ID: ${matchId}).`);

    // Clean up any old chat document to ensure test predictability
    await Chat.deleteOne({ match: matchId });
    console.log('✅ Cleared legacy chat logs for test space.');

    // 5. Connect Client Sockets
    console.log('\n⏳ Connecting Client Sockets...');
    const token1 = signAccessToken({ userId: uid1, phone: '000', role: 'user' });
    const token2 = signAccessToken({ userId: uid2, phone: '000', role: 'user' });

    socket1 = ClientSocket(SOCKET_URL, {
      auth: { token: token1 },
      transports: ['websocket'],
    });

    socket2 = ClientSocket(SOCKET_URL, {
      auth: { token: token2 },
      transports: ['websocket'],
    });

    await Promise.all([connectSocket(socket1), connectSocket(socket2)]);
    console.log('✅ Both client sockets authenticated and connected.');

    // 6. Test Join Chat
    console.log('\n⏳ Testing join_chat events...');
    let joined1 = false;
    let joined2 = false;

    socket1.on('joined_chat', (data: any) => {
      if (data.matchId === matchId) joined1 = true;
    });

    socket2.on('joined_chat', (data: any) => {
      if (data.matchId === matchId) joined2 = true;
    });

    socket1.emit('join_chat', { matchId });
    socket2.emit('join_chat', { matchId });

    await delay(500);
    if (!joined1 || !joined2) {
      throw new Error(`Room join failed. User 1 joined: ${joined1}, User 2 joined: ${joined2}`);
    }
    console.log('✅ Room join confirmed on both clients.');

    // 7. Test Send & Receive Message
    console.log('\n⏳ Testing send_message & new_message events...');
    let receivedMessage: any = null;

    socket2.on('new_message', (msg: any) => {
      receivedMessage = msg;
    });

    const testMessageText = 'Hello! This is a secure real-time message exchange test.';
    socket1.emit('send_message', { matchId, text: testMessageText });

    await delay(800);

    if (!receivedMessage) {
      throw new Error('Message was not received by client 2.');
    }

    console.log('✅ Message received in real-time by client 2!');
    console.log(`   Sender: ${receivedMessage.sender}`);
    console.log(`   Message Text (Cleaned): "${receivedMessage.text}"`);

    if (receivedMessage.text !== testMessageText) {
      throw new Error('Received message text does not match sent message.');
    }

    // 7B. Test Send & Receive Media Message (Image)
    console.log('\n⏳ Testing media send_message & new_message events...');
    let receivedMediaMessage: any = null;

    // Reset listener to capture the media message
    socket2.off('new_message');
    socket2.on('new_message', (msg: any) => {
      if (msg.mediaType === 'image') {
        receivedMediaMessage = msg;
      }
    });

    const testMediaUrl = 'https://storage.googleapis.com/iraiinai-bucket/chats/test-image.jpg';
    socket1.emit('send_message', { matchId, text: '', mediaUrl: testMediaUrl, mediaType: 'image' });

    await delay(800);

    if (!receivedMediaMessage) {
      throw new Error('Media message was not received by client 2.');
    }

    console.log('✅ Media message received in real-time by client 2!');
    console.log(`   Media Type: ${receivedMediaMessage.mediaType}`);
    console.log(`   Media URL: "${receivedMediaMessage.mediaUrl}"`);

    if (receivedMediaMessage.mediaType !== 'image' || receivedMediaMessage.mediaUrl !== testMediaUrl) {
      throw new Error('Received media message attributes are incorrect.');
    }

    // 8. Assert DB Encryption
    console.log('\n⏳ Validating database encryption-at-rest...');
    const chatDoc = await Chat.findOne({ match: matchId });
    if (!chatDoc || chatDoc.messages.length < 2) {
      throw new Error('Chat document or messages are missing in DB.');
    }

    // Check text message encryption
    const dbMessageText = chatDoc.messages[0].text;
    console.log(`   Database raw encrypted string: "${dbMessageText}"`);

    if (dbMessageText === testMessageText) {
      throw new Error('CRITICAL FAILURE: Message is saved in plaintext in the database!');
    }

    if (!dbMessageText.includes(':')) {
      throw new Error('Database encrypted string is not in standard iv:ciphertext format.');
    }

    const decryptedText = decrypt(dbMessageText);
    console.log(`   Decrypted text output check: "${decryptedText}"`);
    if (decryptedText !== testMessageText) {
      throw new Error('Failed to correctly decrypt DB ciphertext.');
    }

    // Check media message storage
    const dbMediaMsg = chatDoc.messages[1];
    console.log(`   Database mediaType check: "${dbMediaMsg.mediaType}"`);
    console.log(`   Database mediaUrl check: "${dbMediaMsg.mediaUrl}"`);

    if (dbMediaMsg.mediaType !== 'image' || dbMediaMsg.mediaUrl !== testMediaUrl) {
      throw new Error('Database media message properties are incorrect.');
    }

    console.log('✅ Encryption-at-rest & media storage validated. Messages are strictly encrypted via AES-256-CBC.');

    // 9. Test Typing Indicators
    console.log('\n⏳ Testing typing indicators...');
    let typingState: any = null;

    socket2.on('typing_status', (data: any) => {
      typingState = data;
    });

    socket1.emit('typing_start', { matchId });
    await delay(300);

    if (!typingState || !typingState.isTyping || typingState.userId !== uid1) {
      throw new Error('Typing start event was not received correctly.');
    }
    console.log('✅ Typing start broadcast received successfully.');

    socket1.emit('typing_stop', { matchId });
    await delay(300);

    if (!typingState || typingState.isTyping) {
      throw new Error('Typing stop event was not received correctly.');
    }
    console.log('✅ Typing stop broadcast received successfully.');

    // 10. Test Read Receipts
    console.log('\n⏳ Testing mark_read & messages_read events...');
    let readStatusReceived = false;

    socket1.on('messages_read', (data: any) => {
      if (data.matchId === matchId && data.readerId === uid2) {
        readStatusReceived = true;
      }
    });

    socket2.emit('mark_read', { matchId });
    await delay(500);

    if (!readStatusReceived) {
      throw new Error('Read receipt broadcast not received by sender.');
    }

    const updatedChatDoc = await Chat.findOne({ match: matchId });
    if (!updatedChatDoc || !updatedChatDoc.messages[0].isRead) {
      throw new Error('Message isRead field was not updated to true in MongoDB.');
    }
    console.log('✅ Read receipt sync completed and verified in DB.');

    console.log('\n🏆 ALL SECURE CHAT INTEGRATION TESTS PASSED SUCCESSFULLY! 🏆');

  } catch (error: any) {
    console.error(`\n❌ TEST FAILURE: ${error.message}`);
  } finally {
    if (socket1) socket1.disconnect();
    if (socket2) socket2.disconnect();
    await mongoose.disconnect();
    console.log('\n🔌 Cleaned up connections and disconnected from MongoDB.');
  }
};

runTests();
