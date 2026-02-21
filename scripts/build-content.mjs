/**
 * build-content.mjs v2
 * Fetches all posts from baejoseph.com WP REST API with _embed,
 * converts HTML→Markdown, detects EN/KO pairs, featured images,
 * saves to src/content/blog/, downloads images to public/assets/
 */

import { writeFileSync, mkdirSync, existsSync, createWriteStream } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import TurndownService from 'turndown';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BLOG_DIR = join(ROOT, 'src', 'content', 'blog');
const ASSETS_DIR = join(ROOT, 'public', 'assets');
const BASE_URL = 'https://baejoseph.com';

mkdirSync(BLOG_DIR, { recursive: true });
mkdirSync(ASSETS_DIR, { recursive: true });

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
td.addRule('bq', {
  filter: 'blockquote',
  replacement: (c) => '\n' + c.trim().split('\n').map(l => '> ' + l).join('\n') + '\n',
});
td.addRule('figure', { filter: 'figure', replacement: (c) => c });

// ── helpers ──────────────────────────────────────────────────────────────────

function decodeSlug(slug) {
  try { return decodeURIComponent(slug.replace(/\+/g, ' ')); } catch { return slug; }
}

function getFilenameFromUrl(url) {
  try { return basename(new URL(url).pathname); } catch { return url.split('/').pop(); }
}

async function downloadFile(url, dest) {
  if (existsSync(dest)) return;
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    const get = (u) => https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301, 302].includes(res.statusCode)) {
        file.close();
        return get(res.headers.location);
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { file.close(); reject(e); });
    get(url);
  });
}

async function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ data: JSON.parse(d), headers: res.headers }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchAllPosts() {
  const posts = [];
  let page = 1;
  while (true) {
    console.log(`  Fetching posts page ${page}...`);
    const url = `${BASE_URL}/wp-json/wp/v2/posts?per_page=100&page=${page}&_embed&_fields=id,slug,title,date,content,modified,featured_media,_links,_embedded`;
    const { data } = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) break;
    posts.push(...data);
    if (data.length < 100) break;
    page++;
  }
  // Also fetch pages
  console.log(`  Fetching WP pages...`);
  const { data: pages } = await fetchJson(`${BASE_URL}/wp-json/wp/v2/pages?per_page=100&_embed&_fields=id,slug,title,date,content,featured_media,_embedded`);
  if (Array.isArray(pages)) posts.push(...pages);
  console.log(`  Total entries: ${posts.length}`);
  return posts;
}

function extractImages(html) {
  const urls = new Set();
  const r = /https:\/\/baejoseph\.com\/wp-content\/uploads\/[^"'\s>]+/g;
  for (const m of html.matchAll(r)) {
    // Skip thumbnails in srcset — only main src
    if (!m[0].match(/-\d+x\d+\.(jpg|jpeg|png|webp|gif)/i)) {
      urls.add(m[0]);
    }
  }
  return [...urls];
}

function cleanHtml(html) {
  return html
    .replace(/srcset="[^"]*"/g, '')
    .replace(/sizes="[^"]*"/g, '')
    .replace(/loading="[^"]*"/g, '')
    .replace(/decoding="[^"]*"/g, '')
    .replace(/class="[^"]*"/g, '')
    .replace(/data-[^=]+="[^"]*"/g, '')
    .replace(/<figure[^>]*>/g, '')
    .replace(/<\/figure>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8230;/g, '…').replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&#8216;/g, "'").replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, '–').replace(/&#8212;/g, '—');
}

// ── Language detection ────────────────────────────────────────────────────────

const KO_RE = /[\uAC00-\uD7AF]/;
const EN_LANG_MARKERS = [
  /\[English (is|version) (?:is )?here\]/i,
  /\[English\]/i,
  /\(English (is |version )?(?:is )?(?:below|here|above)\)/i,
];
const KO_LANG_MARKERS = [
  /\[한글은.*여기\]/,
  /\[국문은.*여기\]/,
  /\[한국어.*여기\]/,
  /\[Korean.*here\]/i,
];

// ── Pair detection ────────────────────────────────────────────────────────────

function findInternalLinks(html) {
  const slugs = [];
  const r = /href="https?:\/\/baejoseph\.com\/([^/"]+)\/?"/g;
  for (const m of html.matchAll(r)) {
    const slug = m[1];
    if (!slug.startsWith('wp-') && !slug.startsWith('category/') && !slug.startsWith('tag/')) {
      slugs.push(decodeSlug(slug));
    }
  }
  return slugs;
}

