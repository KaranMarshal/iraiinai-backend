import dotenv from 'dotenv';
import path from 'path';

// Load environmental variables
dotenv.config();

export const ENV = {
  PORT: process.env.PORT || '5000',
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/iraiinai',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || 'mock_key_id',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || 'mock_key_secret',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  JWT_SECRET: process.env.JWT_SECRET || 'iraiinai_secret_key_default',
  CHAT_ENCRYPTION_KEY: process.env.CHAT_ENCRYPTION_KEY || 'iraiinai_chat_secret_key_32chars',
  AGORA_APP_ID: process.env.AGORA_APP_ID || '',
  AGORA_APP_CERTIFICATE: process.env.AGORA_APP_CERTIFICATE || '',
  // Social Auth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  // Email / SMTP (Nodemailer)
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: process.env.SMTP_PORT || '587',
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || '',
};

// Check for critical missing API keys in production
if (ENV.NODE_ENV === 'production') {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('WARNING: GEMINI_API_KEY is not defined in production. AI matching will not work.');
  }
  if (ENV.RAZORPAY_KEY_ID === 'mock_key_id') {
    console.warn('WARNING: Running with mock Razorpay keys in production.');
  }
}
