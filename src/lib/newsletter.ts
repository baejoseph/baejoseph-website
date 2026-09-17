import emailPosts from './email-posts.json';
import emailBodies from './email-bodies.json';

export type Slot = 'tuesday_featured' | 'friday_new';

/** How a letter was built. Stored in the letter itself as a marker comment so the
 *  dashboard can show it and a stale letter can be spotted and rebuilt. */
export type LetterMode = 'full' | 'excerpt';

/**
 * Bumped whenever the letter format changes. Queued letters carry the version they
 * were built with, and anything behind the current one is rebuilt from its post
 * automatically — no once-only migration that can fail silently and never retry.
 */
export const LETTERS_VERSION = 'fulltext-v1';

export const LIKE_PLACEHOLDER = '{{LIKE}}';

/** Gmail clips a message over ~102KB and hides everything past the cut — the
 *  unsubscribe link included. Anything over this falls back to the teaser. */
export const MAX_LETTER_BYTES = 95 * 1024;

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

type Body = { html: string; text: string; bytes: number };

const bodies = emailBodies as Record<string, Body>;
let warnedMissingBodies = false;

/** True when a body lookup has missed, i.e. the generated bodies file is stale or
 *  absent. Surfaced in the dashboard, because the alternative is finding out from
 *  a reader who got a teaser. */
export function bodiesMissing() {
  return warnedMissingBodies;
}

/**
 * Rendered full body for a post, produced by scripts/build-email-posts.mjs. If the
 * generated file is missing (not built yet, or a fresh checkout), letters fall
 * back to teasers rather than failing — and say so, once, in the logs.
 */
function bodyFor(post: { slug: string; lang: string }): Body | undefined {
  const hit = bodies[`${post.lang}:${post.slug}`];
  if (!hit && !warnedMissingBodies) {
    warnedMissingBodies = true;
    console.warn('[newsletter] email-bodies.json has no entry — run: node scripts/build-email-posts.mjs (letters fall back to teasers)');
  }
  return hit;
}

function allMd(): MdPost[] {
  return emailPosts as MdPost[];
}

/** Title of a post by slug, in either language. Used by the "I liked this" page. */
export function postTitle(slug: string): { title: string; lang: 'en' | 'ko' } | null {
  const post = allMd().find((p) => p.slug === slug);
  return post ? { title: post.title, lang: post.lang } : null;
}

