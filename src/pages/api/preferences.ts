export const prerender = false;

import type { APIRoute } from 'astro';
import { withSchema } from '../../lib/db';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) return json({ error: 'Missing token' }, 400);
  const db = await withSchema();
  const rows = await db`
    SELECT email, lang FROM subscribers
    WHERE unsub_token = ${token} AND unsubscribed_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) return json({ error: 'Not found' }, 404);
  return json({ email: rows[0].email, lang: rows[0].lang });
};

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? '').trim();
  const lang = body.lang === 'ko' ? 'ko' : 'en';
  if (!token) return json({ error: 'Missing token' }, 400);
  const db = await withSchema();
  const rows = await db`
    UPDATE subscribers
    SET lang = ${lang}
    WHERE unsub_token = ${token} AND unsubscribed_at IS NULL
    RETURNING email, lang
  `;
  if (!rows[0]) return json({ error: 'Not found' }, 404);
  return json({ ok: true, lang: rows[0].lang });
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
