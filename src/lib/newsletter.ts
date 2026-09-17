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

export async function composeFromSlug(slug: string, kind: Slot, note?: string) {
  const post = await postBySlug(slug);
  if (!post) return null;
  const lang = (post.data.lang ?? 'en') as string;
  const excerpt = excerptFromMarkdown(post.body ?? '');
  const date = post.data.date
    ? new Date(post.data.date).toLocaleDateString(lang === 'ko' ? 'ko-KR' : 'en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';
  return {
    post,
    lang,
    letter: buildNewsletter({
      title: post.data.title as string,
      slug: post.slug,
      date,
      excerpt,
      image: (post.data.featuredImage as string) || '',
      unsubToken: '{{UNSUB}}',
      kind,
      note: kind === 'tuesday_featured' ? (note ?? '') : undefined,
    }),
  };
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
  kicker?: string;
  ctaLabel?: string;
  ctaHref?: string;
  footer?: string;
  subject?: string;
  note?: string;
}) {
  const url = opts.ctaHref || postUrl(opts.slug);
  const unsubHref = opts.unsubToken.includes('{{UNSUB}}')
    ? 'https://baejoseph.com/unsubscribe?token={{UNSUB}}'
    : `https://baejoseph.com/unsubscribe?token=${encodeURIComponent(opts.unsubToken)}`;
  const kicker = opts.kicker || (opts.kind === 'friday_new' ? 'New this Friday' : 'From the archive');
  const ctaLabel = opts.ctaLabel || 'Read the rest →';
  const footer = opts.footer || 'You asked for this. One new post on Fridays, one from the archive on Tuesdays.';
  const img = opts.image
    ? (opts.image.startsWith('http') ? opts.image : `https://baejoseph.com${opts.image}`)
    : '';

  const note = (opts.note || '').trim();
  const noteMarkup = opts.kind === 'tuesday_featured' ? noteBlock(note) : '';

  const text = [
    `${kicker}`,
    note ? note : '',
    opts.title,
    opts.date || '',
    '',
    opts.excerpt,
    '',
    `Read: ${url}`,
    '',
    `Unsubscribe: ${unsubHref}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

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
          ${noteMarkup}
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
                ${escapeHtml(ctaLabel)}
              </a>
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #222;padding-top:16px;font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.6;color:#666;">
              ${escapeHtml(footer)}<br />
              <a href="${escapeHtml(unsubHref)}" style="color:#818cf8;">Unsubscribe</a>
              · <a href="https://baejoseph.com/" style="color:#818cf8;">baejoseph.com</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { html, text, subject: opts.subject || `${kicker}: ${opts.title}` };
}

export function defaultWelcomeLetter() {
  return buildNewsletter({
    title: 'Thank you for signing up',
    slug: 'intro',
    excerpt: [
      'Welcome. I am really glad you are here.',
      'You will hear from me twice a week: a new post on Fridays, and one from the archive on Tuesdays. No noise in between.',
      'If you want a little of who I am first, this is the door.',
      '환영합니다. 사이트 곳곳에 한국어 버튼이 있으니, 한글로도 편하게 읽으실 수 있습니다.',
    ].join('\n\n'),
    image: 'https://baejoseph.com/assets/intro.jpg',
    unsubToken: '{{UNSUB}}',
    kind: 'friday_new',
    kicker: 'Welcome',
    ctaLabel: 'Come in →',
    ctaHref: 'https://baejoseph.com/intro/',
    footer: 'You can leave anytime. No hard feelings.',
    subject: 'Welcome — thank you for signing up',
  });
}

export function noteBlock(note: string) {
  const inner = note.trim()
    ? `<tr>
            <td style="padding:0 0 22px 0;">
              <div style="font-size:17px;line-height:1.65;color:#e8e8e8;font-style:italic;border-left:3px solid #818cf8;padding:2px 0 2px 16px;">
                ${escapeHtml(note.trim()).replace(/\n/g, '<br />')}
              </div>
            </td>
          </tr>`
    : '';
  return `<!--NOTE-->${inner}<!--/NOTE-->`;
}

export function applyNote(html: string, note: string) {
  const block = noteBlock(note);
  if (/<!--NOTE-->[\s\S]*?<!--\/NOTE-->/.test(html)) {
    return html.replace(/<!--NOTE-->[\s\S]*?<!--\/NOTE-->/, block);
  }
  const idx = html.indexOf('</tr>');
  if (idx === -1) return html;
  return html.slice(0, idx + 5) + block + html.slice(idx + 5);
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
