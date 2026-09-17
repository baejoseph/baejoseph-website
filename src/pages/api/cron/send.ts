export const prerender = false;

import type { APIRoute } from 'astro';
import { sendDue } from '../../../lib/send-queue';
import type { Slot } from '../../../lib/newsletter';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const secret = import.meta.env.CRON_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('secret') || '';
  if (!secret || token !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const slotParam = url.searchParams.get('slot');
  const slot: Slot = slotParam === 'friday_new' ? 'friday_new' : 'tuesday_featured';
  const today = new Date().toISOString().slice(0, 10);

  try {
    const results = await sendDue(slot, today);
    return new Response(JSON.stringify({ ok: true, slot, today, results }), {
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
