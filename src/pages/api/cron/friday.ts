export const prerender = false;

import type { APIRoute } from 'astro';
import { cronUnauthorized } from '../../../lib/cron-auth';
import { runSlots } from '../../../lib/cron-run';

/**
 * Friday's new-post letter. The schedule now points at /api/cron/daily, which
 * runs this slot and the Tuesday one; this route stays for a manual or
 * single-slot trigger and sends the same way.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  try {
    const runs = await runSlots(['friday_new']);
    return new Response(JSON.stringify({ ok: true, runs }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/friday] failed:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
