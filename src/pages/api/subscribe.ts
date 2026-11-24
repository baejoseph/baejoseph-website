export const prerender = false;

import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { withSchema, type Db } from '../../lib/db';
import { smtpConfigured, sendMail } from '../../lib/email';
import { paintLetter } from '../../lib/newsletter';
import { allow, clientIp, hashKey, prune } from '../../lib/rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Per address: enough room for a shared connection, not enough to mailbomb the list. */
const IP_LIMIT = 5;
const IP_WINDOW = 60 * 60;
/**
 * Circuit breaker: protects the Hostinger mailbox's reputation if a bot storm
 * arrives. It used to be 200 an hour, which is more than the list has ever
 * gained in a week — a storm could burn the day's sending reputation before
 * anyone noticed. 25 an hour is still far above organic traffic.
 */
const GLOBAL_LIMIT = 25;
const GLOBAL_WINDOW = 60 * 60;

/**
 * Every signup has to carry the two fields the site's own form always fills in:
 * the page it was made on, and which post or hero it came from. A script posting
 * straight at this endpoint sends neither (that is exactly how the November
 * "unknown" campaign arrived), so it is answered like a success and quietly
 * dropped. Recorded rather than thrown away, so a genuinely broken form would
 * show up on the dashboard instead of silently losing readers.
 */
function looksLikeTheForm(source: string, path: string) {
  return Boolean(path) && Boolean(source) && source !== 'unknown';
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));

    // Honeypot: a field only a bot fills in. Pretend the signup worked.
    if (String(body.website ?? '').trim()) {
      return json({ ok: true });
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    const lang = body.lang === 'ko' ? 'ko' : 'en';
    const source = String(body.source ?? 'unknown').slice(0, 200);
    const path = String(body.path ?? '').slice(0, 300);
    // Evidence, kept with the event: a real form always carries a path (see
    // SignupForm.astro), so an empty one plus no browser string means the
    // address was posted straight at this endpoint rather than by a reader.
    const ua = String(request.headers.get('user-agent') ?? '').slice(0, 300);
    const referer = String(request.headers.get('referer') ?? '').slice(0, 300);
    const ipHash = hashKey('ip', clientIp(request));

    if (!EMAIL_RE.test(email)) {
      return json({ error: 'That does not look like an email address.' }, 400);
    }

    const db = await withSchema();

    // Before the rate limiter, and before any work: a blacklisted address is
    // answered exactly as if it had joined, so a campaign learns nothing and
    // stops retrying a list it cannot get onto.
    const banned = await db`SELECT 1 FROM signup_blacklist WHERE email = ${email} LIMIT 1`;
    if (banned.length > 0) {
      await noteBlocked(db, email, 'blacklisted', path, ua, ipHash);
      return json({ ok: true });
    }
    if (!looksLikeTheForm(source, path)) {
      await noteBlocked(db, email, 'no-page-path', path, ua, ipHash);
      return json({ ok: true });
    }

    void prune(db);

    const perIp = await allow(db, hashKey('subscribe', clientIp(request)), IP_LIMIT, IP_WINDOW);
    if (!perIp.allowed) {
      return json({ error: 'That is a lot of signups from here. Try again a little later.' }, 429, {
        'Retry-After': String(perIp.retryAfter),
      });
    }
    const overall = await allow(db, 'subscribe:all', GLOBAL_LIMIT, GLOBAL_WINDOW);
    if (!overall.allowed) {
      console.error('[subscribe] hourly signup cap reached — signups paused');
      return json({ error: 'Signups are paused for a moment. Please try again shortly.' }, 429, {
        'Retry-After': String(overall.retryAfter),
      });
    }

    const token = randomBytes(16).toString('hex');
    let subscriber: { id: number; unsub_token: string } | null = null;
    let already = false;
    let revived = false;

    try {
      const rows = await db`
        INSERT INTO subscribers (email, lang, source, unsub_token)
        VALUES (${email}, ${lang}, ${source}, ${token})
        RETURNING id, unsub_token
      ` as { id: number; unsub_token: string }[];
      subscriber = rows[0] ?? null;
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (!(msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505'))) throw err;

      const existing = await db`
        SELECT id, unsub_token, unsubscribed_at, suppressed_at
        FROM subscribers WHERE email = ${email} LIMIT 1
      ` as { id: number; unsub_token: string; unsubscribed_at: string | null; suppressed_at: string | null }[];
      const row = existing[0];
      if (!row) throw err;

      subscriber = { id: row.id, unsub_token: row.unsub_token };
      if (row.unsubscribed_at) {
        // They left and came back: put them back on the list and say hello again.
        await db`
          UPDATE subscribers
          SET unsubscribed_at = NULL, suppressed_at = NULL, suppress_reason = NULL, lang = ${lang}
          WHERE id = ${row.id}
        `;
        revived = true;
      } else {
        already = true;
      }
    }

    await db`INSERT INTO signup_events (email, source, path, user_agent, referer, ip_hash)
      VALUES (${email}, ${source}, ${path}, ${ua}, ${referer}, ${ipHash})`;

    // An existing, active subscriber is not mailbombed with a second welcome letter.
    if (already) return json({ ok: true, already: true });

    const welcome = await sendWelcome(db, email, subscriber?.unsub_token ?? token, lang);
    if (subscriber) {
      try {
        if (welcome.ok) {
          await db`UPDATE subscribers SET welcomed_at = now(), welcome_error = NULL WHERE id = ${subscriber.id}`;
        } else {
          await db`UPDATE subscribers SET welcome_error = ${welcome.error} WHERE id = ${subscriber.id}`;
        }
      } catch (err) {
        console.error('[subscribe] could not record welcome status:', err);
      }
    }

    return json({ ok: true, revived, welcomed: welcome.ok });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('DATABASE_URL')) {
      return json({ error: 'Signups are not wired up yet.' }, 503);
    }
    console.error('[subscribe] failed:', err);
    return json({ error: 'Could not save that just now.' }, 500);
  }
};

