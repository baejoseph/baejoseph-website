export const prerender = false;

import type { APIRoute } from 'astro';
import { withSchema } from '../../lib/db';
import { postTitle } from '../../lib/newsletter';
import { allow, clientIp, hashKey } from '../../lib/rate-limit';

/**
 * Records an "I liked this" press.
 *
 * The letter's button links to /liked, which shows a real button — a mail scanner
 * that prefetches links therefore cannot inflate the count, and only a deliberate
 * press lands here. The identity is an HMAC of the post slug and the reader's
 * address (lib/identity.ts), so repeats from the same person count once and no
 * address is ever stored.
 */
const IDENTITY_RE = /^[0-9a-f]{16,64}$/i;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const slug = String(body.slug ?? '').trim();
    const identity = String(body.i ?? '').trim();
    const lang = body.l === 'ko' ? 'ko' : 'en';

    if (!IDENTITY_RE.test(identity)) return json({ error: 'That link did not come through properly.' }, 400);
    const post = postTitle(slug);
    if (!post) return json({ error: 'Unknown post.' }, 404);

    const db = await withSchema();
    const limited = await allow(db, hashKey('liked', clientIp(request)), 40, 600);
    if (!limited.allowed) {
      return json({ error: 'Too many of those just now.' }, 429, { 'Retry-After': String(limited.retryAfter) });
    }

    const rows = await db`
      SELECT 1 FROM post_likes WHERE slug = ${slug} AND identity = ${identity} LIMIT 1
    `;
    const alreadyLiked = rows.length > 0;
    // The unique index is what actually prevents double counting under a race.
    await db`
      INSERT INTO post_likes (slug, lang, identity)
      VALUES (${slug}, ${lang}, ${identity})
      ON CONFLICT (slug, identity) DO NOTHING
    `;
    return json({ ok: true, repeat: alreadyLiked, title: post.title });
  } catch (err) {
    console.error('[liked] failed:', err);
    return json({ error: 'Could not record that just now.' }, 500);
  }
};

function json(obj: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
