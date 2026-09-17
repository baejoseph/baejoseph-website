export const prerender = false;

import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { withSchema } from '../../lib/db';
import { smtpConfigured, sendMail } from '../../lib/email';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email ?? '').trim().toLowerCase();
    const lang = body.lang === 'ko' ? 'ko' : body.lang === 'all' ? 'all' : 'en';
    const source = String(body.source ?? 'unknown').slice(0, 200);
    const path = String(body.path ?? '').slice(0, 300);

    if (!EMAIL_RE.test(email)) {
      return json({ error: 'That does not look like an email address.' }, 400);
    }

    const db = await withSchema();
    const token = randomBytes(16).toString('hex');

    try {
      await db`
        INSERT INTO subscribers (email, lang, source, unsub_token)
        VALUES (${email}, ${lang}, ${source}, ${token})
      `;
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505')) {
        await db`INSERT INTO signup_events (email, source, path) VALUES (${email}, ${source}, ${path})`;
        return json({ ok: true, already: true });
      }
      throw err;
    }

    await db`INSERT INTO signup_events (email, source, path) VALUES (${email}, ${source}, ${path})`;

    if (smtpConfigured()) {
      try {
        const tpl = await db`SELECT * FROM email_templates WHERE key = 'welcome' LIMIT 1`;
        const t = tpl[0];
        if (t) {
          await sendMail({
            to: email,
            subject: String(t.subject),
            html: String(t.html).replaceAll('{{UNSUB}}', token),
            text: String(t.text_body).replaceAll('{{UNSUB}}', token),
          });
        }
      } catch {
        // Signup still succeeds if the welcome letter cannot send.
      }
    }

    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('DATABASE_URL')) {
      return json({ error: 'Signups are not wired up yet.' }, 503);
    }
    return json({ error: 'Could not save that just now.' }, 500);
  }
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
