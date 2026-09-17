import { sql } from './db';
import { sendMail, smtpConfigured } from './email';
import { buildNewsletter, excerptFromMarkdown, postBySlug, type Slot } from './newsletter';

export async function sendQueueItem(id: number, opts?: { testTo?: string }) {
  if (!smtpConfigured()) throw new Error('SMTP is not configured');
  const db = sql();
  const rows = await db`SELECT * FROM queue_items WHERE id = ${id} LIMIT 1`;
  const item = rows[0];
  if (!item) throw new Error('Queue item not found');

  const post = await postBySlug(String(item.slug));
  if (!post) throw new Error(`Post not found: ${item.slug}`);

  const lang = (post.data.lang ?? 'en') as string;
  const excerpt = excerptFromMarkdown(post.body ?? '');
  const date = post.data.date
    ? new Date(post.data.date).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';

  let recipients: { email: string; unsub_token: string }[];
  if (opts?.testTo) {
    recipients = [{ email: opts.testTo, unsub_token: 'test' }];
  } else {
    const subRows = await db`
      SELECT email, unsub_token, lang FROM subscribers
      WHERE unsubscribed_at IS NULL
    `;
    recipients = subRows
      .filter((s: { lang: string }) => s.lang === lang || s.lang === 'all')
      .map((s: { email: string; unsub_token: string }) => ({
        email: s.email,
        unsub_token: s.unsub_token,
      }));
  }

  let sent = 0;
  let failed = 0;
  let lastError = '';

  for (const r of recipients) {
    const letter = buildNewsletter({
      title: post.data.title as string,
      slug: post.slug,
      date,
      excerpt,
      image: (post.data.featuredImage as string) || '',
      unsubToken: r.unsub_token,
      kind: item.slot as Slot,
    });
    try {
      await sendMail({
        to: r.email,
        subject: item.subject || letter.subject,
        html: letter.html,
        text: letter.text,
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
  const db = sql();
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
