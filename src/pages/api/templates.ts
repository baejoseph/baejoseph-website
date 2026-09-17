export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../lib/auth';
import { withSchema } from '../../lib/db';
import { defaultWelcomeLetter } from '../../lib/newsletter';
import { sendMail, smtpConfigured } from '../../lib/email';

export const GET: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const db = await withSchema();
    const rows = await db`SELECT * FROM email_templates ORDER BY key`;
    return json({ templates: rows });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const PATCH: APIRoute = async ({ request }) => {
  const denied = requireAdmin(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const key = String(body.key || 'welcome');
  const db = await withSchema();

  if (body.action === 'rebuild') {
    const welcome = defaultWelcomeLetter();
    const rows = await db`
      INSERT INTO email_templates (key, subject, html, text_body, updated_at)
      VALUES (${key}, ${welcome.subject}, ${welcome.html}, ${welcome.text}, now())
      ON CONFLICT (key) DO UPDATE SET
        subject = EXCLUDED.subject,
        html = EXCLUDED.html,
        text_body = EXCLUDED.text_body,
        updated_at = now()
      RETURNING *
    `;
    return json({ template: rows[0] });
  }

  if (body.action === 'test') {
    if (!smtpConfigured()) return json({ error: 'SMTP is not configured' }, 500);
    const to = String(body.testTo || '');
    if (!to) return json({ error: 'testTo required' }, 400);
    const rows = await db`SELECT * FROM email_templates WHERE key = ${key} LIMIT 1`;
    const t = rows[0];
    if (!t) return json({ error: 'Template missing' }, 404);
    const html = String(t.html).replaceAll('{{UNSUB}}', 'test');
    const text = String(t.text_body).replaceAll('{{UNSUB}}', 'test');
    await sendMail({ to, subject: String(t.subject), html, text });
    return json({ ok: true });
  }

  const subject = String(body.subject ?? '');
  const html = String(body.html ?? '');
  const text = String(body.text ?? '');
  const rows = await db`
    INSERT INTO email_templates (key, subject, html, text_body, updated_at)
    VALUES (${key}, ${subject}, ${html}, ${text}, now())
    ON CONFLICT (key) DO UPDATE SET
      subject = EXCLUDED.subject,
      html = EXCLUDED.html,
      text_body = EXCLUDED.text_body,
      updated_at = now()
    RETURNING *
  `;
  return json({ template: rows[0] });
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
