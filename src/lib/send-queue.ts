import { withSchema, type Db } from './db';
import { sendMail, smtpConfigured, transporter, type Transport } from './email';
import { composePair, LIKE_PLACEHOLDER, paintLetter, type Slot } from './newsletter';
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
 * Consecutive failures that were the *server's* fault (credentials, connection,
 * 421 too many connections) mean the run is broken, not the addresses. After
 * this many in a row the batch stops instead of grinding through the list,
 * leaving the rest of the letter queued for the next run.
 */
export const MAX_PLATFORM_FAILURES = 3;
/**
 * A 'sending' row older than this belongs to an invocation that died mid-send.
 * Young enough that no live run can still own it, old enough that a lost letter
 * is worth one more try (a rare duplicate beats a silent no-show).
 */
export const STALE_SENDING_MS = 15 * 60 * 1000;
/**
 * How late an automatic run will still send a letter that missed its date. The
 * daily cron picks up anything a failed run left behind, which is the point —
 * but it must not resurrect a forgotten month of old letters and mail them all
 * in one morning. Older than this and the letter waits for a human.
 */
export const MAX_AUTO_OVERDUE_DAYS = 14;

/**
 * Write progress onto the queue item every N deliveries. An invocation killed by
 * the function timeout never reaches the status update at the end, and the row
 * then sits there saying "queued" with no note at all — half the list holding
 * the letter, the other half waiting, and nothing on the dashboard saying so.
 */
export const PROGRESS_EVERY = 5;

async function markProgress(db: Db, id: number) {
  try {
    const rows = await db`
      SELECT count(*)::int AS n FROM send_log WHERE queue_id = ${id} AND status = 'sent'
    ` as { n: number }[];
    const delivered = Number(rows[0]?.n ?? 0);
    await db`
      UPDATE queue_items SET error = ${`sending… ${delivered} delivered so far`}
      WHERE id = ${id} AND status <> 'sent'
    `;
  } catch {
    // A progress line is a nicety; it must never stop a send.
  }
}

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
  /** the mail host refused the batch; stop draining rather than hammer it */
  stopped?: boolean;
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

function letterFor(item: Item, lang: string, theme: 'dark' | 'light' = 'dark'): Letter {
  const ko = lang === 'ko' && item.html_ko;
  const html = String((ko ? item.html_ko : item.html) || item.html || '');
  return {
    // Dark is the stored letter. Light is a recolor of a themeable letter only;
    // an older queued letter has no marker and is sent dark to everyone.
    html: paintLetter(html, theme),
    text: String((ko ? item.text_body_ko : item.text_body) || item.text_body || ''),
    subject: String((ko ? item.subject_ko : item.subject) || item.subject || ''),
    slug: String((ko ? item.slug_ko : item.slug) || item.slug || ''),
  };
}

