import { withSchema } from './db';
import { sendMail, smtpConfigured } from './email';
import { composePair, LIKE_PLACEHOLDER, type Slot } from './newsletter';
import { identityHash } from './identity';

/**
 * Sending used to be one long loop inside a single invocation: the function got
 * killed mid-batch, the queue item stayed 'queued', and nothing stopped a rerun
 * from mailing everyone twice. Now every recipient is *claimed* in send_log
 * before their letter goes out — the unique (queue_id, email) index makes that
 * claim atomic, so a rerun skips anyone already sent.
 */

/** Addresses per batch: keeps an invocation well inside the function timeout. */
export const CHUNK = 25;
/** Transient failures (greylisting, 4xx, timeouts) get retried this many times. */
export const MAX_ATTEMPTS = 3;
/**
 * A 'sending' row older than this belongs to an invocation that died mid-send.
 * Young enough that no live run can still own it, old enough that a lost letter
 * is worth one more try (a rare duplicate beats a silent no-show).
 */
export const STALE_SENDING_MS = 15 * 60 * 1000;

type Item = Record<string, any>;
type Letter = { html: string; text: string; subject: string; slug: string };
type Pair = NonNullable<Awaited<ReturnType<typeof composePair>>>;

export type SendSummary = {
  sent: number;
  failed: number;
  skipped: number;
  /** addresses still to send when this batch finished */
  remaining: number;
  done: boolean;
  status: string;
  test?: boolean;
};

/** Resolve the per-recipient tokens: their unsubscribe link and their anonymous
 *  like identity. Neither the token nor the address is guessable from the other. */
function personalize(letter: Letter, recipient: { unsub_token: string; email: string }): Letter {
  const token = encodeURIComponent(recipient.unsub_token);
  const like = identityHash(letter.slug, recipient.email);
  return {
    html: letter.html.replaceAll('{{UNSUB}}', token).replaceAll(LIKE_PLACEHOLDER, like),
    text: letter.text.replaceAll('{{UNSUB}}', token).replaceAll(LIKE_PLACEHOLDER, like),
    subject: letter.subject,
    slug: letter.slug,
  };
}

function letterFor(item: Item, lang: string): Letter {
  const ko = lang === 'ko' && item.html_ko;
  return {
    html: String((ko ? item.html_ko : item.html) || item.html || ''),
    text: String((ko ? item.text_body_ko : item.text_body) || item.text_body || ''),
    subject: String((ko ? item.subject_ko : item.subject) || item.subject || ''),
    slug: String((ko ? item.slug_ko : item.slug) || item.slug || ''),
  };
}

function hasHangul(value: unknown) {
  return /[\uac00-\ud7af]/.test(String(value || ''));
}

function isEmpty(value: unknown) {
  return !value || !String(value).trim();
}

/**
 * A hard bounce is the address's fault (no such user, mailbox gone) and we stop
 * mailing it. Auth, policy, connection and temporary errors are ours, or are
 * worth retrying, so those never suppress a real subscriber. nodemailer sets
 * `rejected[]` for 4xx greylisting too, so the SMTP code decides, not that.
 */
export function isHardBounce(err: unknown): boolean {
  const e = (err ?? {}) as {
    code?: string; responseCode?: number; command?: string; rejected?: string[]; message?: string;
  };
  const code = String(e.code ?? '');
  const rc = Number(e.responseCode ?? 0);
  const message = String(e.message ?? '');

  if (code === 'EAUTH' || rc === 530 || rc === 534 || rc === 535 || rc === 538) return false;
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNRESET') return false;
  // 4xx is temporary by definition: greylisting, rate limiting, mailbox full.
  if (rc >= 400 && rc < 500) return false;
  if (rc >= 500) {
    if (code === 'EENVELOPE' || /RCPT TO/i.test(String(e.command ?? ''))) return true;
    return /user unknown|no such user|mailbox (is )?(unavailable|not found)|recipient (address )?rejected|does not exist/i.test(message);
  }
  // No SMTP code at all: not enough evidence to drop someone.
  return false;
}

async function composeFor(item: Item): Promise<Pair> {
  const pair = await composePair(String(item.slug || item.slug_ko), item.slot as Slot, {
    en: String(item.note || ''),
    ko: String(item.note_ko || ''),
  });
  if (!pair) throw new Error(`Post not found: ${item.slug}`);
  return pair;
}

/**
 * Fill in only the letter columns that are empty. An edited letter is never
 * overwritten — that was the bug where a dashboard save vanished on reload.
 */
