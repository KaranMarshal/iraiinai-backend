import nodemailer, { Transporter } from 'nodemailer';
import { ENV } from '../config/env';
import { logger } from '../utils/logger';

// ─── Beautiful HTML Email Template ───────────────────────────────────────────

const buildOtpEmailHtml = (code: string): string => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>IraiInai — Verification Code</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0B;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0B;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0"
               style="background:linear-gradient(145deg,#1a1a1f,#121214);
                      border:1px solid rgba(197,160,89,0.25);
                      border-radius:20px;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center"
                style="background:linear-gradient(135deg,rgba(197,160,89,0.15),rgba(197,160,89,0.05));
                       padding:36px 40px 28px;border-bottom:1px solid rgba(197,160,89,0.12);">
              <div style="font-size:36px;margin-bottom:10px;">💍</div>
              <h1 style="margin:0;color:#C5A059;font-size:26px;font-weight:800;
                         letter-spacing:4px;text-transform:uppercase;">IRAI INAI</h1>
              <p style="margin:6px 0 0;color:rgba(197,160,89,0.6);font-size:11px;
                        letter-spacing:3px;text-transform:uppercase;">
                Divine Matrimonial Unions
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">
              <p style="color:#e8e8e8;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Your one-time verification code for IraiInai is:
              </p>

              <!-- OTP Box -->
              <div style="background:rgba(197,160,89,0.08);border:1.5px solid rgba(197,160,89,0.35);
                          border-radius:14px;padding:28px;text-align:center;margin:0 0 28px;">
                <div style="font-size:44px;font-weight:900;letter-spacing:14px;
                            color:#C5A059;font-family:'Courier New',monospace;">
                  ${code}
                </div>
              </div>

              <p style="color:rgba(200,200,200,0.7);font-size:13px;line-height:1.6;margin:0 0 8px;">
                ⏱ This code expires in <strong style="color:#C5A059;">10 minutes</strong>.
              </p>
              <p style="color:rgba(200,200,200,0.7);font-size:13px;line-height:1.6;margin:0;">
                🔒 Never share this code with anyone — IraiInai will never ask for it.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px 32px;border-top:1px solid rgba(197,160,89,0.08);">
              <p style="color:rgba(150,150,150,0.5);font-size:11px;text-align:center;margin:0;">
                If you didn't request this, ignore this email — your account is safe.<br/>
                © ${new Date().getFullYear()} IraiInai Matrimony. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const buildOtpEmailText = (code: string): string =>
  `Your IraiInai verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;

// ─── Email Service ────────────────────────────────────────────────────────────

export class EmailService {
  private static transporter: Transporter | null = null;

  /**
   * Lazily initialise the Nodemailer transporter.
   * Throws an error when SMTP env vars are absent.
   */
  private static async getTransporter(): Promise<Transporter> {
    if (this.transporter) return this.transporter;

    if (ENV.SMTP_HOST && ENV.SMTP_USER && ENV.SMTP_PASS) {
      // Production transporter (Gmail / SendGrid / custom SMTP)
      this.transporter = nodemailer.createTransport({
        host: ENV.SMTP_HOST,
        port: parseInt(ENV.SMTP_PORT, 10) || 587,
        secure: parseInt(ENV.SMTP_PORT, 10) === 465, // TLS on port 465
        auth: {
          user: ENV.SMTP_USER,
          pass: ENV.SMTP_PASS,
        },
      });
      logger.info('[EmailService] Production SMTP transporter initialised.');
    } else {
      throw new Error('SMTP credentials not configured.');
    }

    return this.transporter;
  }

  /**
   * Send an OTP email.
   * @returns true when sent (or simulated). Logs OTP directly to the terminal when SMTP is not configured.
   */
  static async sendOtp(toEmail: string, code: string): Promise<boolean> {
    try {
      if (!ENV.SMTP_HOST || !ENV.SMTP_USER || !ENV.SMTP_PASS) {
        logger.warn(`[EMAIL SIMULATION] SMTP not configured. OTP generated for ${toEmail}:`);
        logger.info(`
┌────────────────────────────────────────────────────────┐
│  IRAI INAI EMAIL OTP SIMULATION                       │
├────────────────────────────────────────────────────────┤
│  To: ${toEmail}
│  Subject: ${code} is your IraiInai verification code
│  OTP Code: ${code}
└────────────────────────────────────────────────────────┘
        `);
        return true;
      }

      const transporter = await this.getTransporter();

      const info = await transporter.sendMail({
        from: `"IraiInai Matrimony" <${ENV.SMTP_FROM || ENV.SMTP_USER || 'noreply@iraiinai.com'}>`,
        to: toEmail,
        subject: `${code} is your IraiInai verification code`,
        text: buildOtpEmailText(code),
        html: buildOtpEmailHtml(code),
      });

      logger.info(`[EmailService] Email sent to ${toEmail} (messageId: ${info.messageId})`);
      return true;
    } catch (err: any) {
      logger.error(`[EmailService] Failed to send OTP to ${toEmail}: ${err.message}`);
      return false;
    }
  }
}
