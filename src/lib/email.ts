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

export function transporter(opts: { pool?: boolean } = {}) {
  const host = import.meta.env.SMTP_HOST || process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = Number(import.meta.env.SMTP_PORT || process.env.SMTP_PORT || 465);
  const user = import.meta.env.SMTP_USER || process.env.SMTP_USER || '';
  const pass = import.meta.env.SMTP_PASS || process.env.SMTP_PASS || '';
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    // A pooled transport keeps a handful of connections open and reuses them,
    // which is what makes a 25-address batch take seconds instead of a minute.
    // One-off sends (a welcome letter) leave this off and close after use.
    ...(opts.pool ? { pool: true, maxConnections: 3, maxMessages: 40 } : {}),
  });
}

export type Transport = ReturnType<typeof transporter>;

/**
 * Send one message. Pass a shared transport when sending a batch: a newsletter
 * run used to open a fresh TCP+TLS+AUTH connection per recipient, which is slow
 * (most of the send budget went on handshakes) and gets throttled by the mailbox
 * host long before the list is finished. One connection for a whole batch,
 * closed by the caller when the batch ends.
 */
export async function sendMail(
  opts: { to: string; subject: string; html: string; text: string },
  shared?: Transport,
) {
  const t = shared ?? transporter();
  try {
    await t.sendMail({
      from: fromAddress(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
  } finally {
    // A transport we created is a connection we own; one passed in belongs to
    // the caller's batch.
    if (!shared) t.close();
  }
}