/**
 * Record a refused signup. The caller is told it worked either way, so a
 * bookkeeping failure here must never turn into a 500 that tells a bot its
 * address was rejected.
 */
async function noteBlocked(
  db: Db,
  email: string,
  reason: string,
  path: string,
  ua: string,
  ipHash: string,
) {
  try {
    await db`INSERT INTO blocked_signups (email, reason, path, user_agent, ip_hash)
      VALUES (${email}, ${reason}, ${path || null}, ${ua || null}, ${ipHash})`;
    if (reason === 'blacklisted') {
      await db`UPDATE signup_blacklist SET hits = hits + 1, last_seen_at = now() WHERE email = ${email}`;
    }
    // Housekeeping without a cron of its own; this table only needs a month of
    // history to show whether a campaign has stopped.
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
      await db`DELETE FROM blocked_signups WHERE created_at < ${cutoff}::timestamptz`;
    }
  } catch (err) {
    console.error('[subscribe] could not record a blocked signup:', err);
  }
}

/**
 * The welcome letter used to fail into an empty catch block: a subscriber could
 * get nothing and Joseph would never know. Now the outcome is returned and stored
 * on the subscriber row (dashboard shows a "no welcome" pill).
 */
async function sendWelcome(
  db: Db,
  email: string,
  token: string,
  lang: 'en' | 'ko',
): Promise<{ ok: boolean; error: string | null }> {
  if (!smtpConfigured()) {
    return { ok: false, error: 'SMTP is not configured' };
  }
  try {
    const key = lang === 'ko' ? 'welcome_ko' : 'welcome';
    const tpl = await db`SELECT * FROM email_templates WHERE key = ${key} LIMIT 1` as any[];
    const t = tpl[0];
    if (!t) return { ok: false, error: `template '${key}' is missing` };
    const pref = await db`SELECT theme FROM subscribers WHERE email = ${email} LIMIT 1` as { theme: string | null }[];
    const theme = pref[0]?.theme === 'light' ? 'light' : 'dark';
    await sendMail({
      to: email,
      subject: String(t.subject),
      html: paintLetter(String(t.html).replaceAll('{{UNSUB}}', token), theme),
      text: String(t.text_body).replaceAll('{{UNSUB}}', token),
    });
    return { ok: true, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[subscribe] welcome letter failed for ${email}: ${error}`);
    return { ok: false, error };
  }
}

function json(obj: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
