import nodemailer from 'nodemailer';

export function smtpConfigured() {
  return Boolean(
    (import.meta.env.SMTP_HOST || process.env.SMTP_HOST) &&
    (import.meta.env.SMTP_USER || process.env.SMTP_USER) &&
    (import.meta.env.SMTP_PASS || process.env.SMTP_PASS)
  );
}

function fromAddress() {
  return import.meta.env.EMAIL_FROM || process.env.EMAIL_FROM || 'Joseph Bae <newsletter@baejoseph.com>';
}

export function transporter() {
  const host = import.meta.env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = Number(import.meta.env.SMTP_PORT || process.env.SMTP_PORT || 465);
  const user = import.meta.env.SMTP_USER || process.env.SMTP_USER || '';
  const pass = import.meta.env.SMTP_PASS || process.env.SMTP_PASS || '';
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendMail(opts: { to: string; subject: string; html: string; text: string }) {
  const t = transporter();
  await t.sendMail({
    from: fromAddress(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}
