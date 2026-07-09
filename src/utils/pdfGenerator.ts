import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { ITransaction } from '../models/Transaction';
import { IUser } from '../models/User';
import { logger } from './logger';

export const generateInvoice = async (
  transaction: ITransaction,
  user: IUser,
  hostHeader: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const invoiceFileName = `invoice_${transaction._id}.pdf`;
      
      const uploadsDir = path.join(__dirname, '../../uploads/invoices');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const filePath = path.join(uploadsDir, invoiceFileName);
      const writeStream = fs.createWriteStream(filePath);
      
      doc.pipe(writeStream);

      // --- Header ---
      doc.fontSize(24).font('Helvetica-Bold').text('IRAI INAI', { align: 'right' });
      doc.fontSize(10).font('Helvetica').text('AI-Powered Matrimony', { align: 'right' });
      doc.text('123 Innovation Drive, Tech Park', { align: 'right' });
      doc.text('Chennai, TN, India 600001', { align: 'right' });
      doc.moveDown(2);

      // --- Invoice Details ---
      doc.fontSize(20).font('Helvetica-Bold').text('INVOICE', 50, 160);
      doc.fontSize(10).font('Helvetica')
         .text(`Invoice Number: INV-${transaction._id.toString().substring(0, 8).toUpperCase()}`, 50, 190)
         .text(`Date: ${transaction.createdAt.toLocaleDateString()}`, 50, 205)
         .text(`Transaction ID: ${transaction.razorpayPaymentId || transaction._id}`, 50, 220);

      // --- Billed To ---
      doc.text('Billed To:', 300, 190)
         .font('Helvetica-Bold').text(`${user.email || user.phone}`, 300, 205)
         .font('Helvetica').text(`Phone: ${user.phone}`, 300, 220);

      doc.moveDown(3);

      // --- Table Header ---
      const tableTop = 280;
      doc.font('Helvetica-Bold');
      doc.text('Description', 50, tableTop);
      doc.text('Amount', 400, tableTop, { width: 100, align: 'right' });
      doc.moveTo(50, tableTop + 15).lineTo(500, tableTop + 15).stroke();
      
      // --- Table Row ---
      doc.font('Helvetica');
      doc.text(`IraiInai ${transaction.plan.charAt(0).toUpperCase() + transaction.plan.slice(1)} Subscription`, 50, tableTop + 25);
      doc.text(`${transaction.currency} ${(transaction.amount + (transaction.discountApplied || 0)).toFixed(2)}`, 400, tableTop + 25, { width: 100, align: 'right' });

      // --- Discount ---
      if (transaction.discountApplied && transaction.discountApplied > 0) {
        doc.text(`Discount (${transaction.couponCode || 'Promo'})`, 50, tableTop + 45);
        doc.text(`- ${transaction.currency} ${transaction.discountApplied.toFixed(2)}`, 400, tableTop + 45, { width: 100, align: 'right' });
      }

      doc.moveTo(50, tableTop + 65).lineTo(500, tableTop + 65).stroke();

      // --- Total ---
      doc.font('Helvetica-Bold');
      doc.text('Total Paid', 300, tableTop + 80);
      doc.text(`${transaction.currency} ${transaction.amount.toFixed(2)}`, 400, tableTop + 80, { width: 100, align: 'right' });

      // --- Footer ---
      doc.fontSize(10).font('Helvetica').text(
        'Thank you for upgrading your IraiInai experience!',
        50,
        700,
        { align: 'center', width: 400 }
      );

      doc.end();

      writeStream.on('finish', () => {
        const scheme = 'http';
        const localUrl = `${scheme}://${hostHeader}/uploads/invoices/${invoiceFileName}`;
        resolve(localUrl);
      });

      writeStream.on('error', (err) => {
        logger.error(`Error writing PDF: ${err.message}`);
        reject(err);
      });

    } catch (err: any) {
      logger.error(`PDF generation failed: ${err.message}`);
      reject(err);
    }
  });
};
