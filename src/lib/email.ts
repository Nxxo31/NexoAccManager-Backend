import nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { sign, verify, JwtPayload } from 'jsonwebtoken';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'NexoAccManager <noreply@nexoaccmanager.com>';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// ─── JWT helpers for email/reset tokens ────────────────────────────────────
// Tokens are stored in DB fields and encoded as JWTs for tamper-proof transport.
// JWT_SECRET is a separate secret from the RS256 keys used for auth tokens.

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return secret;
};

export type EmailTokenPayload = { userId: string; email: string; purpose: 'verify' | 'reset' };

export function generateEmailToken(userId: string, email: string, purpose: 'verify' | 'reset'): string {
  return sign({ userId, email, purpose }, getJwtSecret(), {
    expiresIn: purpose === 'verify' ? '7d' : '1h',
    jwtid: randomUUID(),
  });
}

export function verifyEmailToken(token: string): EmailTokenPayload {
  const payload = verify(token, getJwtSecret()) as JwtPayload;
  if (!['verify', 'reset'].includes(payload.purpose as string)) {
    throw new Error('Invalid token purpose');
  }
  return {
    userId: payload.userId as string,
    email: payload.email as string,
    purpose: payload.purpose as 'verify' | 'reset',
  };
}

// ─── Transporter ───────────────────────────────────────────────────────────
// In development (no SMTP configured): use Ethereal for preview links
// In production: use configured SMTP (Resend, Mailgun, etc.)
let transporter: nodemailer.Transporter | null = null;

async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    // Production SMTP
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  } else {
    // Development: create a test account on Ethereal
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('[Email] Using Ethereal test account:', testAccount.user);
    console.log('[Email] View sent emails at: https://ethereal.email/logout');
  }

  return transporter;
}

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<{ messageId: string; previewUrl?: string }> {
  const transport = await getTransporter();
  const info = await transport.sendMail({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });

  // Get Ethereal preview URL for development emails
  const previewUrl = (info.messageId && !SMTP_HOST)
    ? nodemailer.getTestMessageUrl(info) || undefined
    : undefined;

  if (previewUrl) {
    console.log(`[Email] Preview: ${previewUrl}`);
  }

  return { messageId: info.messageId, previewUrl };
}

// ─── Email templates ────────────────────────────────────────────────────────

export async function sendVerificationEmail(userId: string, email: string): Promise<{ messageId: string; previewUrl?: string }> {
  const token = generateEmailToken(userId, email, 'verify');
  const verifyUrl = `${FRONTEND_URL}/es/verify-email/${encodeURIComponent(token)}`;

  return sendEmail({
    to: email,
    subject: 'Verifica tu cuenta — NexoAccManager',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0D0D0D; color: #fff; padding: 24px;">
  <div style="max-width: 500px; margin: 0 auto; background: #161616; border-radius: 12px; padding: 32px; border: 1px solid #2A2A2A;">
    <h1 style="color: #DE350D; margin: 0 0 16px;">NexoAccManager</h1>
    <p style="color: #A0A0A0;">¡Gracias por registrarte! Haz clic en el botón para verificar tu cuenta:</p>
    <a href="${verifyUrl}" style="display: inline-block; background: #DE350D; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">Verificar cuenta</a>
    <p style="color: #A0A0A0; font-size: 12px;">O copia este enlace: ${verifyUrl}</p>
    <p style="color: #555; font-size: 11px; margin-top: 24px;">Este enlace expira en 7 días.</p>
  </div>
</body>
</html>`,
  });
}

export async function sendPasswordResetEmail(userId: string, email: string): Promise<{ messageId: string; previewUrl?: string }> {
  const token = generateEmailToken(userId, email, 'reset');
  const resetUrl = `${FRONTEND_URL}/es/reset-password/${encodeURIComponent(token)}`;

  return sendEmail({
    to: email,
    subject: 'Restablece tu contraseña — NexoAccManager',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; background: #0D0D0D; color: #fff; padding: 24px;">
  <div style="max-width: 500px; margin: 0 auto; background: #161616; border-radius: 12px; padding: 32px; border: 1px solid #2A2A2A;">
    <h1 style="color: #DE350D; margin: 0 0 16px;">NexoAccManager</h1>
    <p style="color: #A0A0A0;">Recibiste este email porque solicitaste restablecer tu contraseña. Haz clic en el botón:</p>
    <a href="${resetUrl}" style="display: inline-block; background: #6347FF; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin: 16px 0;">Restablecer contraseña</a>
    <p style="color: #A0A0A0; font-size: 12px;">O copia este enlace: ${resetUrl}</p>
    <p style="color: #FF4757; font-size: 12px; margin-top: 16px;">Si no fuiste tú, ignora este email.</p>
    <p style="color: #555; font-size: 11px; margin-top: 24px;">Este enlace expira en 1 hora.</p>
  </div>
</body>
</html>`,
  });
}