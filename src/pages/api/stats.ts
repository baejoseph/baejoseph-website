export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../lib/auth';
import { withSchema } from '../../lib/db';
import { recentRuns } from '../../lib/cron-run';

export const GET: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const db = await withSchema();
    const subs = await db`
      SELECT id, email, lang, theme, source, created_at, unsubscribed_at,
             welcomed_at, welcome_error, suppressed_at, suppress_reason
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
    // Counted in the database, not by filtering the 500 newest rows above: that
    // under-reported "Unsubscribed" as soon as the list grew past the page size.
    const left = await db`
      SELECT
        SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS unsubscribed,
        SUM(CASE WHEN suppressed_at IS NOT NULL THEN 1 ELSE 0 END)::int AS bounced
      FROM subscribers
    ` as { unsubscribed: number | null; bounced: number | null }[];
    // Which posts landed: unique presses per post ("I liked this" button).
    const likes = await db`
      SELECT slug, lang, count(*)::int AS n
      FROM post_likes
      GROUP BY slug, lang
      ORDER BY n DESC, slug ASC
      LIMIT 25
    `;
    const likeTotal = await db`SELECT count(*)::int AS n FROM post_likes`;
    // Did the automatic send actually run? A cron that never fired leaves no
    // other trace than a letter that quietly did not arrive.
    let runs: unknown[] = [];
    try {
      runs = await recentRuns(8);
    } catch {
      runs = [];
    }
    return new Response(JSON.stringify({
      subscribers: subs,
      sources,
      events,
      active: active[0]?.n ?? 0,
      unsubscribed: left[0]?.unsubscribed ?? 0,
      bounced: left[0]?.bounced ?? 0,
      likes,
      likeTotal: likeTotal[0]?.n ?? 0,
      runs,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
    });
  }
};
