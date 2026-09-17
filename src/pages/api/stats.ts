export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../lib/auth';
import { withSchema } from '../../lib/db';

export const GET: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const db = await withSchema();
    const subs = await db`
      SELECT id, email, lang, source, created_at, unsubscribed_at
      FROM subscribers
      ORDER BY created_at DESC
      LIMIT 500
    `;
    const sources = await db`
      SELECT source, count(*)::int AS n
      FROM signup_events
      GROUP BY source
      ORDER BY n DESC
    `;
    const events = await db`
      SELECT email, source, path, created_at
      FROM signup_events
      ORDER BY created_at DESC
      LIMIT 100
    `;
    const active = await db`SELECT count(*)::int AS n FROM subscribers WHERE unsubscribed_at IS NULL`;
    return new Response(JSON.stringify({
      subscribers: subs,
      sources,
      events,
      active: active[0]?.n ?? 0,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
