import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger';
import { verifyAccessToken } from '../utils/jwt';
import { User } from '../models/User';
import { Chat } from '../models/Chat';
import { Match } from '../models/Match';
import { CallLog } from '../models/CallLog';
import { ChatSettings } from '../models/ChatSettings';
import { ModerationService } from './moderation.service';
import { encrypt } from '../utils/crypto';

// Track active call invitations to support 30-second missed-call timeout
const pendingCallTimers = new Map<string, ReturnType<typeof setTimeout>>();

export class SocketService {
  private static io: SocketIOServer | null = null;
  private static userSockets = new Map<string, string[]>();

  public static init(server: HTTPServer): SocketIOServer {
    this.io = new SocketIOServer(server, {
      cors: { origin: '*', methods: ['GET', 'POST'] },
    });

    // ─── Authentication middleware ─────────────────────────────────────────────
    this.io.use(async (socket: Socket, next) => {
      try {
        let token = socket.handshake.auth?.token || socket.handshake.query?.token;
        if (!token) {
          return next(new Error('Authentication error: Token is required.'));
        }
        if (typeof token === 'string' && token.startsWith('Bearer ')) {
          token = token.substring(7);
        }

        let user;
        if (process.env.NODE_ENV !== 'production' && token.startsWith('mock')) {
          const firebaseId = `mock-user-uid-${token}`;
          user = await User.findOne({ firebaseId });
          if (!user) {
            return next(new Error('Authentication error: Mock user not found.'));
          }
        } else {
          const payload = verifyAccessToken(token);
          user = await User.findById(payload.userId);
          if (!user) {
            return next(new Error('Authentication error: User not found.'));
          }
        }

        // Reject suspended/banned users
        if (user.isSuspended || !user.isActive) {
          return next(new Error('Authentication error: Account suspended or deactivated.'));
        }

        (socket as any).user = user;
        (socket as any).userId = user._id.toString();
        next();
      } catch (error: any) {
        logger.error(`Socket auth error: ${error.message}`);
        next(new Error('Authentication error: Internal server error.'));
      }
    });

    this.io.on('connection', (socket: Socket) => {
      const userId = (socket as any).userId as string;
      const userEmail = (socket as any).user?.email;
      logger.info(`Socket connected: ${socket.id} | User: ${userId}`);

      this.addUserSocket(userId, socket.id);
      this.broadcastPresence(userId, 'online');

      // ─── 1. Join Chat Room ─────────────────────────────────────────────────
      socket.on('join_chat', async ({ matchId }) => {
        try {
          if (!matchId) return socket.emit('error_message', { message: 'matchId is required.' });
          const match = await Match.findById(matchId);
          if (!match || match.status !== 'matched') {
            return socket.emit('error_message', { message: 'Mutual match not found or invalid.' });
          }
          const isParticipant = match.user1.toString() === userId || match.user2.toString() === userId;
          if (!isParticipant) return socket.emit('error_message', { message: 'Unauthorized.' });

          socket.join(matchId);
          logger.info(`User ${userId} joined room ${matchId}`);
          socket.emit('joined_chat', { matchId });
        } catch (err: any) {
          logger.error(`join_chat error: ${err.message}`);
          socket.emit('error_message', { message: 'Failed to join chat room.' });
        }
      });

      // ─── 2. Send Message (with block check + moderation) ──────────────────
      socket.on('send_message', async ({ matchId, text, mediaUrl, mediaType }) => {
        try {
          if (!matchId || (!text && !mediaUrl)) {
            return socket.emit('error_message', { message: 'Invalid message payload.' });
          }

          // --- Load chat & verify participant ---
          let chat = await Chat.findOne({ match: matchId });
          if (!chat) {
            const match = await Match.findById(matchId);
            if (!match || match.status !== 'matched') {
              return socket.emit('error_message', { message: 'Cannot message an unmatched profile.' });
            }
            const isParticipant = match.user1.toString() === userId || match.user2.toString() === userId;
            if (!isParticipant) return socket.emit('error_message', { message: 'Unauthorized.' });
            chat = await Chat.create({
              match: matchId,
              participants: [match.user1, match.user2],
              messages: [],
              lastMessageAt: new Date(),
            });
          } else {
            const isParticipant = chat.participants.some(p => p.toString() === userId);
            if (!isParticipant) return socket.emit('error_message', { message: 'Unauthorized chat access.' });
          }

          const recipientId = chat.participants.find(p => p.toString() !== userId)?.toString();
          if (!recipientId) return;

          // --- Block check ---
          const blocked = await ModerationService.isBlocked(userId, recipientId);
          if (blocked) {
            return socket.emit('error_message', { message: 'You cannot message this user.' });
          }

          // --- Subscription feature gates: Free users cannot send media messages ---
          const sender = await User.findById(userId);
          const senderPlan = sender?.subscription?.plan || 'free';
          const senderSubActive = sender?.subscription?.status === 'active';

          if (mediaUrl && (senderPlan === 'free' || !senderSubActive)) {
            return socket.emit('message_blocked', {
              matchId,
              reason: 'media_disabled_free_tier',
              message: 'Sharing media files requires a Gold or Platinum upgrade.',
            });
          }

          // --- Subscription feature gates: Free users are limited to 10 messages per match ---
          const isPremiumSender = senderSubActive && ['gold', 'platinum'].includes(senderPlan);
          if (!isPremiumSender) {
            const userMessagesCount = chat.messages.filter(m => m.sender.toString() === userId).length;
            if (userMessagesCount >= 10) {
              return socket.emit('message_blocked', {
                matchId,
                reason: 'chat_limit_exceeded',
                message: 'You have reached the free chat limit of 10 messages for this match. Upgrade to Gold or Platinum for unlimited chat!',
              });
            }
          }

          // --- Shadowban Enforcement ---
          if (sender?.isShadowBanned) {
             logger.warn(`[Security] Shadowbanned user ${userId} sending message. Faking delivery.`);
             const fakeEncryptedText = encrypt(text || '');
             const fakeMessage = {
                sender: userId,
                text: fakeEncryptedText,
                mediaUrl,
                mediaType: mediaType || 'text',
                isRead: false,
                isHidden: true, // Hidden from recipient
                timestamp: new Date(),
             };
             chat.messages.push(fakeMessage as any);
             await chat.save();
             
             // Emit back ONLY to the sender so their UI updates
             const savedMsg = chat.messages[chat.messages.length - 1];
             socket.emit('new_message', {
                _id: savedMsg._id,
                matchId,
                sender: userId,
                text,
                mediaUrl,
                mediaType: savedMsg.mediaType || 'text',
                isRead: false,
                timestamp: savedMsg.timestamp,
             });
             return;
          }
          // ------------------------------

          // --- Chat settings: media & link enforcement ---
          const settings = await ChatSettings.findOne({ matchId }).lean();
          if (mediaUrl && settings && !settings.mediaEnabled) {
            return socket.emit('message_blocked', {
              matchId,
              reason: 'media_disabled',
              message: 'Media sharing has been disabled in this chat.',
            });
          }

          // --- Text moderation scan ---
          let processedText = text || '';
          if (processedText) {
            // Strip links if link sharing disabled
            if (settings && !settings.linkSharingEnabled) {
              processedText = ModerationService.stripLinks(processedText);
            }

            const scanResult = ModerationService.scan(processedText);

            // Behavioral Fast-Linking Check: Sending links/numbers in first 3 messages
            const userMessageCount = chat.messages.filter(m => m.sender.toString() === userId).length;
            if (userMessageCount < 3 && (processedText.includes('http') || /\d{8,}/.test(processedText))) {
               if (sender) {
                  sender.trustScore = Math.max(0, sender.trustScore - 40); // Huge penalty
                  if (sender.trustScore < 30) sender.isShadowBanned = true;
                  await sender.save();
                  logger.warn(`[Security] User ${userId} sent links/numbers too quickly. TrustScore dropped to ${sender.trustScore}.`);
               }
            }

            if (!scanResult.safe) {
              if (sender) {
                 sender.trustScore = Math.max(0, sender.trustScore - (scanResult.severity === 'high' ? 50 : 20));
                 if (sender.trustScore < 30) sender.isShadowBanned = true;
                 await sender.save();
              }

              if (scanResult.severity === 'high' || sender?.isShadowBanned) {
                // Block the message entirely
                socket.emit('message_blocked', {
                  matchId,
                  reason: 'safety_violation',
                  flags: scanResult.flags,
                  message: `Your message was blocked: ${scanResult.flagDescriptions.join(', ')}.`,
                });
                await ModerationService.log(userId, recipientId, matchId, processedText, scanResult, 'blocked');
                await ModerationService.applyWarning(userId, 'high');
                logger.warn(`[Moderation] HIGH severity message blocked. User: ${userId}, Flags: ${scanResult.flags.join(', ')}`);
                return;
              } else {
                // Deliver but flag for admin
                await ModerationService.log(userId, recipientId, matchId, processedText, scanResult, scanResult.severity === 'medium' ? 'delivered_flagged' : 'delivered');
                if (scanResult.severity === 'medium') {
                  socket.emit('message_flagged', {
                    matchId,
                    flags: scanResult.flags,
                    message: 'Your message was flagged for review.',
                  });
                }
                await ModerationService.applyWarning(userId, scanResult.severity as 'low' | 'medium' | 'high');
              }
            }
          }

          // --- Save encrypted message ---
          const encryptedText = encrypt(processedText);
          const newMessage = {
            sender: userId,
            text: encryptedText,
            mediaUrl,
            mediaType: mediaType || 'text',
            isRead: false,
            timestamp: new Date(),
          };
          chat.messages.push(newMessage as any);
          chat.lastMessageAt = new Date();
          await chat.save();

          const savedMsg = chat.messages[chat.messages.length - 1];
          const emitPayload = {
            _id: savedMsg._id,
            matchId,
            sender: userId,
            text: processedText,
            mediaUrl,
            mediaType: savedMsg.mediaType || 'text',
            isRead: false,
            timestamp: savedMsg.timestamp,
          };

          this.io?.to(matchId).emit('new_message', emitPayload);
          logger.info(`Message broadcast for match ${matchId} from ${userId}`);

          // FCM Push Notification fallback for offline/backgrounded recipient
          const calleeSocketIds = this.userSockets.get(recipientId) || [];
          const roomSockets = this.io?.sockets.adapter.rooms.get(matchId) || new Set();
          const isRecipientInRoom = calleeSocketIds.some(sid => roomSockets.has(sid));

          if (!isRecipientInRoom) {
            const { Profile } = require('../models/Profile');
            const { FirebaseService } = require('./firebase.service');

            Profile.findOne({ user: userId })
              .then((senderProfile: any) => {
                const senderName = senderProfile?.name || 'A user';
                const bodyText = mediaUrl ? `Sent a ${mediaType || 'file'}` : processedText;

                FirebaseService.sendToUser(recipientId, `Message from ${senderName}`, bodyText, {
                  type: 'chat',
                  matchId,
                  senderId: userId,
                }).catch((pErr: any) => {
                  logger.error(`Failed to send chat push notification: ${pErr.message}`);
                });
              })
              .catch((dbErr: any) => {
                logger.error(`Error loading sender profile for chat push: ${dbErr.message}`);
              });
          }
        } catch (err: any) {
          logger.error(`send_message error: ${err.message}`);
          socket.emit('error_message', { message: 'Failed to send message.' });
        }
      });

      // ─── 3. Typing Indicators ──────────────────────────────────────────────
      socket.on('typing_start', ({ matchId }) => {
        if (!matchId) return;
        socket.to(matchId).emit('typing_status', { matchId, userId, isTyping: true });
      });
      socket.on('typing_stop', ({ matchId }) => {
        if (!matchId) return;
        socket.to(matchId).emit('typing_status', { matchId, userId, isTyping: false });
      });

      // ─── 4. Mark Messages Read ─────────────────────────────────────────────
      socket.on('mark_read', async ({ matchId }) => {
        try {
          if (!matchId) return;
          const chat = await Chat.findOne({ match: matchId });
          if (!chat) return;
          let count = 0;
          chat.messages.forEach(msg => {
            if (msg.sender.toString() !== userId && !msg.isRead) {
              msg.isRead = true;
              count++;
            }
          });
          if (count > 0) {
            await chat.save();
            this.io?.to(matchId).emit('messages_read', { matchId, readerId: userId });
          }
        } catch (err: any) {
          logger.error(`mark_read error: ${err.message}`);
        }
      });

      // ─── 5. Presence Query ─────────────────────────────────────────────────
      socket.on('query_presence', ({ userId: queryUserId }) => {
        if (!queryUserId) return;
        const isOnline = this.userSockets.has(queryUserId.toString());
        socket.emit('presence_response', { userId: queryUserId, status: isOnline ? 'online' : 'offline' });
      });

      // ─── 6. Screenshot Detected ────────────────────────────────────────────
      socket.on('screenshot_detected', async ({ matchId }) => {
        if (!matchId) return;
        // Notify the other participant
        socket.to(matchId).emit('partner_screenshot', { matchId, userId });
        logger.info(`[Safety] Screenshot detected by ${userId} in match ${matchId}`);
      });

      // ─── 7. Chat Settings Changed ──────────────────────────────────────────
      socket.on('settings_updated', ({ matchId, settings }) => {
        if (!matchId || !settings) return;
        // Broadcast updated settings to both participants
        this.io?.to(matchId).emit('chat_settings_updated', { matchId, settings });
      });

      // ─── CALL SIGNALING ───────────────────────────────────────────────────
      socket.on('call_initiate', async ({ matchId, callType, callerName, callerPhoto }) => {
        try {
          if (!matchId || !callType) {
            return socket.emit('call_error', { message: 'matchId and callType required.' });
          }
          const match = await Match.findById(matchId);
          if (!match || match.status !== 'matched') {
            return socket.emit('call_error', { message: 'No valid mutual match found.' });
          }
          const isParticipant = match.user1.toString() === userId || match.user2.toString() === userId;
          if (!isParticipant) return socket.emit('call_error', { message: 'Unauthorized.' });

          // Enforce calling feature gates based on caller's subscription plan
          const caller = await User.findById(userId);
          const callerPlan = caller?.subscription?.plan || 'free';
          const callerSubActive = caller?.subscription?.status === 'active';

          if (callerPlan === 'free' || !callerSubActive) {
            return socket.emit('call_error', { message: 'Initiating calls requires a Gold or Platinum upgrade.' });
          }

          if (callType === 'video' && callerPlan !== 'platinum') {
            return socket.emit('call_error', { message: 'Video calling is a premium feature exclusive to Platinum members.' });
          }

          const calleeId = match.user1.toString() === userId ? match.user2.toString() : match.user1.toString();

          // Block check for calls
          const blocked = await ModerationService.isBlocked(userId, calleeId);
          if (blocked) {
            return socket.emit('call_error', { message: 'Cannot call this user.' });
          }

          const calleeSocketIds = this.userSockets.get(calleeId) || [];
          const callLog = await CallLog.create({
            caller: userId,
            callee: calleeId,
            matchId,
            callType,
            status: 'ongoing',
            channelName: matchId,
          });

          const callPayload = {
            callLogId: callLog._id.toString(),
            matchId,
            callType,
            callerId: userId,
            callerName: callerName || 'Unknown',
            callerPhoto: callerPhoto || null,
          };

          if (calleeSocketIds.length > 0) {
            calleeSocketIds.forEach(sid => this.io?.to(sid).emit('incoming_call', callPayload));
          } else {
            callLog.status = 'missed';
            callLog.endedAt = new Date();
            await callLog.save();
            socket.emit('call_ended', { reason: 'callee_offline', callLogId: callLog._id });
            return;
          }

          socket.emit('call_ringing', { callLogId: callLog._id.toString(), matchId });

          const timer = setTimeout(async () => {
            pendingCallTimers.delete(callLog._id.toString());
            const log = await CallLog.findById(callLog._id);
            if (log && log.status === 'ongoing') {
              log.status = 'missed';
              log.endedAt = new Date();
              await log.save();
              socket.emit('call_ended', { reason: 'no_answer', callLogId: callLog._id.toString() });
              calleeSocketIds.forEach(sid => this.io?.to(sid).emit('call_ended', { reason: 'no_answer', callLogId: callLog._id.toString() }));
            }
          }, 30000);
          pendingCallTimers.set(callLog._id.toString(), timer);
        } catch (err: any) {
          logger.error(`call_initiate error: ${err.message}`);
          socket.emit('call_error', { message: 'Failed to initiate call.' });
        }
      });

      socket.on('call_accepted', async ({ callLogId, matchId }) => {
        try {
          if (!callLogId) return;
          const timer = pendingCallTimers.get(callLogId);
          if (timer) { clearTimeout(timer); pendingCallTimers.delete(callLogId); }
          const callLog = await CallLog.findById(callLogId);
          if (!callLog) return;
          callLog.status = 'answered';
          callLog.startedAt = new Date();
          await callLog.save();
          const callerSockets = this.userSockets.get(callLog.caller.toString()) || [];
          callerSockets.forEach(sid => this.io?.to(sid).emit('call_accepted', { callLogId, matchId }));
        } catch (err: any) {
          logger.error(`call_accepted error: ${err.message}`);
        }
      });

      socket.on('call_declined', async ({ callLogId, matchId }) => {
        try {
          if (!callLogId) return;
          const timer = pendingCallTimers.get(callLogId);
          if (timer) { clearTimeout(timer); pendingCallTimers.delete(callLogId); }
          const callLog = await CallLog.findById(callLogId);
          if (!callLog) return;
          callLog.status = 'declined';
          callLog.endedAt = new Date();
          await callLog.save();
          const callerSockets = this.userSockets.get(callLog.caller.toString()) || [];
          callerSockets.forEach(sid => this.io?.to(sid).emit('call_ended', { reason: 'declined', callLogId, matchId }));
        } catch (err: any) {
          logger.error(`call_declined error: ${err.message}`);
        }
      });

      socket.on('call_ended', async ({ callLogId, matchId, durationSeconds }) => {
        try {
          if (!callLogId) return;
          const timer = pendingCallTimers.get(callLogId);
          if (timer) { clearTimeout(timer); pendingCallTimers.delete(callLogId); }
          const callLog = await CallLog.findById(callLogId);
          if (!callLog) return;
          if (callLog.status === 'ongoing' || callLog.status === 'answered') {
            callLog.status = 'answered';
            callLog.endedAt = new Date();
            callLog.durationSeconds = durationSeconds ?? (callLog.startedAt ? Math.round((Date.now() - callLog.startedAt.getTime()) / 1000) : 0);
            await callLog.save();
          }
          const otherId = callLog.caller.toString() === userId ? callLog.callee.toString() : callLog.caller.toString();
          const otherSockets = this.userSockets.get(otherId) || [];
          otherSockets.forEach(sid => this.io?.to(sid).emit('call_ended', { reason: 'hung_up', callLogId, matchId }));
        } catch (err: any) {
          logger.error(`call_ended error: ${err.message}`);
        }
      });

      // ─── Disconnect ────────────────────────────────────────────────────────
      socket.on('disconnect', () => {
        logger.info(`Socket disconnected: ${socket.id} | User: ${userId}`);
        this.removeUserSocket(userId, socket.id);
        this.broadcastPresence(userId, 'offline');
      });
    });

    return this.io;
  }

  public static getIO(): SocketIOServer {
    if (!this.io) throw new Error('Socket.io not initialized.');
    return this.io;
  }

  private static addUserSocket(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId) || [];
    if (!sockets.includes(socketId)) {
      sockets.push(socketId);
      this.userSockets.set(userId, sockets);
    }
  }

  private static removeUserSocket(userId: string, socketId: string) {
    let sockets = (this.userSockets.get(userId) || []).filter(id => id !== socketId);
    if (sockets.length > 0) {
      this.userSockets.set(userId, sockets);
    } else {
      this.userSockets.delete(userId);
    }
  }

  private static broadcastPresence(userId: string, status: 'online' | 'offline') {
    if (status === 'offline' && this.userSockets.has(userId)) return;
    if (this.io) {
      this.io.emit('user_presence', { userId, status });
      logger.info(`Presence: ${userId} → ${status}`);
    }
  }
}
