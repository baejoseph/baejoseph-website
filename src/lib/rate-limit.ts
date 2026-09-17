import { createHash } from 'node:crypto';
import type { Db } from './db';

/**
 * Serverless has no shared memory between invocations, so counters live in Postgres.
 * The table is created in db.ts. Every entry point that can be abused (login, signup)
 * is bucketed per client IP.
 */

export type RateLimitResult = {
  allowed: boolean;
  count: number;
  limit: number;
  /** seconds until the window resets — safe to send back as Retry-After */
  retryAfter: number;
};

function secret() {
  return import.meta.env.ADMIN_SECRET || process.env.ADMIN_SECRET || '';
}

/**
 * We store a hash, never the raw address: an IP is personal data under UK GDPR,
 * and a bucket key is all the counter actually needs.
 */
export function hashKey(kind: string, value: string) {
  const digest = createHash('sha256').update(`${secret()}|${value}`).digest('hex').slice(0, 32);
  return `${kind}:${digest}`;
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip') || 'unknown';
}

/** Count one hit and report whether the caller is still inside the window's allowance. */
export async function hit(
  db: Db,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const rows = await db`
    INSERT INTO rate_limits (bucket, count, window_start)
    VALUES (${bucket}, 1, now())
    ON CONFLICT (bucket) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < ${cutoff}::timestamptz THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < ${cutoff}::timestamptz THEN now() ELSE rate_limits.window_start END
    RETURNING count, window_start
  `;
  const row = rows[0] || {};
  const count = Number(row.count ?? 1);
  const started = Date.parse(String(row.window_start ?? '')) || Date.now();
  const retryAfter = Math.max(1, Math.ceil((started + windowSeconds * 1000 - Date.now()) / 1000));
  return { allowed: count <= limit, count, limit, retryAfter };
}

/**
 * Best-effort wrapper: a broken counter must never lock Joseph out of his own
 * dashboard or block a real signup. Failures are logged and the request proceeds.
 */
export async function allow(
  db: Db,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  try {
    return await hit(db, bucket, limit, windowSeconds);
  } catch (err) {
    console.error('[rate-limit] unavailable, allowing request:', err);
    return { allowed: true, count: 0, limit, retryAfter: 0 };
  }
}

/** Drop finished windows now and then, so the table stays small without a cron job. */
export async function prune(db: Db) {
  if (Math.random() > 0.05) return;
  try {
    await db`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  } catch {
    // housekeeping only
  }
}