function readerTheme(value: unknown): 'dark' | 'light' {
  return value === 'light' ? 'light' : 'dark';
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

/**
 * A failure that says nothing about the address: the mailbox host refused *us*
 * (bad credentials, connection dropped, too many connections). Those must not
 * burn a recipient's retry budget, because three quick retries inside one
 * invocation used to exhaust everybody during a five-minute SMTP blip and leave
 * the letter permanently 'failed' with no cron left that would ever try again.
 */
export function isPlatformError(err: unknown): boolean {
  const e = (err ?? {}) as {
    code?: string; responseCode?: number; command?: string; message?: string;
  };
  const code = String(e.code ?? '');
  const rc = Number(e.responseCode ?? 0);
  const command = String(e.command ?? '');

  if (code === 'EAUTH' || rc === 530 || rc === 534 || rc === 535 || rc === 538) return true;
  // A timeout during a command is one address not answering; a timeout with no
  // command is the host never letting us in. Different owners, different fix.
  if (code === 'ETIMEDOUT' && command) return false;
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNRESET') return true;
  if (code === 'EDNS' || code === 'EPROTOCOL' || code === 'EMESSAGE') return true;
  // 421 = service not available / too many connections from this host.
  if (rc === 421) return true;
  // A 4xx with a real reply is about the recipient (greylisting, quota): retry it.
  if (rc >= 400 && rc < 500) return false;
  if (rc >= 500) return false;
  // No SMTP code and no command: the conversation never happened.
  return !command;
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
  opts?: { testTo?: string; lang?: 'en' | 'ko'; chunk?: number; deadline?: number },
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

  // A letter with no body mails nothing but failure rows. Say so once, clearly,
  // instead of grinding through the list marking everyone 'failed'.
  if (!letterFor(item, 'en').html) {
    throw new Error('That letter has no body — rebuild it from the post, or paste the HTML in, before sending.');
  }

  const batch = Math.max(1, Math.min(opts?.chunk ?? CHUNK, 200));
  // The same deadline the caller is watching. Checking it inside the loop (not
  // just between batches) is what stops a run being guillotined half-way: we
  // choose to end it, with a note saying where it got to, instead of the
  // platform ending it silently.
  const deadline = opts?.deadline ?? Date.now() + 40_000;
  const stale = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  // Eligible: never claimed, or claimed and failed with retries in hand, or
  // claimed and abandoned by an invocation that died mid-send long enough ago
  // that it cannot still be running.
  const due = await db`
    SELECT s.email, s.unsub_token, s.lang, s.theme
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
  ` as { email: string; unsub_token: string; lang: string; theme: string | null }[];

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let refused = 0;
  /** Why the batch stopped early, when the fault was the mailbox host's. */
  let stopReason: string | null = null;
  /** True when we ran out of our own time rather than being cut off. */
  let timedOut = false;

  // One pooled transport for the whole batch. Opening a connection per address
  // is what made a long list time out half-sent. It is rebuilt if the host
  // drops it, so one dead socket cannot poison everyone after it.
  let transport: Transport = transporter({ pool: true });
  const freshTransport = () => {
    try { transport.close(); } catch { /* already gone */ }
    transport = transporter({ pool: true });
  };

  try {
    for (const r of due) {
      // Stop before claiming anyone we are not going to mail: a run we end
      // ourselves leaves no half-claimed 'sending' rows behind it.
      if (Date.now() >= deadline) { timedOut = true; break; }

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
      const theme = readerTheme(r.theme);
      const base = lang === 'ko' && koOverride
        ? { ...koOverride, html: paintLetter(koOverride.html, theme) }
        : letterFor(item, lang, theme);
      if (!base.html) {
        failed += 1;
        await db`
          UPDATE send_log
          SET status = 'failed', error = 'letter body is empty', updated_at = now()
          WHERE id = ${claimId}
        `;
        continue;
      }
      const letter = personalize(base, r);

      try {
        await sendMail({
          to: r.email,
          subject: letter.subject,
          html: letter.html,
          text: letter.text,
        }, transport);
        sent += 1;
        refused = 0;
        await db`UPDATE send_log SET status = 'sent', updated_at = now() WHERE id = ${claimId}`;
        if (sent % PROGRESS_EVERY === 0) await markProgress(db, id);
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        const code = String((err as { code?: string } | null)?.code ?? '');
        const brokenSocket = ['ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'ECONNECTION', 'EPROTOCOL'].includes(code);
        if (isPlatformError(err)) {
          // The host refused the connection, not the reader. Give the attempt
          // back so a blip cannot burn the whole list's retry budget, and stop
          // after a few in a row: continuing just fails every remaining address.
          refused += 1;
          stopReason = message.slice(0, 300);
          await db`
            UPDATE send_log
            SET status = 'failed', error = ${message.slice(0, 500)},
                attempts = GREATEST(attempts - 1, 0), updated_at = now()
            WHERE id = ${claimId}
          `;
          freshTransport();
          if (refused >= MAX_PLATFORM_FAILURES) break;
          continue;
        }
        await db`UPDATE send_log SET status = 'failed', error = ${message.slice(0, 500)}, updated_at = now() WHERE id = ${claimId}`;
        // An address that timed out may have left the pooled connection out of
        // step. Start a clean one so the next recipient is not punished for it.
        if (brokenSocket) freshTransport();
        if (isHardBounce(err)) {
          await db`
            UPDATE subscribers
            SET suppressed_at = now(), suppress_reason = ${message.slice(0, 300)}
            WHERE email = ${r.email} AND suppressed_at IS NULL
          `;
        }
      }
    }
  } finally {
    transport.close();
  }

  const remaining = await remainingCount(id, stale);
  // SUM(CASE ...) rather than count(*) FILTER (WHERE ...): the filter form is
  // silently ignored by the pg-mem harness the self-test runs on, so a test could
  // not tell a working count from a broken one.
  const totals = await db`
    SELECT
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END)::int AS sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed
    FROM send_log WHERE queue_id = ${id}
  ` as { sent: number | null; failed: number | null }[];
  const totalSent = Number(totals[0]?.sent ?? 0);
  const totalFailed = Number(totals[0]?.failed ?? 0);
  // 'queued' means "there is still work": either recipients left, or failures
  // that have retries in hand. Only a finished item becomes 'sent'.
  const status = remaining > 0 ? 'queued' : (totalSent > 0 ? 'sent' : 'failed');
  // Why it did not finish beats a raw count when the mailbox host was the cause:
  // this is the line Joseph reads on the dashboard.
  const note = stopReason
    ? `stopped: the mail server refused ${refused} in a row — ${stopReason}`
    : timedOut
      ? `stopped at the time limit: ${totalSent} delivered, ${remaining} still to send. The next run carries on from here.`
      : remaining > 0
        ? `partial: ${totalSent} delivered, ${totalFailed} failed, ${remaining} still to send`
        : (totalFailed > 0 ? `${totalSent} delivered, ${totalFailed} could not be delivered` : null);
  await db`
    UPDATE queue_items SET
      status = ${status},
      error = ${note},
      sent_at = CASE WHEN ${status} = 'sent' THEN now() ELSE sent_at END
    WHERE id = ${id}
  `;

  return { sent, failed, skipped, remaining, done: remaining === 0, status, ...(stopReason ? { stopped: true } : {}) };
}

/** Keep batching a single item until it is finished or we run out of time. */
export async function drainQueueItem(
  id: number,
  opts: { chunk?: number; budgetMs?: number; deadline?: number } = {},
): Promise<SendSummary> {
  const deadline = opts.deadline ?? Date.now() + (opts.budgetMs ?? 30_000);
  let summary = await sendQueueItem(id, { chunk: opts.chunk, deadline });
  let sent = summary.sent;
  let failed = summary.failed;
  let skipped = summary.skipped;
  let stopped = Boolean(summary.stopped);
  while (!stopped && !summary.done && summary.sent + summary.failed > 0 && Date.now() < deadline) {
    summary = await sendQueueItem(id, { chunk: opts.chunk, deadline });
    sent += summary.sent;
    failed += summary.failed;
    skipped += summary.skipped;
    stopped = Boolean(summary.stopped);
  }
  return { ...summary, sent, failed, skipped, ...(stopped ? { stopped: true } : {}) };
}

export type QueueRun = {
  id: number;
  sent: number;
  failed: number;
  /** addresses still to send; null when this run ran out of time before it started */
  remaining: number | null;
  /** a queue item's status, or 'deferred' / 'error' for this run's own outcome */
  status: string;
  error?: string;
};

/** DAYS_LATE uses a plain YYYY-MM-DD in, so the driver's own DATE shape (string
 *  in Postgres, Date object in the test harness) cannot silently disable it. */
function isoDay(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value ?? '').slice(0, 10);
}

function daysLate(sendOn: unknown, today: string): number {
  const from = Date.parse(`${isoDay(sendOn)}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / 86_400_000);
}

/**
 * Everything due for this slot. `send_on <= date` means a send that ran out of
 * time (or was missed entirely) is picked up by the next run instead of waiting
 * for the same weekday next week.
 *
 * Each letter is isolated: a queued letter whose post has been renamed (so its
 * body cannot be rebuilt) records the reason on itself and the run carries on.
 * Before that, one broken letter threw out of the loop and stopped every cron
 * run at the same place, so nothing in the queue ever sent again.
 */
export async function sendDue(
  slot: Slot,
  dateIso: string,
  opts: { chunk?: number; budgetMs?: number; deadline?: number } = {},
): Promise<QueueRun[]> {
  const db = await withSchema();
  const deadline = opts.deadline ?? Date.now() + (opts.budgetMs ?? 30_000);
  const due = await db`
    SELECT id, status, send_on FROM queue_items
    WHERE slot = ${slot} AND send_on <= ${dateIso} AND status <> 'sent'
    ORDER BY send_on ASC
  ` as { id: number; status: string; send_on: string }[];
  const results: QueueRun[] = [];
  for (const row of due) {
    const id = Number(row.id);
    // An old letter is history, not a backlog: a mis-sent one would be a letter
    // nobody is waiting for any more.
    const overdueDays = daysLate(row.send_on, dateIso);
    if (overdueDays > MAX_AUTO_OVERDUE_DAYS) {
      await db`
        UPDATE queue_items
        SET error = ${`overdue by ${overdueDays} days — nothing sends it automatically now. Send it by hand, or remove it.`}
        WHERE id = ${id} AND status <> 'sent'
      `;
      results.push({ id, sent: 0, failed: 0, remaining: null, status: 'stale' });
      continue;
    }
    if (Date.now() >= deadline) {
      results.push({ id, sent: 0, failed: 0, remaining: null, status: 'deferred' });
      continue;
    }
    try {
      const summary = await drainQueueItem(id, { chunk: opts.chunk, deadline });
      results.push({
        id,
        sent: summary.sent,
        failed: summary.failed,
        remaining: summary.remaining,
        status: summary.status,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[cron] queue item ${id} could not run: ${message}`);
      // Leave it queued, with the reason visible on the dashboard, and keep
      // going: the other letters in the queue have done nothing wrong.
      await db`
        UPDATE queue_items SET error = ${`could not run: ${message}`.slice(0, 500)}
        WHERE id = ${id} AND status <> 'sent'
      `;
      results.push({ id, sent: 0, failed: 0, remaining: null, status: 'error', error: message });
    }
  }
  return results;
}
