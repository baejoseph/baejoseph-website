export const prerender = false;

import type { APIRoute } from 'astro';
import { cronUnauthorized, todayIso } from '../../../lib/cron-auth';
import { sendDue } from '../../../lib/send-queue';

export const GET: APIRoute = async ({ request }) => {
  const denied = cronUnauthorized(request);
  if (denied) return denied;
  try {
    const results = await sendDue('friday_new', todayIso());
    return new Response(JSON.stringify({ ok: true, slot: 'friday_new', results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
