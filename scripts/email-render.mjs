/**
 * Renders a blog post's markdown into email-safe HTML.
 *
 * Email is not the web:
 *  - a relative href has no base URL, so /courage/ is a dead link (Gmail may even
 *    rewrite it into a broken redirect) — every link must be absolute;
 *  - a Korean reader clicking through to an English page is exactly the friction
 *    the letter is supposed to remove, so targets are resolved *per language*
 *    using each post's pairedSlug;
 *  - raw Hangul in an href is fine in a browser but not reliably handled by mail
 *    clients, so paths get percent-encoded;
 *  - relative image paths never render, and images are blocked by default until
 *    the reader opts in;
 *  - the letter's styles are inline, so markdown's bare <a>/<p>/<h2> inherit
 *    nothing — unstyled links would be default blue on a #0a0a0a background.
 *
 * Runs at build time (scripts/build-email-posts.mjs) so the API stays cheap.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';

export const SITE = 'https://baejoseph.com';

/** Letter-wide budget. Gmail clips a message over ~102KB and hides the footer,
 *  unsubscribe link included, so anything approaching that falls back to a
 *  teaser + link instead. See MAX_LETTER_BYTES in lib/newsletter.ts. */
export const MAX_BODY_BYTES = 86 * 1024;

const S = {
  p: 'margin:0 0 18px 0;font-size:17px;line-height:1.7;color:#d4d4d4;',
  h1: 'margin:32px 0 14px 0;font-size:24px;line-height:1.3;font-weight:700;color:#ffffff;',
  h2: 'margin:32px 0 14px 0;font-size:22px;line-height:1.3;font-weight:700;color:#ffffff;',
  h3: 'margin:26px 0 12px 0;font-size:19px;line-height:1.35;font-weight:700;color:#ffffff;',
  h4: 'margin:22px 0 10px 0;font-size:17px;line-height:1.4;font-weight:700;color:#ffffff;',
  blockquote: 'margin:0 0 18px 0;padding:2px 0 2px 16px;border-left:3px solid #818cf8;color:#e8e8e8;font-style:italic;',
  ul: 'margin:0 0 18px 0;padding-left:22px;color:#d4d4d4;',
  ol: 'margin:0 0 18px 0;padding-left:22px;color:#d4d4d4;',
  li: 'margin:0 0 8px 0;font-size:17px;line-height:1.65;color:#d4d4d4;',
  a: 'color:#818cf8;text-decoration:underline;',
  img: 'display:block;width:100%;max-width:560px;height:auto;border-radius:8px;border:1px solid #222;margin:20px 0;',
  hr: 'border:0;border-top:1px solid #222;margin:28px 0;',
  code: 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;color:#e8e8e8;',
  strong: 'color:#ffffff;',
};

export function parseFrontmatter(raw) {
  let fm = '';
  let body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end >= 0) {
      fm = raw.slice(4, end);
      body = raw.slice(end + 4).replace(/^\n/, '');
    }
  }
  const data = {};
  for (const line of fm.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return { data, body };
}

/**
 * Every post file, indexed by slug and by legacy WordPress slug so old links
 * still resolve. Also answers "what is this post's slug in the other language?".
 */
export function buildIndex(blogDir) {
  const records = [];
  for (const name of readdirSync(blogDir)) {
    if (!name.endsWith('.md')) continue;
    const fileSlug = name.slice(0, -3);
    const { data } = parseFrontmatter(readFileSync(join(blogDir, name), 'utf8'));
    records.push({
      file: name,
      slug: data.slug || fileSlug,
      lang: data.lang === 'ko' ? 'ko' : 'en',
      title: data.title || fileSlug,
      date: data.date || '',
      pairedSlug: data.pairedSlug || '',
      wpSlug: data.wpSlug || '',
      featuredImage: data.featuredImage || '',
    });
  }

  const byAlias = new Map();
  const byLowerAlias = new Map();
  for (const r of records) {
    byAlias.set(r.slug, r);
    byLowerAlias.set(r.slug.toLowerCase(), r);
    if (r.wpSlug) {
      byAlias.set(r.wpSlug, r);
      byLowerAlias.set(r.wpSlug.toLowerCase(), r);
    }
  }

  // slug -> the same post's slug in the other language
  const counterpart = new Map();
  for (const r of records) {
    const other = records.find((o) =>
      o.lang !== r.lang && (o.slug === r.pairedSlug || o.pairedSlug === r.slug));
    if (other) {
      counterpart.set(`${r.lang}:${r.slug}`, other.slug);
      counterpart.set(`${other.lang}:${other.slug}`, r.slug);
    }
  }

  return {
    records,
    dir: blogDir,
    byAlias,
    /** The slug a reader of `lang` should land on for this target, or null if unknown. */
    resolve(target, lang) {
      const decoded = safeDecode(target);
      const alias = decoded.replace(/^\/+|\/+$/g, '').split('#')[0].split('?')[0];
      // Case-insensitive fallback: old posts link to /XCC and /Iran, which 404 on
      // the site (routes are case-sensitive) but clearly mean /xcc and /iran.
      const record = byAlias.get(alias) ?? byLowerAlias.get(alias.toLowerCase());
      if (!record) return null;
      const exact = byAlias.get(alias) === record;
      if (record.lang !== lang) {
        const other = counterpart.get(`${record.lang}:${record.slug}`);
        if (other) return { slug: other, lang, record, caseFixed: !exact };
      }
      return { slug: record.slug, lang: record.lang, record, caseFixed: !exact };
    },
  };
}