// ── Split mixed-language content ──────────────────────────────────────────────

function detectMixedLanguage(html) {
  // Look for explicit language section markers in the HTML
  const text = html.replace(/<[^>]+>/g, ' ');
  
  // Pattern 1: [English is here] or similar marker at start
  const enStartMatch = text.match(/\[English(?: (?:is|version))? (?:is )?here[^\]]*\]\.?\s*/i);
  const koStartMatch = text.match(/\[한글은[^\]]*\]\.?\s*/);
  
  if (!enStartMatch && !koStartMatch) return null;
  
  // Try to find where one language section ends and another begins
  // Look for <hr> tags or ====== separators in HTML
  if (html.includes('<hr') || html.includes('* * *') || html.includes('---')) {
    return 'split-by-hr';
  }
  
  // Check if the post has both English and Korean paragraphs interspersed
  const paragraphs = html.split(/<\/p>/i).filter(p => p.trim());
  let enCount = 0, koCount = 0;
  for (const p of paragraphs) {
    const t = p.replace(/<[^>]+>/g, '');
    if (KO_RE.test(t)) koCount++;
    else if (t.trim().length > 50) enCount++;
  }
  
  if (enCount > 2 && koCount > 2) return 'interspersed';
  return null;
}

function splitByHr(html) {
  // Split at <hr> tag
  const parts = html.split(/<hr[^>]*>/i);
  if (parts.length < 2) return null;
  
  const first = parts[0];
  const second = parts.slice(1).join('<hr>');
  
  const firstIsKo = KO_RE.test(first.replace(/<[^>]+>/g, '').slice(0, 200));
  
  return firstIsKo 
    ? { koHtml: first, enHtml: second }
    : { enHtml: first, koHtml: second };
}

// ── Main processing ───────────────────────────────────────────────────────────

async function processPosts(posts) {
  // Build slug → post map for pair detection
  const slugToPost = new Map();
  for (const p of posts) {
    slugToPost.set(decodeSlug(p.slug), p);
    slugToPost.set(p.slug, p);
  }

  // Detect pairs: for each post, look at internal links
  const pairs = new Map(); // slug → paired slug (decoded)
  for (const post of posts) {
    const html = post.content?.rendered || '';
    const internalLinks = findInternalLinks(html);
    for (const linkedSlug of internalLinks) {
      const linked = slugToPost.get(linkedSlug);
      if (!linked || linked.id === post.id) continue;
      
      const postDecoded = decodeSlug(post.slug);
      const linkedDecoded = decodeSlug(linked.slug);
      
      // Pair them if they have complementary languages
      const postIsKo = KO_RE.test(post.title.rendered) || KO_RE.test(html.slice(0, 500));
      const linkedIsKo = KO_RE.test(linked.title.rendered);
      
      if (postIsKo !== linkedIsKo) {
        pairs.set(postDecoded, linkedDecoded);
        pairs.set(linkedDecoded, postDecoded);
      }
    }
  }

  console.log(`  Detected ${pairs.size / 2} EN/KO pairs`);
  return { pairs, slugToPost };
}

