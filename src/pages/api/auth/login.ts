export const prerender = false;

import type { APIRoute } from 'astro';
import { checkPassword, isConfigured, mintSession, sessionSetHeaders } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  if (!isConfigured()) {
    return json({ error: 'Admin password is not configured' }, 500);
  }
  const body = await request.json().catch(() => ({}));
  const password = String(body.password ?? '');
  if (!checkPassword(password)) {
    return json({ error: 'Wrong password' }, 401);
  }
  const token = mintSession();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const c of sessionSetHeaders(token)) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
