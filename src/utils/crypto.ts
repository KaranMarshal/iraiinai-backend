import crypto from 'crypto';
import { ENV } from '../config/env';

// Key length for aes-256-cbc is 32 bytes (256 bits)
const ENCRYPTION_KEY = Buffer.from(ENV.CHAT_ENCRYPTION_KEY.substring(0, 32));
const IV_LENGTH = 16; // For AES, this is always 16 bytes

/**
 * Encrypt a text string using AES-256-CBC
 */
export const encrypt = (text: string): string => {
  if (!text) return '';
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Format: iv_hex:encrypted_hex
    return iv.toString('hex') + ':' + encrypted;
  } catch (error: any) {
    console.error('Encryption failed:', error.message);
    return text; // Fallback to plain text if encryption fails
  }
};

/**
 * Decrypt a ciphertext string using AES-256-CBC
 */
export const decrypt = (encryptedText: string): string => {
  if (!encryptedText) return '';
  if (!encryptedText.includes(':')) {
    return encryptedText; // If not formatted, assume it is plain text
  }
  
  try {
    const textParts = encryptedText.split(':');
    const iv = Buffer.from(textParts.shift() || '', 'hex');
    const encryptedData = textParts.join(':');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error: any) {
    // If decryption fails, it could be legacy unencrypted data or incorrect key
    return encryptedText; 
  }
};