async function healEmptyLetters(item: Item) {
  const needs =
    isEmpty(item.subject) || isEmpty(item.html) || isEmpty(item.text_body) ||
    isEmpty(item.subject_ko) || isEmpty(item.html_ko) || isEmpty(item.text_body_ko);
  if (!needs) return;
  const pair = await composeFor(item);
  const db = await withSchema();
  const rows = await db`
    UPDATE queue_items SET
      subject = COALESCE(NULLIF(subject, ''), ${pair.en?.letter.subject ?? null}),
      html = COALESCE(NULLIF(html, ''), ${pair.en?.letter.html ?? null}),
      text_body = COALESCE(NULLIF(text_body, ''), ${pair.en?.letter.text ?? null}),
      subject_ko = COALESCE(NULLIF(subject_ko, ''), ${pair.ko?.letter.subject ?? null}),
      html_ko = COALESCE(NULLIF(html_ko, ''), ${pair.ko?.letter.html ?? null}),
      text_body_ko = COALESCE(NULLIF(text_body_ko, ''), ${pair.ko?.letter.text ?? null})
    WHERE id = ${item.id}
    RETURNING *
  `;
  if (rows[0]) Object.assign(item, rows[0]);
}

/**
 * Korean subscribers must never get the English body. If the stored Korean
 * letter has no Hangul it was built from the wrong post, so we compose the right
 * one in memory for this send only — no writes, no clobbering an edit.
 */
async function koOverrideFor(item: Item): Promise<Letter | null> {
  if (isEmpty(item.html_ko) || hasHangul(item.html_ko)) return null;
  try {
    const pair = await composeFor(item);
    if (!pair?.ko) return null;
    return {
      html: pair.ko.letter.html,
      text: pair.ko.letter.text,
      subject: pair.ko.letter.subject,
      slug: pair.koSlug,
    };
  } catch {
    return null;
  }
}

async function remainingCount(id: number, stale: string) {
  const db = await withSchema();
  const rows = await db`
    SELECT count(*)::int AS n
    FROM subscribers s
    LEFT JOIN send_log l ON l.queue_id = ${id} AND l.email = s.email
    WHERE s.unsubscribed_at IS NULL AND s.suppressed_at IS NULL
      AND (
        l.id IS NULL
        OR (l.status = 'failed' AND l.attempts < ${MAX_ATTEMPTS})
        OR (l.status = 'sending' AND l.updated_at < ${stale}::timestamptz)
      )
  ` as { n: number }[];
  return Number(rows[0]?.n ?? 0);
}

/**
 * Send one batch of a queue item. Safe to call repeatedly: claims are atomic and
 * completed recipients are never mailed again.
 */
