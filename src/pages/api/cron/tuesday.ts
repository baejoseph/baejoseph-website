export const prerender = false;

import type { APIRoute } from 'astro';
import { cronUnauthorized, todayIso, SEND_BUDGET_MS } from '../../../lib/cron-auth';
import { sendDue } from '../../../lib/send-queue';

export const GET: APIRoute = async ({ request }) => {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  try {
    // Sends in batches, and picks up anything overdue as well as today's, so a
    // run cut short by the function timeout finishes on the next tick.
    const results = await sendDue('tuesday_featured', todayIso(), { budgetMs: SEND_BUDGET_MS });
    return new Response(JSON.stringify({ ok: true, slot: 'tuesday_featured', results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/tuesday] failed:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
