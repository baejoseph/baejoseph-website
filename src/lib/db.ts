import { neon } from '@neondatabase/serverless';

export function sql() {
  const url = import.meta.env.DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
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
    error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (slot, send_on)
  )`;
  await db`CREATE TABLE IF NOT EXISTS send_log (
    id SERIAL PRIMARY KEY,
    queue_id INTEGER REFERENCES queue_items(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
}
