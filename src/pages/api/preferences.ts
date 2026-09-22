export const prerender = false;

import type { APIRoute } from 'astro';
import { withSchema } from '../../lib/db';

/**
 * A reader's own settings, reached from the token at the foot of every letter.
 *
 * Both fields are optional and are applied on their own: saving a theme must not
 * quietly reset the language, which is exactly what a "send both every time"
 * contract would do.
 */

const THEMES = ['dark', 'light'] as const;
const LANGS = ['en', 'ko'] as const;
type Theme = (typeof THEMES)[number];
type Lang = (typeof LANGS)[number];

/** Anything that is not an explicit light choice is dark, including old rows. */
function asTheme(value: unknown): Theme {
  return value === 'light' ? 'light' : 'dark';
}

function asLang(value: unknown): Lang {
  return value === 'ko' ? 'ko' : 'en';
}

function picked<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) return json({ error: 'Missing token' }, 400);
  const db = await withSchema();
  const rows = await db`
    SELECT email, lang, theme FROM subscribers
    WHERE unsub_token = ${token} AND unsubscribed_at IS NULL
    LIMIT 1
  `;
  if (!rows[0]) return json({ error: 'Not found' }, 404);
  return json({
    email: rows[0].email,
    lang: asLang(rows[0].lang),
    theme: asTheme(rows[0].theme),
  });
};

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.json().catch(() => ({}));
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const token = String(body.token ?? '').trim();
  if (!token) return json({ error: 'Missing token' }, 400);

  const lang = picked(LANGS, body.lang);
  const theme = picked(THEMES, body.theme);
  if ('lang' in body && lang === null) return json({ error: 'lang must be en or ko' }, 400);
  if ('theme' in body && theme === null) return json({ error: 'theme must be dark or light' }, 400);
  if (!lang && !theme) return json({ error: 'Nothing to change' }, 400);

  const db = await withSchema();
  const current = await db`
    SELECT lang, theme FROM subscribers
    WHERE unsub_token = ${token} AND unsubscribed_at IS NULL
    LIMIT 1
  `;
  if (!current[0]) return json({ error: 'Not found' }, 404);

  // A theme-only save must not rewrite language, and the other way around.
  // Values already in the row are normalised so a blank legacy cell cannot stick.
  const nextLang = lang ?? asLang(current[0].lang);
  const nextTheme = theme ?? asTheme(current[0].theme);
  await db`
    UPDATE subscribers SET lang = ${nextLang}, theme = ${nextTheme}
    WHERE unsub_token = ${token} AND unsubscribed_at IS NULL
  `;
  return json({ ok: true, lang: nextLang, theme: nextTheme });
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
