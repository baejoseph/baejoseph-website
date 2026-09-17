import { neon } from '@neondatabase/serverless';
import { defaultWelcomeLetter, defaultWelcomeLetterKo } from './newsletter';

export function sql() {
  const url = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

export type Db = ReturnType<typeof sql>;

/**
 * Bump this string whenever the statements in ensureSchema() change, so a cold
 * start can skip ~20 round trips to Neon and just check one row.
 * /api/setup forces the full run regardless (dashboard → "Create / migrate tables").
 */
const SCHEMA_VERSION = 'v2026-09-17-welcome-tracking';

let schemaReady: Promise<void> | null = null;

export async function withSchema(opts: { force?: boolean } = {}) {
  if (opts.force) schemaReady = null;
  if (!schemaReady) {
    schemaReady = ensureSchema(opts).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
  return sql();
}

/** One-shot migration guard: true the first time this key is ever seen. */
async function once(db: Db, key: string) {
  const rows = await db`
    INSERT INTO schema_meta (key) VALUES (${key})
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  `;
  return rows.length > 0;
}

export async function ensureSchema(opts: { force?: boolean } = {}) {
  const db = sql();

  await db`CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  if (!opts.force) {
    const applied = await db`SELECT key FROM schema_meta WHERE key = ${SCHEMA_VERSION} LIMIT 1`;
    if (applied.length) return;
  }

  await db`CREATE TABLE IF NOT EXISTS subscribers (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    lang TEXT NOT NULL DEFAULT 'en',
    source TEXT NOT NULL DEFAULT 'unknown',
    unsub_token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    unsubscribed_at TIMESTAMPTZ
  )`;
  await db`CREATE TABLE IF NOT EXISTS signup_events (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    source TEXT NOT NULL,
    path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await db`CREATE TABLE IF NOT EXISTS queue_items (
    id SERIAL PRIMARY KEY,
    slot TEXT NOT NULL,
    send_on DATE NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    subject TEXT,
    html TEXT,
    text_body TEXT,
    error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slot, send_on)
  )`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS html TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS text_body TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS note TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS slug_ko TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS subject_ko TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS html_ko TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS text_body_ko TEXT`;
  await db`ALTER TABLE queue_items ADD COLUMN IF NOT EXISTS note_ko TEXT`;
  await db`CREATE TABLE IF NOT EXISTS send_log (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER REFERENCES queue_items(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // Subscriber lifecycle: did the welcome letter actually land, and has the
  // address hard-bounced (in which case we stop mailing it).
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS welcome_error TEXT`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS suppressed_at TIMESTAMPTZ`;
  await db`ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS suppress_reason TEXT`;

  // Per-recipient send bookkeeping. One row per (queue item, address) is what
  // makes a send idempotent: a second run skips anyone already claimed.
  await db`ALTER TABLE send_log ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 1`;
  await db`ALTER TABLE send_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;

  // Collapse historical duplicates before the unique index goes on. The old code
  // could write two send_log rows for one recipient in a single queue item; the
  // winner is their newest 'sent' row, else their newest row of any kind.
  if (await once(db, 'send_log_dedupe_v1')) {
    const grouped = await db`
      SELECT queue_id, email, count(*)::int AS n FROM send_log
      WHERE queue_id IS NOT NULL
      GROUP BY queue_id, email
    ` as { queue_id: number; email: string; n: number }[];
    for (const pair of grouped.filter((p) => Number(p.n) > 1)) {
      const rows = await db`
        SELECT id, status FROM send_log
        WHERE queue_id = ${pair.queue_id} AND email = ${pair.email}
        ORDER BY id DESC
      ` as { id: number; status: string }[];
      const keep = rows.find((r) => r.status === 'sent')?.id ?? rows[0]?.id;
      for (const row of rows) {
        if (Number(row.id) === Number(keep)) continue;
        await db`DELETE FROM send_log WHERE id = ${row.id}`;
      }
    }
  }
  await db`CREATE UNIQUE INDEX IF NOT EXISTS send_log_queue_email_uniq ON send_log (queue_id, email)`;
  await db`CREATE INDEX IF NOT EXISTS send_log_queue_idx ON send_log (queue_id)`;
  await db`CREATE INDEX IF NOT EXISTS subscribers_unsub_idx ON subscribers (unsubscribed_at)`;
  await db`CREATE INDEX IF NOT EXISTS signup_events_created_idx ON signup_events (created_at)`;

  await db`CREATE TABLE IF NOT EXISTS rate_limits (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await db`CREATE INDEX IF NOT EXISTS rate_limits_window_idx ON rate_limits (window_start)`;

  await db`CREATE TABLE IF NOT EXISTS email_templates (
    key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text_body TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const welcome = defaultWelcomeLetter();
  const welcomeKo = defaultWelcomeLetterKo();
  await db`
    INSERT INTO email_templates (key, subject, html, text_body)
    VALUES ('welcome', ${welcome.subject}, ${welcome.html}, ${welcome.text})
    ON CONFLICT (key) DO NOTHING
  `;
  await db`
    INSERT INTO email_templates (key, subject, html, text_body)
    VALUES ('welcome_ko', ${welcomeKo.subject}, ${welcomeKo.html}, ${welcomeKo.text})
    ON CONFLICT (key) DO NOTHING
  `;
  await db`
    UPDATE email_templates
    SET subject = ${welcome.subject}, html = ${welcome.html}, text_body = ${welcome.text}, updated_at = now()
    WHERE key = 'welcome'
      AND subject IN (
        'Welcome: Who Is Joseph Bae?',
        'Welcome — Who Is Joseph Bae?',
        'Welcome — thank you for signing up'
      )
  `;

  await db`
    INSERT INTO schema_meta (key) VALUES (${SCHEMA_VERSION})
    ON CONFLICT (key) DO NOTHING
  `;
}