function composeFromMd(post: MdPost, kind: Slot, note: string | undefined, uiLang: 'en' | 'ko') {
  const excerpt = post.excerpt;
  const body = bodyFor(post);
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
      bodyHtml: body?.html,
      bodyText: body?.text,
      likeSlug: post.slug,
      image: post.featuredImage,
      unsubToken: '{{UNSUB}}',
      kind,
      note: note ?? '',
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

/**
 * The "I liked this" button. The identity is filled in per recipient at send time
 * ({{LIKE}}), so one subscriber pressing it twice counts once, and no email
 * address is ever put in the URL.
 */
function likeBlock(slug: string, ko: boolean) {
  const href = `https://baejoseph.com/liked?slug=${encodeURIComponent(slug)}&i=${LIKE_PLACEHOLDER}&l=${ko ? 'ko' : 'en'}`;
  const label = ko ? '♥ 좋았습니다' : '♥ I liked this article';
  return `<tr>
            <td style="padding:4px 0 30px 0;">
              <a href="${href}" style="display:inline-block;border:1px solid #3a3a4a;border-radius:999px;padding:10px 18px;color:#818cf8;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:14px;font-weight:600;">
                ${label}
              </a>
            </td>
          </tr>`;
}

export function buildNewsletter(opts: {
  title: string;
  slug: string;
  date?: string;
  excerpt: string;
  /** Full post body as email-safe HTML. Omit for a teaser letter. */
  bodyHtml?: string;
  bodyText?: string;
  /** Slug to hang the "I liked this" button on. Omitted for the welcome letter. */
  likeSlug?: string;
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
}): Letter {
  const full = opts.bodyHtml
    ? renderLetter(opts, 'full', 'full')
    : renderLetter(opts, 'excerpt', 'teaser');
  // The clip limit is on the whole message, text part included.
  const totalBytes = Buffer.byteLength(full.html, 'utf8') + Buffer.byteLength(full.text, 'utf8');
  if (opts.bodyHtml && totalBytes > MAX_LETTER_BYTES) {
    // Too big to survive the inbox intact: send the teaser, on purpose. Marked
    // separately so it is not mistaken for a letter that still needs rebuilding.
    console.warn(`[newsletter] ${opts.slug}: ${(totalBytes / 1024).toFixed(0)}KB letter fell back to a teaser`);
    return { ...renderLetter(opts, 'excerpt', 'teaser-oversize'), oversize: true };
  }
  return full;
}

/** A letter in the right format says so in a comment at the top. Used to decide
 *  whether a stored letter is finished, or wants rebuilding. */
export function storedMarker(html: string | null | undefined): string | null {
  const m = /<!--LETTER:(full|teaser|teaser-oversize)-->/.exec(String(html || ''));
  return m ? m[1] : null;
}

/** Finished letters carry the post, or are a deliberate oversize teaser. */
export function isFinalHtml(html: string | null | undefined) {
  const marker = storedMarker(html);
  return marker === 'full' || marker === 'teaser-oversize';
}

/** A letter is finished when it either carries the post, or is a deliberate
 *  oversize teaser. Anything else wants rebuilding. */
export function isFinalLetter(letter: Letter | null | undefined) {
  return Boolean(letter && (letter.marker === 'full' || letter.marker === 'teaser-oversize'));
}

/** The letters_version to store for a freshly composed pair. */
export function versionFor(letters: (Letter | null | undefined)[]) {
  return letters.every(isFinalLetter) ? LETTERS_VERSION : null;
}

type Letter = {
  html: string;
  text: string;
  subject: string;
  mode: LetterMode;
  marker: 'full' | 'teaser' | 'teaser-oversize';
  oversize?: boolean;
};

function renderLetter(
  opts: Parameters<typeof buildNewsletter>[0],
  mode: LetterMode,
  marker: 'full' | 'teaser' | 'teaser-oversize',
): Letter {
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
  const noteMarkup = opts.note !== undefined ? noteBlock(note) : '';
  const likeMarkup = opts.likeSlug ? likeBlock(opts.likeSlug, ko) : '';
  const siteLine = ko
    ? `사이트에서 읽기: ${escapeHtml(url)}`
    : `Read it on the site: ${escapeHtml(url)}`;

  const bodyText = mode === 'full' && opts.bodyText ? opts.bodyText : opts.excerpt;

  const text = [
    `${kicker}`,
    note ? note : '',
    opts.title,
    opts.date || '',
    '',
    bodyText,
    '',
    opts.likeSlug ? `Liked it? https://baejoseph.com/liked?slug=${opts.likeSlug}&i=${LIKE_PLACEHOLDER}&l=${ko ? 'ko' : 'en'}` : '',
    `Read: ${url}`,
    '',
    `${unsubLabel}: ${unsubHref}`,
    `${prefsLabel}: ${prefsHref}`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  const contentRow = mode === 'full' && opts.bodyHtml
    ? `<tr>
            <td style="padding-bottom:26px;">
              ${opts.bodyHtml}
            </td>
          </tr>`
    : `<tr>
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
          </tr>`;

  const html = `<!DOCTYPE html>
<html lang="${ko ? 'ko' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;color:#e8e8e8;font-family:Georgia, 'Times New Roman', serif;">
  <!--LETTER:${marker}-->
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
          ${contentRow}
          ${mode === 'full' ? `<tr>
            <td style="padding-bottom:18px;font-family:Inter,Arial,sans-serif;font-size:13px;color:#888;">
              ${siteLine}
            </td>
          </tr>` : ''}
          ${likeMarkup}
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

  return { html, text, subject: opts.subject || `${kicker}: ${opts.title}`, mode, marker };
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
