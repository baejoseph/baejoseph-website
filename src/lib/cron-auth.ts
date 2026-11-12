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
 *
 * A missing secret is a setup fault, not a bad caller: it used to answer 401
 * like any other refusal, so a scheduled run failed with nothing in the logs
 * that said why. Say it out loud instead.
 */
export function cronUnauthorized(request: Request): Response | null {
  const secret = import.meta.env.CRON_SECRET || process.env.CRON_SECRET || '';
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set — every scheduled send will be refused');
    return new Response(JSON.stringify({ error: 'CRON_SECRET is not set on this deployment' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !matches(token, secret)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
  return null;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Time we allow ourselves to spend sending inside one invocation. The function
 * is configured for 60s (astro.config.mjs); this leaves room for the round trips
 * that follow the last message (status write, run log) before the platform cuts
 * the invocation off mid-air.
 */
export const SEND_BUDGET_MS = 45_000;

