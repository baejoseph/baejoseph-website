/**
 * fix-pairs.mjs
 * Properly re-detects language and EN/KO pairs from the markdown files.
 * Strategy:
 *  1. Language: count Korean Unicode chars in stripped text (not HTML/links)
 *  2. Pairs:    look for explicit "English is here" / "한글은 여기" markers + the linked slug
 *  3. Fallback: same date + complementary language
 *  4. Rewrite frontmatter in all markdown files
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src', 'content', 'blog');

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: content, raw: '' };
  const raw = m[1];
  const body = m[2];
  const fm = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(': ');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 2).trim().replace(/^"(.*)"$/, '$1');
    fm[key] = val;
  }
  return { fm, body, raw };
}

function serializeFrontmatter(fm) {
  const order = ['title', 'date', 'wpSlug', 'lang', 'featuredImage', 'pairedSlug', 'secondLang'];
  const lines = ['---'];
  for (const key of order) {
    if (fm[key] !== undefined && fm[key] !== '') {
      const val = fm[key].replace(/"/g, '\\"');
      lines.push(`${key}: "${val}"`);
    }
  }
  // Any remaining keys not in order
  for (const [key, val] of Object.entries(fm)) {
    if (!order.includes(key) && val !== undefined && val !== '') {
      lines.push(`${key}: "${String(val).replace(/"/g, '\\"')}"`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ── Language detection from MARKDOWN body ───────────────────────────────────

function detectLang(markdownBody) {
  // Strip markdown links: [text](url) → text
  let text = markdownBody.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Strip markdown images
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '');
  // Strip HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Strip URLs
  text = text.replace(/https?:\/\/\S+/g, '');
  // Strip markdown headers, code, etc.
  text = text.replace(/^#{1,6}\s+/gm, '');
  text = text.replace(/`[^`]+`/g, '');
  text = text.replace(/```[\s\S]*?```/g, '');
  // Strip frontmatter markers
  text = text.replace(/^---.*$/gm, '');
  // Strip the pair markers themselves
  text = text.replace(/\[English.*?here.*?\]/gi, '');
  text = text.replace(/\[한글은.*?있습니다\]/g, '');

  const cleaned = text.replace(/\s/g, '');
  if (cleaned.length < 50) return 'en'; // too short to tell

  const koChars = (cleaned.match(/[\uAC00-\uD7AF]/g) || []).length;
  const ratio = koChars / cleaned.length;
  return ratio > 0.05 ? 'ko' : 'en';
}

// ── Pair detection ───────────────────────────────────────────────────────────

// Look for explicit pair link markers in the first 5 lines of the body
// Patterns:
//   [English is here](URL)  or  [English version is here](URL)
//   [한글은 [여기](URL) 있습니다]  or  [Korean is here](URL)
//   English is [here](URL).  (various phrasings)

function findExplicitPairLink(body, ownWpSlug) {
  const firstLines = body.split('\n').slice(0, 8).join('\n');

  // Pattern: explicit EN/KO header link
  const patterns = [
    // [English is [here](URL).]  or  [English version is [here](URL)]
    /English(?:\s+version)?\s+(?:is\s+)?\[here\]\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/i,
    // [English is here](URL)
    /\[English(?:\s+version)?(?:\s+is)?\s+here\]\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/i,
    // \[English\] ... [here](URL)
    /English[^\n]*\[here\]\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/i,
    // [한글은 [여기](URL)]  or  [한글은 여기](URL)
    /한글은[^\n]*\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/,
    /\[한글은[^\]]*\]\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/,
    // Korean is [here](URL) or [here] 
    /Korean(?:\s+is)?\s+\[here\]\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/i,
    // [See the English version](URL)
    /See the English[^\]]*\]\(https?:\/\/baejoseph\.com\/([^/)]+)\/?/i,
  ];

  for (const pat of patterns) {
    const m = firstLines.match(pat);
    if (m) {
      const rawSlug = m[1];
      try {
        const decoded = decodeURIComponent(rawSlug);
        if (decoded !== ownWpSlug && rawSlug !== ownWpSlug) {
          return decoded; // return the decoded slug of the pair
        }
      } catch {
        if (rawSlug !== ownWpSlug) return rawSlug;
      }
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));

// Load all posts
const posts = new Map(); // decoded-slug → post data
for (const f of files) {
  const content = readFileSync(join(BLOG_DIR, f), 'utf8');
  const { fm, body } = parseFrontmatter(content);
  const slug = f.replace(/\.md$/, '');
  const lang = detectLang(body);
  const explicitPair = findExplicitPairLink(body, fm.wpSlug ?? slug);
  posts.set(slug, { f, slug, fm, body, lang, explicitPair });
}

console.log(`Loaded ${posts.size} posts\n`);

// ── Phase 1: explicit pair links ────────────────────────────────────────────

const pairs = new Map(); // slug → pairedSlug (decoded)

for (const [slug, post] of posts) {
  if (post.explicitPair) {
    // Verify the target exists
    if (posts.has(post.explicitPair)) {
      pairs.set(slug, post.explicitPair);
      console.log(`  Explicit: ${slug} [${post.lang}] ↔ ${post.explicitPair} [${posts.get(post.explicitPair).lang}]`);
    } else {
      console.warn(`  ⚠ Explicit pair not found: ${slug} → ${post.explicitPair}`);
    }
  }
}

// Make pairs bidirectional (if A→B, also set B→A)
for (const [slug, pairedSlug] of [...pairs]) {
  if (!pairs.has(pairedSlug)) {
    const paired = posts.get(pairedSlug);
    if (paired) {
      pairs.set(pairedSlug, slug);
    }
  }
}

// ── Manual overrides (known pairs the algorithm can't auto-detect) ────────────

const MANUAL_PAIRS = [
  ['courage',   '용기'],              // Trump/courage post, 1 day apart
  ['values',    '가치'],              // Family values, same date
  ['trade',     '솔로몬의-부의-비밀'], // Solomon wealth, same date
  ['climate',   '환경'],              // Climate/environment, same week
];

console.log('\n--- Manual pairs ---');
for (const [en, ko] of MANUAL_PAIRS) {
  if (!pairs.has(en) && !pairs.has(ko) && posts.has(en) && posts.has(ko)) {
    pairs.set(en, ko);
    pairs.set(ko, en);
    console.log(`  Manual: ${en} [${posts.get(en).lang}] ↔ ${ko} [${posts.get(ko).lang}]`);
  }
}

// ── Phase 2: same-date fallback for unlinked pairs ──────────────────────────

// Title similarity: does title A relate to title B?
function titlesRelated(titleA, titleB) {
  const normalize = t => t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  const a = normalize(titleA);
  const b = normalize(titleB);
  // Check for shared significant words (length > 3)
  const wordsA = a.split(' ').filter(w => w.length > 3);
  const wordsB = b.split(' ').filter(w => w.length > 3);
  for (const wa of wordsA) {
    if (wordsB.some(wb => wb.includes(wa) || wa.includes(wb))) return true;
  }
  return false;
}

// Group posts by date (±1 day)
const allDates = [...posts.values()].filter(p => p.fm.date).map(p => ({ slug: p.slug, date: p.fm.date, lang: p.lang, title: p.fm.title }));
allDates.sort((a, b) => a.date.localeCompare(b.date));

console.log('\n--- Same-date / proximity fallback pairs ---');
const dateGrouped = new Map();
for (const p of allDates) {
  if (!dateGrouped.has(p.date)) dateGrouped.set(p.date, []);
  dateGrouped.get(p.date).push(p);
}

// Try same-date first (1 EN + 1 KO)
for (const [date, group] of dateGrouped) {
  const enPosts = group.filter(p => p.lang === 'en' && !pairs.has(p.slug));
  const koPosts = group.filter(p => p.lang === 'ko' && !pairs.has(p.slug));

  if (enPosts.length === 1 && koPosts.length === 1) {
    const enSlug = enPosts[0].slug;
    const koSlug = koPosts[0].slug;
    pairs.set(enSlug, koSlug);
    pairs.set(koSlug, enSlug);
    console.log(`  Date ${date}: ${enSlug} [en] ↔ ${koSlug} [ko]`);
  } else if (enPosts.length > 1 || koPosts.length > 1) {
    // Multiple posts same day: try title similarity matching
    for (const en of enPosts) {
      for (const ko of koPosts) {
        if (!pairs.has(en.slug) && !pairs.has(ko.slug) && titlesRelated(en.title || '', ko.title || '')) {
          pairs.set(en.slug, ko.slug);
          pairs.set(ko.slug, en.slug);
          console.log(`  DateTitle ${date}: ${en.slug} ↔ ${ko.slug} (title match)`);
        }
      }
    }
  }
}

// (proximity matching removed — too many false positives)

// ── Phase 3: sanity-check and remove bad pairs ───────────────────────────────

console.log('\n--- Pair validation ---');
const badPairs = [];
for (const [slug, pairedSlug] of pairs) {
  const post = posts.get(slug);
  const paired = posts.get(pairedSlug);
  if (!post || !paired) { badPairs.push(slug); continue; }

  // Both same language = bad pair
  if (post.lang === paired.lang) {
    console.log(`  ✗ Same-lang pair: ${slug} [${post.lang}] ↔ ${pairedSlug} [${paired.lang}] — REMOVING`);
    badPairs.push(slug);
    badPairs.push(pairedSlug);
  }
}
for (const s of badPairs) pairs.delete(s);

// ── Phase 4: rewrite frontmatter ────────────────────────────────────────────

console.log('\n--- Writing updated frontmatter ---');
let updated = 0;
for (const [slug, post] of posts) {
  const newFm = { ...post.fm };
  const newLang = post.lang;
  const newPaired = pairs.get(slug) ?? '';

  const changed = newFm.lang !== newLang || (newFm.pairedSlug ?? '') !== newPaired;

  newFm.lang = newLang;
  if (newPaired) {
    newFm.pairedSlug = newPaired;
  } else {
    delete newFm.pairedSlug;
  }

  if (changed) {
    const newContent = serializeFrontmatter(newFm) + '\n\n' + post.body;
    writeFileSync(join(BLOG_DIR, post.f), newContent, 'utf8');
    console.log(`  ✓ ${slug} lang:${post.fm.lang}→${newLang} pair:${post.fm.pairedSlug ?? '∅'}→${newPaired || '∅'}`);
    updated++;
  }
}

console.log(`\n✅ Updated ${updated}/${posts.size} posts`);
console.log(`   Valid pairs: ${pairs.size / 2} EN/KO pairs`);

// Print final pairs summary
console.log('\n=== FINAL PAIRS ===');
const seen = new Set();
for (const [slug, paired] of pairs) {
  const key = [slug, paired].sort().join('<->');
  if (!seen.has(key)) {
    seen.add(key);
    console.log(`  ${slug} [${posts.get(slug).lang}] ↔ ${paired} [${posts.get(paired).lang}]`);
  }
}