/** A path that points at a file rather than a page (images and other assets). */
function looksLikeAsset(href) {
  return href.startsWith('/assets/') || /\.[a-z0-9]{2,5}$/i.test(href.split('?')[0].split('#')[0]);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Absolute, percent-encoded URL for a slug path. Hangul slugs stay readable
 *  in the source but go out encoded. */
export function postUrl(slug) {
  return `${SITE}/${encodeURIComponent(slug)}/`;
}

function absoluteAsset(src) {
  if (!src) return src;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  if (src.startsWith('/')) return `${SITE}${encodeURI(src)}`;
  return `${SITE}/${encodeURI(src)}`;
}

/**
 * Emails have no stylesheet: every rule has to be inline, and the letter's own
 * styles are (background #0a0a0a, colour #e8e8e8), so a bare <a> would render
 * default blue on near-black. Adds the style to any tag that lacks one, keeping
 * existing attributes (heading ids, hrefs, etc) intact.
 */
function styleAttributes(html) {
  const tags = ['p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'hr', 'strong', 'code', 'a', 'img', 'em'];
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}((?:\\s[^>]*?)?)\\s*/?>`, 'g'), (full, attrs = '') => {
      if (/style="/.test(attrs)) return full;
      const clean = attrs.replace(/\/$/, '').trimEnd();
      return `<${tag}${clean} style="${S[tag]}">`;
    });
  }
  return out;
}

/**
 * Render one post body for one language. Returns the HTML, its size, and any
 * internal links that point nowhere — surfaced as a build warning so broken
 * links are caught before they are frozen into a sent email.
 */
export async function renderEmailBody(markdown, { lang, index, processor }) {
  const md = processor ?? await createMarkdownProcessor({ gfm: true, smartypants: true });
  const { code } = await md.render(markdown);
  const unresolved = [];

  let html = code;

  // links: absolute, language-correct, percent-encoded (styling happens below)
  html = html.replace(/<a href="([^"]*)"([^>]*)>/g, (full, href, rest) => {
    if (/^(https?:|mailto:|#)/i.test(href)) return full;
    // A link to a file (e.g. the full-size version of an image) just needs to be
    // absolute; it is not a post.
    if (looksLikeAsset(href)) {
      return `<a href="${absoluteAsset(href)}"${rest}>`;
    }
    const hit = index.resolve(href, lang);
    if (!hit) {
      unresolved.push({ href, kind: 'link' });
      return full; // leave it; the audit reports it
    }
    if (hit.caseFixed) unresolved.push({ href, kind: 'case', fixedTo: hit.slug });
    const hash = href.includes('#') ? `#${href.split('#').slice(1).join('#')}` : '';
    return `<a href="${postUrl(hit.slug)}${hash}"${rest}>`;
  });

  // images: absolute src, never wider than the letter, alt left exactly as authored
  html = html.replace(/<img((?:\s[^>]*?)?)\s*\/?>/g, (full, attrs = '') => {
    const clean = attrs.replace(/\/$/, '').trimEnd();
    const withAbsolute = clean.replace(/src="([^"]*)"/, (m, src) => `src="${absoluteAsset(src)}"`);
    return `<img${withAbsolute}>`;
  });

  html = styleAttributes(html);

  return { html, bytes: Buffer.byteLength(html, 'utf8'), unresolved };
}

/** Plain-text twin for the text/plain part of the letter. */
export function htmlToText(html) {
  return html
    .replace(/<\/(p|h1|h2|h3|h4|li|blockquote)>/g, '\n\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Walk every post and report internal links that resolve to nothing. */
export async function auditLinks(index) {
  const processor = await createMarkdownProcessor({ gfm: true, smartypants: true });
  const broken = [];
  for (const record of index.records) {
    const { body } = parseFrontmatter(
      readFileSync(join(index.dir ?? '', record.file), 'utf8'));
    const { unresolved } = await renderEmailBody(body, { lang: record.lang, index, processor });
    for (const u of unresolved) broken.push({ file: record.file, ...u });
  }
  const counts = new Map();
  for (const b of broken) counts.set(b.href, (counts.get(b.href) || 0) + 1);
  return { broken, counts };
}
