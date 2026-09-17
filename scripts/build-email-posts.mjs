import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/content/blog');
const out = join(root, 'src/lib/email-posts.json');

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

function parse(raw) {
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

const posts = [];
for (const name of readdirSync(dir)) {
  if (!name.endsWith('.md')) continue;
  const fileSlug = name.slice(0, -3);
  const { data, body } = parse(readFileSync(join(dir, name), 'utf8'));
  posts.push({
    slug: data.slug || fileSlug,
    lang: data.lang === 'ko' ? 'ko' : 'en',
    title: data.title || fileSlug,
    date: data.date || '',
    pairedSlug: data.pairedSlug || '',
    featuredImage: data.featuredImage || '',
    excerpt: excerptFromMarkdown(body),
  });
}

writeFileSync(out, JSON.stringify(posts));
console.log(`email-posts.json: ${posts.length} posts`);
