import { timingSafeEqual } from 'node:crypto';

function matches(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Header only — a secret in the query string ends up in logs and referrers.
 * Vercel's cron invocations send `Authorization: Bearer $CRON_SECRET`.
 */
export function cronUnauthorized(request: Request): Response | null {
  const secret = import.meta.env.CRON_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secret || !token || !matches(token, secret)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Keep a cron invocation comfortably inside the function's max duration. */
export const SEND_BUDGET_MS = 30_000;
