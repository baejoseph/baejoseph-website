export const prerender = false;

import type { APIRoute } from 'astro';
import { cronUnauthorized } from '../../../lib/cron-auth';
import { runSlots } from '../../../lib/cron-run';

/**
 * Daily catch-up. Both slots are checked every day: a letter only goes out on or
 * after its own send date, so this sends Tuesday's letter on Tuesday and picks
 * up anything a failed or interrupted run left behind on Wednesday. When the
 * send was wired to a weekly cron, a single failed run meant a silent week.
 */
export const GET: APIRoute = async ({ request }) => {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  try {
    const runs = await runSlots();
    return new Response(JSON.stringify({ ok: true, runs }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/daily] failed:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
