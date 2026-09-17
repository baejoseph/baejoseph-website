import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, renderEmailBody, htmlToText } from './email-render.mjs';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/content/blog');
const out = join(root, 'src/lib/email-posts.json');
const bodiesOut = join(root, 'src/lib/email-bodies.json');

function excerptFromMarkdown(body, max = 420) {
  const text = body
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

const index = buildIndex(dir);
const processor = await createMarkdownProcessor({ gfm: true, smartypants: true });

const posts = [];
const unresolved = [];

for (const record of index.records) {
  const raw = readFileSync(join(dir, record.file), 'utf8');
  const fmEnd = raw.startsWith('---') ? raw.indexOf('\n---', 3) : -1;
  const body = fmEnd >= 0 ? raw.slice(fmEnd + 4).replace(/^\n/, '') : raw;

  // Full body, email-safe: absolute links, language-correct targets, absolute
  // images, inline styles. Rendered here so the API never has to.
  const { html, bytes, unresolved: missing } = await renderEmailBody(body, {
    lang: record.lang,
    index,
    processor,
  });
  for (const m of missing) {
    if (m.kind === 'link') unresolved.push({ file: record.file, ...m });
  }

  posts.push({
    slug: record.slug,
    lang: record.lang,
    title: record.title,
    date: record.date,
    pairedSlug: record.pairedSlug,
    featuredImage: record.featuredImage,
    excerpt: excerptFromMarkdown(body),
    html,
    htmlBytes: bytes,
    text: htmlToText(html),
  });
}

// Two files, deliberately:
//  - email-posts.json is small, committed, and is what the API reads for titles,
//    dates, language pairs and teasers;
//  - email-bodies.json holds the rendered full bodies. It is generated (and
//    gitignored) because it is large, fully derived from the markdown, and would
//    otherwise add megabytes to the repo on every content edit.
const meta = posts.map(({ html: _html, text: _text, htmlBytes: _bytes, ...rest }) => rest);
writeFileSync(out, JSON.stringify(meta));
writeFileSync(
  bodiesOut,
  JSON.stringify(Object.fromEntries(
    posts.map((p) => [`${p.lang}:${p.slug}`, { html: p.html, text: p.text, bytes: p.htmlBytes }]),
  )),
);
console.log(`email-posts.json: ${meta.length} posts, ${(Buffer.byteLength(JSON.stringify(meta)) / 1024 / 1024).toFixed(2)}MB`);
console.log(`email-bodies.json: ${(Buffer.byteLength(JSON.stringify(posts)) / 1024 / 1024).toFixed(2)}MB (generated, not committed)`);

if (unresolved.length) {
  // A broken link frozen into a sent letter cannot be fixed by the reader, so say
  // so loudly at build time rather than in someone's inbox.
  console.warn(`email links: ${unresolved.length} unresolvable internal link(s)`);
  for (const u of unresolved) console.warn(`  ${u.file}: ${u.href}`);
} else {
  console.log('email links: all internal links resolve');
}
