import { AppError } from 'ccms-shared';

// Transactional email. Three ways to deliver, picked from the environment:
//   1. SMTP (Gmail, Outlook, school mail server...)   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
//   2. Generic HTTP mail API                          EMAIL_API_URL (+ EMAIL_API_KEY as Bearer token)
//   3. Nothing configured: printed to the server console in development, an error in production.
// The same sender is reused by receipts in Sprint 4 (CC024).
let smtpTransport = null;

async function sendViaSmtp(message) {
  if (!smtpTransport) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(process.env.SMTP_PORT || 587);
    smtpTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  await smtpTransport.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

async function defaultSend(message) {
  if (process.env.SMTP_HOST) return sendViaSmtp(message);
  const url = process.env.EMAIL_API_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'production') throw new Error('No email delivery is configured (set SMTP_HOST or EMAIL_API_URL)');
    console.log(`[mail:console] To: ${message.to}\n[mail:console] Subject: ${message.subject}\n${message.text}`);
    return;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.EMAIL_API_KEY ?? ''}` },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email API responded ${response.status}`);
}

/** Tests only: drop the cached SMTP transport so env changes take effect. */
export function resetMailTransport() {
  smtpTransport = null;
}

let sender = defaultSend;

/** Tests replace the sender; pass null to restore the real one. */
export function setMailer(fn) {
  sender = fn ?? defaultSend;
}

export async function sendPasswordResetEmail({ to, name, link, expiresInMinutes }) {
  const text = `Hello ${name},\n\nUse this link to set a new password for your CCMS account. It expires in ${expiresInMinutes} minutes and can be used once:\n\n${link}\n\nIf you did not expect this email, you can ignore it.`;
  const html = `<p>Hello ${escapeHtml(name)},</p><p>Use this link to set a new password for your CCMS account. It expires in ${expiresInMinutes} minutes and can be used once:</p><p><a href="${escapeHtml(link)}">Set a new password</a></p><p>If you did not expect this email, you can ignore it.</p>`;
  try {
    await sender({ to, subject: 'Reset your CCMS password', text, html });
  } catch (err) {
    console.error('[identity] password reset email failed:', err.message);
    throw new AppError(502, 'EMAIL_DELIVERY_FAILED', 'Could not send the reset email. Try again.');
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
