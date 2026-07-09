import mongoose from 'mongoose';
import { ENV } from './env';
import { logger } from '../utils/logger';
export const connectDB = async (): Promise<void> => {
  try {
    const conn = await mongoose.connect(ENV.MONGO_URI);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    if (conn.connection.db) {
      // Drop legacy non-sparse unique index on razorpayOrderId to prevent null conflicts
      try {
        await conn.connection.db.collection('transactions').dropIndex('razorpayOrderId_1');
        logger.info('Legacy transactions unique index razorpayOrderId_1 dropped successfully.');
      } catch (_) {
        // Already dropped or never existed — safe to ignore
      }

      // Drop legacy non-sparse unique index on email so Mongoose can
      // recreate it as sparse (allowing multiple null email users)
      try {
        await conn.connection.db.collection('users').dropIndex('email_1');
        logger.info('Legacy users email_1 index dropped. Will be recreated as sparse by Mongoose.');
      } catch (_) {
        // Already dropped or never existed — safe to ignore
      }
    }
  } catch (error: any) {
    logger.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB connection lost. Reconnecting...');
});

mongoose.connection.on('error', (err) => {
  logger.error(`MongoDB connection error: ${err}`);
});
