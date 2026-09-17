import type { Db } from './db';
import { bodiesMissing, composeFromSlug, isFinalHtml, isFinalLetter, LETTERS_VERSION, type Slot } from './newsletter';

/**
 * Keeps queued letters in step with the letter format.
 *
 * The first version of this was a once-only migration: it ran on the first request
 * after a deploy, and if a single letter could not be composed it said nothing,
 * marked itself done, and never tried again. Joseph's queued letters sat there as
 * teasers, one of them still carrying the English body in its Korean slot.
 *
 * So now it is idempotent and boring: every queue item records the letters version
 * it was built with, and anything behind the current version is rebuilt. A letter
 * only earns the current version when it actually came out final — so a missing
 * body, an unresolvable slug or a broken language pair is retried (and reported)
 * rather than quietly left behind.
 */

export type RebuildOutcome = {
  id: number;
  slug: string;
  result: 'rebuilt' | 'skipped' | 'error';
  detail: string;
};

export type RebuildReport = {
  checked: number;
  rebuilt: number;
  skipped: number;
  failed: number;
  outcomes: RebuildOutcome[];
  bodiesMissing: boolean;
};

type QueueRow = {
  id: number;
  slug: string | null;
  slug_ko: string | null;
  slot: string;
  note: string | null;
  note_ko: string | null;
  html: string | null;
  html_ko: string | null;
  letters_version: string | null;
  status: string;
};

async function staleRows(db: Db, onlyId?: number): Promise<QueueRow[]> {
  if (onlyId) {
    return await db`
      SELECT id, slug, slug_ko, slot, note, note_ko, html, html_ko, letters_version, status
      FROM queue_items
      WHERE id = ${onlyId} AND status = 'queued'
        AND (letters_version IS NULL OR letters_version <> ${LETTERS_VERSION})
    ` as QueueRow[];
  }
  return await db`
    SELECT id, slug, slug_ko, slot, note, note_ko, html, html_ko, letters_version, status
    FROM queue_items
    WHERE status = 'queued'
      AND (letters_version IS NULL OR letters_version <> ${LETTERS_VERSION})
  ` as QueueRow[];
}

/**
 * Rebuild one queued letter from its post. Each side is looked up independently, so
 * a broken pair still repairs whichever half it can — that is what fixes a Korean
 * letter that was built from the English body.
 */
async function rebuildOne(db: Db, row: QueueRow): Promise<RebuildOutcome> {
  const kind = (row.slot === 'friday_new' ? 'friday_new' : 'tuesday_featured') as Slot;
  const label = String(row.slug || row.slug_ko || row.id);
  let en = null;
  let ko = null;

  for (const [candidate, note] of [[row.slug, row.note], [row.slug_ko, row.note_ko]] as const) {
    if (!candidate) continue;
    try {
      const composed = await composeFromSlug(String(candidate), kind, String(note ?? ''));
      if (!composed) continue;
      if (composed.lang === 'en' && !en) en = composed;
      if (composed.lang === 'ko' && !ko) ko = composed;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { id: row.id, slug: label, result: 'error', detail: `compose failed: ${detail}` };
    }
  }

  if (!en && !ko) {
    return {
      id: row.id,
      slug: label,
      result: 'skipped',
      detail: `no post found for slug "${label}" (it may have been renamed)`,
    };
  }

  // Only rewrite a side that is not already in the current format. That way a
  // hand-edited letter is never thrown away by a rebuild.
  const writes: string[] = [];
  const enStored = isFinalHtml(row.html);
  const koStored = isFinalHtml(row.html_ko);

  if (en) {
    if (enStored) {
      writes.push('en=left as is');
    } else {
      await db`
        UPDATE queue_items SET
          slug = ${en.post.slug},
          subject = ${en.letter.subject}, html = ${en.letter.html}, text_body = ${en.letter.text}
        WHERE id = ${row.id} AND status = 'queued'
      `;
      writes.push(`en=${en.letter.marker}`);
    }
  }
  if (ko) {
    if (koStored) {
      writes.push('ko=left as is');
    } else {
      await db`
        UPDATE queue_items SET
          slug_ko = ${ko.post.slug},
          subject_ko = ${ko.letter.subject}, html_ko = ${ko.letter.html}, text_body_ko = ${ko.letter.text}
        WHERE id = ${row.id} AND status = 'queued'
      `;
      writes.push(`ko=${ko.letter.marker}`);
    }
  }

  const enFinal = enStored || isFinalLetter(en?.letter);
  const koFinal = koStored || isFinalLetter(ko?.letter);
  if (enFinal && koFinal) {
    await db`UPDATE queue_items SET letters_version = ${LETTERS_VERSION} WHERE id = ${row.id}`;
    return { id: row.id, slug: label, result: 'rebuilt', detail: writes.join(' ') || 'already current' };
  }

  const missing = [
    !enFinal ? (en ? `English came out as ${en.letter.marker}` : 'no English letter') : null,
    !koFinal ? (ko ? `Korean came out as ${ko.letter.marker}` : 'no Korean letter') : null,
    bodiesMissing() ? 'email bodies are missing from the build' : null,
  ].filter(Boolean);
  return {
    id: row.id,
    slug: label,
    result: 'skipped',
    detail: `not final yet: ${missing.join('; ')}`,
  };
}

export async function rebuildQueuedLetters(db: Db, opts: { id?: number } = {}): Promise<RebuildReport> {
  const rows = await staleRows(db, opts.id);
  const outcomes: RebuildOutcome[] = [];
  for (const row of rows) {
    const outcome = await rebuildOne(db, row);
    outcomes.push(outcome);
    const log = outcome.result === 'rebuilt' ? console.log : outcome.result === 'error' ? console.error : console.warn;
    log(`[letters] ${outcome.result}: ${outcome.slug} — ${outcome.detail}`);
  }
  return {
    checked: rows.length,
    rebuilt: outcomes.filter((o) => o.result === 'rebuilt').length,
    skipped: outcomes.filter((o) => o.result === 'skipped').length,
    failed: outcomes.filter((o) => o.result === 'error').length,
    outcomes,
    bodiesMissing: bodiesMissing(),
  };
}
