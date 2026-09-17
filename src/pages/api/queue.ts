export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../lib/auth';
import { withSchema } from '../../lib/db';
import { applyNote, composePair } from '../../lib/newsletter';
import { drainQueueItem, sendQueueItem } from '../../lib/send-queue';

/**
 * Read-only on purpose. This used to re-compose every queued letter and write it
 * back, which silently threw away any edit made in the dashboard the next time
 * the page loaded. Healing (empty or wrong-language letters) now happens in
 * send-queue.ts and in the explicit "Rebuild" actions below.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const db = await withSchema();
  const items = await db`
    SELECT q.*,
      COALESCE(le.n, 0)::int AS likes_en,
      COALESCE(lk.n, 0)::int AS likes_ko
    FROM queue_items q
    LEFT JOIN (SELECT slug, count(*) AS n FROM post_likes GROUP BY slug) le ON le.slug = q.slug
    LEFT JOIN (SELECT slug, count(*) AS n FROM post_likes GROUP BY slug) lk ON lk.slug = q.slug_ko
    ORDER BY q.send_on DESC, q.slot ASC
    LIMIT 80
  `;
  return json({ items });
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
  let pair;
  try {
    pair = await composePair(slug, slot);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
  if (!pair || !pair.en || !pair.ko) return json({ error: 'Could not build the EN+KO pair for that post' }, 400);
  const en = pair.en?.letter;
  const ko = pair.ko?.letter;

  const db = await withSchema();
  try {
    const rows = await db`
      INSERT INTO queue_items (
        slot, send_on, slug, slug_ko, subject, html, text_body, note,
        subject_ko, html_ko, text_body_ko, note_ko
      )
      VALUES (
        ${slot}, ${sendOn},
        ${pair.enSlug || slug}, ${pair.koSlug},
        ${en?.subject || null}, ${en?.html || null}, ${en?.text || null}, ${''},
        ${ko?.subject || null}, ${ko?.html || null}, ${ko?.text || null}, ${''}
      )
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
  const db = await withSchema();
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
      // A test send goes to one address and touches no bookkeeping; a real send
      // keeps batching until the list is finished (or the time budget runs out),
      // and is safe to press twice because each recipient is claimed first.
      const result = body.testTo
        ? await sendQueueItem(id, { testTo: String(body.testTo), lang: body.lang === 'ko' ? 'ko' : 'en' })
        : await drainQueueItem(id, { budgetMs: 30_000 });
      return json({ ok: true, result });
    } catch (err) {
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }
  if (body.action === 'save') {
    const lang = body.lang === 'ko' ? 'ko' : 'en';
    const subject = String(body.subject ?? '');
    let html = String(body.html ?? '');
    const text = String(body.text ?? '');
    const note = body.note == null ? null : String(body.note);
    const db = await withSchema();
    if (note != null) html = applyNote(html, note);
    const rows = lang === 'ko'
      ? await db`
          UPDATE queue_items
          SET subject_ko = ${subject}, html_ko = ${html}, text_body_ko = ${text}, note_ko = ${note}
          WHERE id = ${id} AND status = 'queued'
          RETURNING *
        `
      : await db`
          UPDATE queue_items
          SET subject = ${subject}, html = ${html}, text_body = ${text}, note = ${note}
          WHERE id = ${id} AND status = 'queued'
          RETURNING *
        `;
    if (!rows[0]) return json({ error: 'Not found or already sent' }, 404);
    return json({ item: rows[0] });
  }
  if (body.action === 'rebuild') {
    const db = await withSchema();
    const existing = await db`SELECT slug, slug_ko, slot, note, note_ko FROM queue_items WHERE id = ${id} LIMIT 1`;
    if (!existing[0]) return json({ error: 'Not found' }, 404);
    const pair = await composePair(String(existing[0].slug || existing[0].slug_ko), existing[0].slot, {
      en: existing[0].note || '',
      ko: existing[0].note_ko || '',
    });
    if (!pair) return json({ error: 'Post missing' }, 404);
    const en = pair.en?.letter;
    const ko = pair.ko?.letter;
    const rows = await db`
      UPDATE queue_items SET
        slug = ${pair.enSlug || existing[0].slug},
        slug_ko = ${pair.koSlug},
        subject = ${en?.subject || null},
        html = ${en?.html || null},
        text_body = ${en?.text || null},
        subject_ko = ${ko?.subject || null},
        html_ko = ${ko?.html || null},
        text_body_ko = ${ko?.text || null}
      WHERE id = ${id} AND status = 'queued'
      RETURNING *
    `;
    return json({ item: rows[0] });
  }
  // Korean only: used when a stored Korean letter is missing or was built from
  // the English body. Leaves the English letter (and any edit to it) alone.
  if (body.action === 'rebuild-ko') {
    const db = await withSchema();
    const existing = await db`SELECT slug, slug_ko, slot, note, note_ko FROM queue_items WHERE id = ${id} LIMIT 1`;
    if (!existing[0]) return json({ error: 'Not found' }, 404);
    const pair = await composePair(String(existing[0].slug || existing[0].slug_ko), existing[0].slot, {
      en: existing[0].note || '',
      ko: existing[0].note_ko || '',
    });
    if (!pair?.ko) return json({ error: 'No Korean pair for that post' }, 404);
    const ko = pair.ko.letter;
    const rows = await db`
      UPDATE queue_items SET
        slug_ko = ${pair.koSlug},
        subject_ko = ${ko.subject},
        html_ko = ${ko.html},
        text_body_ko = ${ko.text}
      WHERE id = ${id} AND status = 'queued'
      RETURNING *
    `;
    if (!rows[0]) return json({ error: 'Not found or already sent' }, 404);
    return json({ item: rows[0] });
  }
  return json({ error: 'unknown action' }, 400);
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