async function buildPost(post, pairs) {
  const rawSlug = post.slug; // WP URL-encoded slug (e.g. %ec%9a%a9%ea%b8%b0)
  const decodedSlug = decodeSlug(rawSlug); // decoded (e.g. 용기 or courage)
  
  // Filename: use decoded slug for Korean, raw slug for English
  const filename = decodedSlug;
  const filepath = join(BLOG_DIR, `${filename}.md`);

  const html = post.content?.rendered || '';
  const title = (post.title?.rendered || '')
    .replace(/&amp;/g, '&').replace(/&#8217;/g, "'").replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"').replace(/&quot;/g, '"').replace(/&#8230;/g, '…');

  const date = (post.date || '').split('T')[0];
  
  // Language detection
  const isKo = KO_RE.test(html.slice(0, 1000)) || KO_RE.test(title);
  const lang = isKo ? 'ko' : 'en';

  // Featured image
  let featuredImage = '';
  try {
    const embedded = post._embedded;
    if (embedded?.['wp:featuredmedia']?.[0]?.source_url) {
      featuredImage = embedded['wp:featuredmedia'][0].source_url;
    }
  } catch {}

  // Download featured image
  let featuredImageLocal = '';
  if (featuredImage) {
    const imgName = getFilenameFromUrl(featuredImage);
    const imgPath = join(ASSETS_DIR, imgName);
    try {
      await downloadFile(featuredImage, imgPath);
      featuredImageLocal = `/assets/${imgName}`;
    } catch (e) {
      console.warn(`    ⚠ Featured image failed: ${e.message}`);
    }
  }

  // Download body images
  const imageUrls = extractImages(html);
  const imageMap = new Map();
  for (const imgUrl of imageUrls) {
    const imgName = getFilenameFromUrl(imgUrl);
    const imgPath = join(ASSETS_DIR, imgName);
    try {
      await downloadFile(imgUrl, imgPath);
      imageMap.set(imgUrl, `/assets/${imgName}`);
    } catch {}
  }

  // Pair info
  const pairedSlug = pairs.get(decodedSlug) ?? '';

  // Convert HTML to markdown
  let cleanedHtml = cleanHtml(html);
  
  // Replace image URLs
  for (const [orig, local] of imageMap) {
    cleanedHtml = cleanedHtml.replaceAll(orig, local);
  }
  
  let bodyMd = td.turndown(cleanedHtml);

  // Clean up paired-post link markers (the "English is here" / "한글은 여기" lines)
  if (pairedSlug) {
    bodyMd = bodyMd
      .replace(/\[English(?: version)? is here\.\]/gi, '')
      .replace(/\[English is \[here\][^\]]*\]/gi, '')
      .replace(/\\\[English.*?here.*?\\\]/gi, '')
      .replace(/\[한글은 \[여기\][^\]]*\]/g, '')
      .replace(/^\s*\n/, '');
  }

  // Check for mixed language content
  const mixedType = detectMixedLanguage(html);
  let secondLang = '';
  let secondBody = '';

  if (mixedType === 'split-by-hr') {
    const split = splitByHr(html);
    if (split) {
      let splitHtml = cleanHtml(lang === 'ko' ? split.enHtml : split.koHtml);
      for (const [orig, local] of imageMap) splitHtml = splitHtml.replaceAll(orig, local);
      secondLang = lang === 'ko' ? 'en' : 'ko';
      secondBody = td.turndown(splitHtml).trim();
    }
  }

  // Build frontmatter
  const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  const fm = [
    `---`,
    `title: "${safeTitle}"`,
    `date: "${date}"`,
    `wpSlug: "${rawSlug}"`,
    `lang: "${lang}"`,
    featuredImageLocal ? `featuredImage: "${featuredImageLocal}"` : '',
    pairedSlug ? `pairedSlug: "${pairedSlug}"` : '',
    secondLang ? `secondLang: "${secondLang}"` : '',
    `---`,
  ].filter(l => l !== '').join('\n');

  let content = fm + '\n\n' + bodyMd.trim();
  
  if (secondBody) {
    content += `\n\n<!-- SECOND_LANG_START -->\n\n${secondBody}`;
  }

  writeFileSync(filepath, content, 'utf8');
  
  return { decodedSlug, lang, featuredImage: !!featuredImageLocal, imageCount: imageUrls.length, paired: !!pairedSlug, mixed: !!secondLang };
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Building baejoseph.com content (v2)...\n');
  const posts = await fetchAllPosts();
  const { pairs } = await processPosts(posts);

  let stats = { featured: 0, images: 0, paired: 0, mixed: 0, errors: 0 };

  for (const post of posts) {
    try {
      const r = await buildPost(post, pairs);
      if (r.featuredImage) stats.featured++;
      stats.images += r.imageCount;
      if (r.paired) stats.paired++;
      if (r.mixed) stats.mixed++;
      console.log(`  ✓ ${r.decodedSlug} [${r.lang}${r.paired?' ↔':''}${r.mixed?' ✂':''}${r.featuredImage?' 🖼':''}]`);
    } catch (e) {
      console.error(`  ✗ ${post.slug}: ${e.message}`);
      stats.errors++;
    }
  }

  console.log(`
✅ Done!
   Posts:          ${posts.length - stats.errors}/${posts.length}
   Featured imgs:  ${stats.featured}
   Body images:    ${stats.images}
   EN/KO pairs:    ${stats.paired} posts (${stats.paired/2} pairs)
   Mixed posts:    ${stats.mixed}
   Errors:         ${stats.errors}
`);
}

main().catch(console.error);
