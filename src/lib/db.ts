import { neon } from '@neondatabase/serverless';
import { defaultWelcomeLetter } from './newsletter';

export function sql() {
  const url = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}

let schemaReady: Promise<void> | null = null;

export async function withSchema() {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
  return sql();
}

export async function ensureSchema() {
  const db = sql();
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
  await db`CREATE TABLE IF NOT EXISTS send_log (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER REFERENCES queue_items(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await db`CREATE TABLE IF NOT EXISTS email_templates (
    key TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text_body TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  const welcome = defaultWelcomeLetter();
  await db`
    INSERT INTO email_templates (key, subject, html, text_body)
    VALUES ('welcome', ${welcome.subject}, ${welcome.html}, ${welcome.text})
    ON CONFLICT (key) DO NOTHING
  `;
  await db`
    UPDATE email_templates
    SET subject = ${welcome.subject}, html = ${welcome.html}, text_body = ${welcome.text}, updated_at = now()
    WHERE key = 'welcome'
      AND subject IN ('Welcome: Who Is Joseph Bae?', 'Welcome — Who Is Joseph Bae?')
  `;
}
