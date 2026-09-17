export const prerender = false;

import type { APIRoute } from 'astro';
import { checkPassword, isConfigured, mintSession, sessionSetHeaders } from '../../../lib/auth';
import { withSchema } from '../../../lib/db';
import { allow, clientIp, hashKey } from '../../../lib/rate-limit';

/**
 * One shared password was guessable at machine speed. Eight tries per IP per
 * 15 minutes makes that pointless while never getting in Joseph's way.
 */
const ATTEMPTS = 8;
const WINDOW = 15 * 60;

export const POST: APIRoute = async ({ request }) => {
  if (!isConfigured()) {
    return json({ error: 'Admin password is not configured' }, 500);
  }

  // Count the attempt before checking the password, so failures cost too.
  try {
    const db = await withSchema();
    const limited = await allow(db, hashKey('login', clientIp(request)), ATTEMPTS, WINDOW);
    if (!limited.allowed) {
      const minutes = Math.max(1, Math.ceil(limited.retryAfter / 60));
      return json(
        { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
        429,
        { 'Retry-After': String(limited.retryAfter) },
      );
    }
  } catch (err) {
    // No database (or a broken counter) must not lock him out of his own dashboard.
    console.error('[login] rate limit unavailable, allowing attempt:', err);
  }

  const body = await request.json().catch(() => ({}));
  const password = String(body.password ?? '');
  if (!checkPassword(password)) {
    console.warn('[login] wrong password from', clientIp(request));
    return json({ error: 'Wrong password' }, 401);
  }

  const token = mintSession();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const c of sessionSetHeaders(token)) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};

function json(obj: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
