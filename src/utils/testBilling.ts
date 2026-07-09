import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { User } from '../models/User';
import { Transaction } from '../models/Transaction';
import { generateInvoice } from './pdfGenerator';
import path from 'path';
import fs from 'fs';

dotenv.config();

const runTest = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/iraiinai');
    console.log('[Info] Connected to DB.');

    // Find or create test user
    let user = await User.findOne({ email: 'billing_test@iraiinai.com' });
    if (!user) {
      user = await User.create({
        email: 'billing_test@iraiinai.com',
        phone: '+919999988888',
        name: 'Billing Test User',
        gender: 'male',
        role: 'user',
        isProfileComplete: false,
        isPhoneVerified: true,
      });
    }

    // Create a mock transaction
    const transaction = await Transaction.create({
      user: user._id,
      razorpayOrderId: `order_test_${Date.now()}`,
      razorpayPaymentId: `pay_test_${Date.now()}`,
      amount: 1999,
      plan: 'gold',
      status: 'paid',
      signatureVerified: true,
      couponCode: 'WELCOME50',
      discountApplied: 50,
    });

    console.log(`[Info] Created test transaction: ${transaction._id}`);

    // Generate Invoice
    const invoiceUrl = await generateInvoice(transaction, user, 'localhost:5000');
    console.log(`[Success] Invoice generated successfully!`);
    console.log(`[Success] Invoice URL: ${invoiceUrl}`);

    transaction.invoiceUrl = invoiceUrl;
    await transaction.save();

    // Verify file exists on disk
    const fileName = `invoice_${transaction._id}.pdf`;
    const filePath = path.join(__dirname, '../../uploads/invoices', fileName);
    if (fs.existsSync(filePath)) {
      console.log(`[Success] Verified PDF file exists at: ${filePath}`);
      const stats = fs.statSync(filePath);
      console.log(`[Success] PDF file size: ${stats.size} bytes`);
    } else {
      console.error(`[Error] PDF file not found at: ${filePath}`);
    }

    // Cleanup
    await Transaction.deleteOne({ _id: transaction._id });
    await User.deleteOne({ _id: user._id });
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath); // delete test pdf
    }
    
    console.log('[Info] Test cleanup complete.');
    process.exit(0);
  } catch (err: any) {
    console.error(`[Test Failed] ${err.message}`);
    process.exit(1);
  }
};

runTest();
