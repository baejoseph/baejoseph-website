import emailPosts from './email-posts.json';

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

type MdPost = {
  slug: string;
  lang: 'en' | 'ko';
  title: string;
  date: string;
  pairedSlug: string;
  featuredImage: string;
  excerpt: string;
};

function allMd(): MdPost[] {
  return emailPosts as MdPost[];
}

function composeFromMd(post: MdPost, kind: Slot, note: string | undefined, uiLang: 'en' | 'ko') {
  const excerpt = post.excerpt;
  const date = post.date
    ? new Date(post.date).toLocaleDateString(uiLang === 'ko' ? 'ko-KR' : 'en-GB', {
        day: 'numeric', month: 'long', year: 'numeric',
      })
    : '';
  return {
    post: { slug: post.slug, data: { title: post.title, lang: post.lang } },
    lang: uiLang,
    letter: buildNewsletter({
      title: post.title,
      slug: post.slug,
      date,
      excerpt,
      image: post.featuredImage,
      unsubToken: '{{UNSUB}}',
      kind,
      note: kind === 'tuesday_featured' ? (note ?? '') : undefined,
      uiLang,
    }),
  };
}

export async function composeFromSlug(slug: string, kind: Slot, note?: string, uiLang?: 'en' | 'ko') {
  const posts = allMd();
  const post = uiLang
    ? posts.find(p => p.slug === slug && p.lang === uiLang)
    : posts.find(p => p.slug === slug);
  if (!post) return null;
  return composeFromMd(post, kind, note, post.lang);
}

export async function composePair(slug: string, kind: Slot, notes?: { en?: string; ko?: string }) {
  const posts = allMd();
  const post = posts.find(p => p.slug === slug);
  if (!post) return null;
  const pair = posts.find(p =>
    p.lang !== post.lang && (p.slug === post.pairedSlug || p.pairedSlug === post.slug)
  );
  const enPost = post.lang === 'ko' ? pair : post;
  const koPost = post.lang === 'ko' ? post : pair;
  if (!enPost || !koPost || enPost.lang !== 'en' || koPost.lang !== 'ko') {
    throw new Error(`Every queued post needs an EN+KO pair. Missing pair for ${slug}`);
  }
  return {
    en: composeFromMd(enPost, kind, notes?.en, 'en'),
    ko: composeFromMd(koPost, kind, notes?.ko, 'ko'),
    enSlug: enPost.slug,
    koSlug: koPost.slug,
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
  uiLang?: 'en' | 'ko';
}) {
  const ko = opts.uiLang === 'ko';
  const url = opts.ctaHref || postUrl(opts.slug);
  const tokenQs = opts.unsubToken.includes('{{UNSUB}}')
    ? '{{UNSUB}}'
    : encodeURIComponent(opts.unsubToken);
  const unsubHref = `https://baejoseph.com/unsubscribe?token=${tokenQs}`;
  const prefsHref = `https://baejoseph.com/preferences?token=${tokenQs}`;
  const kicker = opts.kicker || (opts.kind === 'friday_new'
    ? (ko ? '이번 금요일' : 'New this Friday')
    : (ko ? '지난 글에서' : 'From the archive'));
  const ctaLabel = opts.ctaLabel || (ko ? '이어서 읽기 →' : 'Read the rest →');
  const footer = opts.footer || (ko
    ? '금요일에 새 글 하나, 화요일에 지난 글 하나. 그뿐입니다.'
    : 'You asked for this. One new post on Fridays, one from the archive on Tuesdays.');
  const unsubLabel = ko ? '구독 해지' : 'Unsubscribe';
  const prefsLabel = ko ? '설정' : 'Preferences';
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
    `${unsubLabel}: ${unsubHref}`,
    `${prefsLabel}: ${prefsHref}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  const html = `<!DOCTYPE html>
<html lang="${ko ? 'ko' : 'en'}">
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
              <a href="${escapeHtml(unsubHref)}" style="color:#818cf8;">${escapeHtml(unsubLabel)}</a>
              · <a href="${escapeHtml(prefsHref)}" style="color:#818cf8;">${escapeHtml(prefsLabel)}</a>
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
    uiLang: 'en',
  });
}

export function defaultWelcomeLetterKo() {
  return buildNewsletter({
    title: '구독해 주셔서 감사합니다',
    slug: '소개',
    excerpt: [
      '환영합니다. 와 주셔서 정말 기쁩니다.',
      '금요일마다 새 글 하나, 화요일마다 지난 글 하나를 보내드립니다. 그 사이에는 소음이 없습니다.',
      '제가 누구인지 먼저 알고 싶으시면, 이 문이 시작입니다.',
      'Welcome. There is an English button on every page if you would rather read in English.',
    ].join('\n\n'),
    image: 'https://baejoseph.com/assets/intro.jpg',
    unsubToken: '{{UNSUB}}',
    kind: 'friday_new',
    kicker: '환영합니다',
    ctaLabel: '들어오기 →',
    ctaHref: 'https://baejoseph.com/%EC%86%8C%EA%B0%9C/',
    footer: '언제든 떠나셔도 됩니다. 섭섭해하지 않습니다.',
    subject: '환영합니다 — 구독해 주셔서 감사합니다',
    uiLang: 'ko',
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
