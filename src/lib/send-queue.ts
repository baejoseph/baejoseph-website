import { withSchema } from './db';
import { sendMail, smtpConfigured } from './email';
import { composePair, type Slot } from './newsletter';

function applyUnsub(s: string, token: string) {
  return s.replaceAll('{{UNSUB}}', encodeURIComponent(token));
}

function letterFor(item: Record<string, unknown>, lang: string) {
  const useKo = lang === 'ko' && item.html_ko;
  return {
    html: String((useKo ? item.html_ko : item.html) || item.html || ''),
    text: String((useKo ? item.text_body_ko : item.text_body) || item.text_body || ''),
    subject: String((useKo ? item.subject_ko : item.subject) || item.subject || ''),
  };
}

export async function sendQueueItem(id: number, opts?: { testTo?: string; lang?: 'en' | 'ko' }) {
  if (!smtpConfigured()) throw new Error('SMTP is not configured');
  const db = await withSchema();
  const rows = await db`SELECT * FROM queue_items WHERE id = ${id} LIMIT 1`;
  const item = rows[0] as Record<string, unknown> | undefined;
  if (!item) throw new Error('Queue item not found');

  if (!item.html || !item.html_ko) {
    const pair = await composePair(String(item.slug || item.slug_ko), item.slot as Slot, {
      en: String(item.note || ''),
      ko: String(item.note_ko || ''),
    });
    if (!pair) throw new Error(`Post not found: ${item.slug}`);
    if (pair.en) {
      item.html = pair.en.letter.html;
      item.text_body = pair.en.letter.text;
      item.subject = pair.en.letter.subject;
    }
    if (pair.ko) {
      item.html_ko = pair.ko.letter.html;
      item.text_body_ko = pair.ko.letter.text;
      item.subject_ko = pair.ko.letter.subject;
    }
  }

  let recipients: { email: string; unsub_token: string; lang: string }[];
  if (opts?.testTo) {
    recipients = [{ email: opts.testTo, unsub_token: 'test', lang: opts.lang || 'en' }];
  } else {
    const subRows = await db`
      SELECT email, unsub_token, lang FROM subscribers
      WHERE unsubscribed_at IS NULL
    `;
    recipients = subRows.map((s: { email: string; unsub_token: string; lang: string }) => ({
      email: s.email,
      unsub_token: s.unsub_token,
      lang: s.lang === 'ko' ? 'ko' : 'en',
    }));
  }

  let sent = 0;
  let failed = 0;
  let lastError = '';

  for (const r of recipients) {
    const letter = letterFor(item, r.lang);
    if (!letter.html) continue;
    try {
      await sendMail({
        to: r.email,
        subject: letter.subject,
        html: applyUnsub(letter.html, r.unsub_token),
        text: applyUnsub(letter.text, r.unsub_token),
      });
      sent += 1;
      if (!opts?.testTo) {
        await db`INSERT INTO send_log (queue_id, email, status) VALUES (${id}, ${r.email}, 'sent')`;
      }
    } catch (err) {
      failed += 1;
      lastError = err instanceof Error ? err.message : String(err);
      if (!opts?.testTo) {
        await db`INSERT INTO send_log (queue_id, email, status, error) VALUES (${id}, ${r.email}, 'failed', ${lastError})`;
      }
    }
  }

  if (!opts?.testTo) {
    const status = failed && !sent ? 'failed' : 'sent';
    await db`UPDATE queue_items SET status = ${status}, error = ${lastError || null}, sent_at = now() WHERE id = ${id}`;
  }

  return { sent, failed, lastError, recipientCount: recipients.length };
}

export async function sendDue(slot: Slot, dateIso: string) {
  const db = await withSchema();
  const due = await db`
    SELECT id FROM queue_items
    WHERE slot = ${slot} AND send_on = ${dateIso} AND status = 'queued'
  `;
  const results = [];
  for (const row of due) {
    results.push(await sendQueueItem(Number(row.id)));
  }
  return results;
}
