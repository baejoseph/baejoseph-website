export const prerender = false;

import type { APIRoute } from 'astro';
import { withSchema } from '../../lib/db';

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const token = String(body.token ?? '').trim();
  if (!token) return json({ error: 'Missing token' }, 400);
  const db = await withSchema();
  const rows = await db`
    UPDATE subscribers
    SET unsubscribed_at = now()
    WHERE unsub_token = ${token} AND unsubscribed_at IS NULL
    RETURNING email
  `;
  return json({ ok: true, found: rows.length > 0 });
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