export async function sendQueueItem(
  id: number,
  opts?: { testTo?: string; lang?: 'en' | 'ko'; chunk?: number },
): Promise<SendSummary> {
  if (!smtpConfigured()) throw new Error('SMTP is not configured');
  const db = await withSchema();
  const rows = await db`SELECT * FROM queue_items WHERE id = ${id} LIMIT 1`;
  const item = rows[0] as Item | undefined;
  if (!item) throw new Error('Queue item not found');

  await healEmptyLetters(item);
  const koOverride = await koOverrideFor(item);

  if (opts?.testTo) {
    const base = opts.lang === 'ko' && koOverride ? koOverride : letterFor(item, opts.lang || 'en');
    if (!base.html) throw new Error('That letter is empty');
    const letter = personalize(base, { unsub_token: 'test', email: opts.testTo });
    await sendMail({
      to: opts.testTo,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
    });
    return { sent: 1, failed: 0, skipped: 0, remaining: 0, done: false, status: String(item.status), test: true };
  }

  const batch = Math.max(1, Math.min(opts?.chunk ?? CHUNK, 200));
  const stale = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  // Eligible: never claimed, or claimed and failed with retries in hand, or
  // claimed and abandoned by an invocation that died mid-send long enough ago
  // that it cannot still be running.
  const due = await db`
    SELECT s.email, s.unsub_token, s.lang
    FROM subscribers s
    LEFT JOIN send_log l ON l.queue_id = ${id} AND l.email = s.email
    WHERE s.unsubscribed_at IS NULL AND s.suppressed_at IS NULL
      AND (
        l.id IS NULL
        OR (l.status = 'failed' AND l.attempts < ${MAX_ATTEMPTS})
        OR (l.status = 'sending' AND l.updated_at < ${stale}::timestamptz)
      )
    ORDER BY s.created_at ASC
    LIMIT ${batch}
  ` as { email: string; unsub_token: string; lang: string }[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const r of due) {
    const claimed = await db`
      INSERT INTO send_log (queue_id, email, status, attempts, error, updated_at)
      VALUES (${id}, ${r.email}, 'sending', 1, NULL, now())
      ON CONFLICT (queue_id, email) DO UPDATE SET
        status = 'sending', attempts = send_log.attempts + 1, error = NULL, updated_at = now()
      WHERE (send_log.status = 'failed' AND send_log.attempts < ${MAX_ATTEMPTS})
         OR (send_log.status = 'sending' AND send_log.updated_at < ${stale}::timestamptz)
      RETURNING id
    `;
    const claimId = Number(claimed[0]?.id ?? 0);
    if (!claimId) {
      // claimed between our SELECT and now — another invocation owns this address
      skipped += 1;
      continue;
    }

    const lang = r.lang === 'ko' ? 'ko' : 'en';
    const base = lang === 'ko' && koOverride ? koOverride : letterFor(item, lang);
    if (!base.html) {
      await db`DELETE FROM send_log WHERE id = ${claimId}`;
      skipped += 1;
      continue;
    }
    const letter = personalize(base, r);

    try {
      await sendMail({
        to: r.email,
        subject: letter.subject,
        html: letter.html,
        text: letter.text,
      });
      sent += 1;
      await db`UPDATE send_log SET status = 'sent', updated_at = now() WHERE id = ${claimId}`;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      await db`UPDATE send_log SET status = 'failed', error = ${message.slice(0, 500)}, updated_at = now() WHERE id = ${claimId}`;
      if (isHardBounce(err)) {
        await db`
          UPDATE subscribers
          SET suppressed_at = now(), suppress_reason = ${message.slice(0, 300)}
          WHERE email = ${r.email} AND suppressed_at IS NULL
        `;
      }
    }
  }

  const remaining = await remainingCount(id, stale);
  const totals = await db`
    SELECT
      count(*) FILTER (WHERE status = 'sent')::int AS sent,
      count(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM send_log WHERE queue_id = ${id}
  ` as { sent: number; failed: number }[];
  const totalSent = Number(totals[0]?.sent ?? 0);
  const totalFailed = Number(totals[0]?.failed ?? 0);
  // 'queued' means "there is still work": either recipients left, or failures
  // that have retries in hand. Only a finished item becomes 'sent'.
  const status = remaining > 0 ? 'queued' : (totalSent > 0 ? 'sent' : 'failed');
  const note = remaining > 0
    ? `partial: ${totalSent} sent, ${totalFailed} failed, ${remaining} still to send`
    : (totalFailed > 0 ? `${totalSent} sent, ${totalFailed} could not be delivered` : null);
  await db`
    UPDATE queue_items SET
      status = ${status},
      error = ${note},
      sent_at = CASE WHEN ${status} = 'sent' THEN now() ELSE sent_at END
    WHERE id = ${id}
  `;

  return { sent, failed, skipped, remaining, done: remaining === 0, status };
}

/** Keep batching a single item until it is finished or we run out of time. */
export async function drainQueueItem(
  id: number,
  opts: { chunk?: number; budgetMs?: number } = {},
): Promise<SendSummary> {
  const deadline = Date.now() + (opts.budgetMs ?? 30_000);
  let summary = await sendQueueItem(id, { chunk: opts.chunk });
  let sent = summary.sent;
  let failed = summary.failed;
  let skipped = summary.skipped;
  while (!summary.done && summary.sent + summary.failed > 0 && Date.now() < deadline) {
    summary = await sendQueueItem(id, { chunk: opts.chunk });
    sent += summary.sent;
    failed += summary.failed;
    skipped += summary.skipped;
  }
  return { ...summary, sent, failed, skipped };
}

export type QueueRun = {
  id: number;
  sent: number;
  failed: number;
  remaining: number;
  status: string;
};

/**
 * Everything due for this slot. `send_on <= date` means a send that ran out of
 * time (or was missed entirely) is picked up by the next run instead of waiting
 * for the same weekday next week.
 */
export async function sendDue(
  slot: Slot,
  dateIso: string,
  opts: { chunk?: number; budgetMs?: number } = {},
): Promise<QueueRun[]> {
  const db = await withSchema();
  const due = await db`
    SELECT id FROM queue_items
    WHERE slot = ${slot} AND send_on <= ${dateIso} AND status = 'queued'
    ORDER BY send_on ASC
  `;
  const results: QueueRun[] = [];
  for (const row of due) {
    const id = Number(row.id);
    const summary = await drainQueueItem(id, opts);
    results.push({
      id,
      sent: summary.sent,
      failed: summary.failed,
      remaining: summary.remaining,
      status: summary.status,
    });
  }
  return results;
}
