import { composePair } from '../../src/lib/newsletter.ts';
import { readFileSync } from 'node:fs';

for (const slug of ['faithfulness', '신실']) {
  try {
    const p = await composePair(slug, 'friday_new');
    const koHasHangul = /[\uac00-\ud7af]/.test(p.ko.letter.html);
    console.log(`${slug}: en=${p.en.letter.mode} ko=${p.ko.letter.mode} enSlug=${p.enSlug} koSlug=${p.koSlug} koHasHangul=${koHasHangul}`);
    console.log(`   en letter KB=${(Buffer.byteLength(p.en.letter.html) / 1024).toFixed(1)} ko KB=${(Buffer.byteLength(p.ko.letter.html) / 1024).toFixed(1)}`);
    console.log(`   like placeholder present: en=${p.en.letter.html.includes('{{LIKE}}')} ko=${p.ko.letter.html.includes('{{LIKE}}')}`);
  } catch (err) {
    console.log(`${slug}: THREW ${err instanceof Error ? err.message : err}`);
  }
}

// Is the Korean Letter for that pair actually Korean in the source file?
const koFile = readFileSync('src/content/blog/신실.md', 'utf8');
const body = koFile.slice(koFile.indexOf('\n---', 3) + 4);
const hangul = (body.match(/[\uac00-\ud7af]/g) || []).length;
console.log(`신실.md body: ${body.length} chars, ${hangul} Hangul characters`);
console.log('first 160 chars:', JSON.stringify(body.slice(0, 160)));
