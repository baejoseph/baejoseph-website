import { withSchema } from './db';
import { sendDue, type QueueRun } from './send-queue';
import { SEND_BUDGET_MS, todayIso } from './cron-auth';
import type { Slot } from './newsletter';

/**
 * The two slots, in send order. A Tuesday letter goes before a Friday one so a
 * backlog cannot make the newer letter overtake the older.
 */
export const ALL_SLOTS: Slot[] = ['tuesday_featured', 'friday_new'];

export type SlotRun = {
  slot: Slot;
  date: string;
  /** how many queued letters were due for this slot */
  items: number;
  sent: number;
  failed: number;
  remaining: number;
  results: QueueRun[];
  error?: string;
};

function sum(results: QueueRun[], key: 'sent' | 'failed' | 'remaining') {
  return results.reduce((n, r) => n + Number(r[key] ?? 0), 0);
}

async function record(run: SlotRun) {
  try {
    const db = await withSchema();
    await db`
      INSERT INTO cron_runs (slot, items, sent, failed, remaining, error)
      VALUES (${run.slot}, ${run.items}, ${run.sent}, ${run.failed}, ${run.remaining}, ${run.error ?? null})
    `;
  } catch (err) {
    // Never let bookkeeping break a send that already happened.
    console.error('[cron] could not record the run:', err);
  }
}

/**
 * Run one or both slots and leave a row saying what happened.
 *
 * The budget is shared: `budgetMs` covers every slot in the call, so a long
 * Tuesday batch defers the Friday letter to the next run instead of running the
 * invocation past the function timeout (which is how a send used to stop
 * half-finished, with nobody told).
 */
export async function runSlots(
  slots: Slot[] = ALL_SLOTS,
  opts: { date?: string; budgetMs?: number } = {},
): Promise<SlotRun[]> {
  const date = opts.date ?? todayIso();
  const deadline = Date.now() + (opts.budgetMs ?? SEND_BUDGET_MS);
  const runs: SlotRun[] = [];

  // How much work each slot actually has. Without this the budget was split
  // evenly between the two slots no matter what, so a Tuesday with 90 readers
  // waiting got 22 seconds while the empty Friday slot held 22 seconds it could
  // never use — and a letter that did not finish needed a second run (or a
  // human pressing Send) to reach the rest of the list.
  const db = await withSchema();
  const hasWork = new Map<Slot, boolean>();
  for (const slot of slots) {
    const rows = await db`
      SELECT count(*)::int AS n FROM queue_items
      WHERE slot = ${slot} AND send_on <= ${date} AND status <> 'sent'
    ` as { n: number }[];
    hasWork.set(slot, Number(rows[0]?.n ?? 0) > 0);
  }

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const left = Math.max(0, deadline - Date.now());
    const pending = slots.slice(i).filter((s) => hasWork.get(s)).length || 1;
    const share = Math.max(5_000, Math.floor(left / pending));
    let results: QueueRun[] = [];
    let error: string | undefined;
    try {
      results = await sendDue(slot, date, { deadline: Date.now() + share });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error(`[cron] ${slot} failed: ${error}`);
    }
    const run: SlotRun = {
      slot,
      date,
      items: results.length,
      sent: sum(results, 'sent'),
      failed: sum(results, 'failed'),
      remaining: sum(results, 'remaining'),
      results,
      ...(error ? { error } : {}),
    };
    await record(run);
    runs.push(run);
  }

  return runs;
}

/** The last few automatic runs, for the dashboard. */
export async function recentRuns(limit = 8) {
  const db = await withSchema();
  return await db`
    SELECT slot, ran_at, items, sent, failed, remaining, error
    FROM cron_runs
    ORDER BY ran_at DESC
    LIMIT ${Math.max(1, Math.min(limit, 50))}
  ` as {
    slot: string; ran_at: string; items: number; sent: number;
    failed: number; remaining: number; error: string | null;
  }[];
}
