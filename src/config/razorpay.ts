import Razorpay from 'razorpay';
import { ENV } from './env';
import { logger } from '../utils/logger';

let razorpayClient: Razorpay;

try {
  razorpayClient = new Razorpay({
    key_id: ENV.RAZORPAY_KEY_ID,
    key_secret: ENV.RAZORPAY_KEY_SECRET,
  });
  logger.info('Razorpay Client initialized.');
} catch (error: any) {
  logger.error(`Error initializing Razorpay Client: ${error.message}`);
  // Fallback mock to prevent crashing
  razorpayClient = new Razorpay({
    key_id: 'mock_id',
    key_secret: 'mock_secret',
  });
}

export { razorpayClient };
