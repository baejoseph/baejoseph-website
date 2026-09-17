export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../lib/auth';
import { sql } from '../../lib/db';
import { postBySlug } from '../../lib/newsletter';
import { sendQueueItem } from '../../lib/send-queue';

export const GET: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const db = sql();
  const rows = await db`SELECT * FROM queue_items ORDER BY send_on DESC, slot ASC LIMIT 80`;
  return json({ items: rows });
};

export const POST: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const slot = body.slot === 'tuesday_featured' ? 'tuesday_featured' : body.slot === 'friday_new' ? 'friday_new' : null;
  const sendOn = String(body.send_on ?? '');
  const slug = String(body.slug ?? '').trim();
  if (!slot || !/^\d{4}-\d{2}-\d{2}$/.test(sendOn) || !slug) {
    return json({ error: 'slot, send_on (YYYY-MM-DD), and slug are required' }, 400);
  }
  const weekday = new Date(sendOn + 'T12:00:00Z').getUTCDay();
  if (slot === 'tuesday_featured' && weekday !== 2) {
    return json({ error: 'Featured slot must fall on a Tuesday' }, 400);
  }
  if (slot === 'friday_new' && weekday !== 5) {
    return json({ error: 'New-post slot must fall on a Friday' }, 400);
  }
  const post = await postBySlug(slug);
  if (!post) return json({ error: 'Unknown slug' }, 404);

  const db = sql();
  try {
    const rows = await db`
      INSERT INTO queue_items (slot, send_on, slug, subject)
      VALUES (${slot}, ${sendOn}, ${slug}, ${post.data.title})
      RETURNING *
    `;
    return json({ item: rows[0] });
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (msg.includes('unique') || msg.includes('23505')) {
      return json({ error: 'That slot is already queued for that date' }, 409);
    }
    return json({ error: msg }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: 'id required' }, 400);
  const db = sql();
  await db`DELETE FROM queue_items WHERE id = ${id} AND status = 'queued'`;
  return json({ ok: true });
};

export const PATCH: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!id) return json({ error: 'id required' }, 400);
  if (body.action === 'send-now') {
    try {
      const result = await sendQueueItem(id, body.testTo ? { testTo: String(body.testTo) } : undefined);
      return json({ ok: true, result });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }
  return json({ error: 'unknown action' }, 400);
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
