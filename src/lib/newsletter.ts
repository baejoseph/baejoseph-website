import { getCollection } from 'astro:content';

export type Slot = 'tuesday_featured' | 'friday_new';

export function excerptFromMarkdown(body: string, max = 420) {
  const text = body
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>`]/g, '')
    .replace(/\r/g, '')
    .replace(/\n{2,}/g, '\n\n')
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

export async function postBySlug(slug: string) {
  const posts = await getCollection('blog');
  return posts.find(p => p.slug === slug) ?? null;
}

export function postUrl(slug: string) {
  return `https://baejoseph.com/${slug}/`;
}

export function buildNewsletter(opts: {
  title: string;
  slug: string;
  date?: string;
  excerpt: string;
  image?: string;
  unsubToken: string;
  kind: Slot;
}) {
  const url = postUrl(opts.slug);
  const unsub = `https://baejoseph.com/unsubscribe?token=${encodeURIComponent(opts.unsubToken)}`;
  const kicker = opts.kind === 'friday_new' ? 'New this Friday' : 'From the archive';
  const img = opts.image
    ? (opts.image.startsWith('http') ? opts.image : `https://baejoseph.com${opts.image}`)
    : '';

  const text = [
    `${kicker}`,
    opts.title,
    '',
    opts.excerpt,
    '',
    `Read: ${url}`,
    '',
    `Unsubscribe: ${unsub}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#e8e8e8;font-family:Georgia, 'Times New Roman', serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
          <tr>
            <td style="padding-bottom:20px;font-family:Inter,Arial,sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#818cf8;">
              ${escapeHtml(kicker)} · Joseph Bae
            </td>
          </tr>
          ${img ? `<tr><td style="padding-bottom:20px;">
            <img src="${escapeHtml(img)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:8px;border:1px solid #222;" />
          </td></tr>` : ''}
          <tr>
            <td style="padding-bottom:12px;font-size:26px;line-height:1.25;font-weight:700;color:#ffffff;">
              ${escapeHtml(opts.title)}
            </td>
          </tr>
          ${opts.date ? `<tr><td style="padding-bottom:16px;font-family:Inter,Arial,sans-serif;font-size:13px;color:#888;">${escapeHtml(opts.date)}</td></tr>` : ''}
          <tr>
            <td style="padding-bottom:24px;font-size:17px;line-height:1.7;color:#d4d4d4;">
              ${escapeHtml(opts.excerpt).replace(/\n/g, '<br />')}
            </td>
          </tr>
          <tr>
            <td style="padding-bottom:36px;">
              <a href="${escapeHtml(url)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:14px;font-weight:600;letter-spacing:0.04em;padding:12px 20px;border-radius:999px;">
                Read the rest →
              </a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #222;padding-top:16px;font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.6;color:#666;">
              You asked for this. One new post on Fridays, one from the archive on Tuesdays.<br />
              <a href="${escapeHtml(unsub)}" style="color:#818cf8;">Unsubscribe</a>
              · <a href="https://baejoseph.com/" style="color:#818cf8;">baejoseph.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text, subject: `${kicker}: ${opts.title}` };
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
