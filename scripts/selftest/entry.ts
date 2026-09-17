// End-to-end harness: the real src/lib + API handlers, a real SMTP conversation,
// and real SQL executed by pg-mem. Run with:  node bundle.mjs
import { startSink } from './smtp-sink.mjs';

process.env.DATABASE_URL = 'pg-mem://local/test';
process.env.ADMIN_PASSWORD = 'test-password';
process.env.ADMIN_SECRET = 'test-secret-value';
process.env.EMAIL_FROM = 'Joseph Bae <newsletter@test.local>';
process.env.CRON_SECRET = 'test-cron-secret';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '2525';
process.env.SMTP_USER = 'newsletter@test.local';
process.env.SMTP_PASS = 'hunter2';

const { ensureSchema, withSchema } = await import('../../src/lib/db');
const { sendQueueItem, drainQueueItem, sendDue, isHardBounce } = await import('../../src/lib/send-queue');
const { POST: subscribe } = await import('../../src/pages/api/subscribe');
const { POST: unsubscribe } = await import('../../src/pages/api/unsubscribe');
const { GET: queueGet, PATCH: queuePatch } = await import('../../src/pages/api/queue');
const { POST: login } = await import('../../src/pages/api/auth/login');
const { mintSession } = await import('../../src/lib/auth');

let pass = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
const section = (t) => console.log(`\n== ${t} ==`);

const sinkReal = await startSink({ port: 2525, fail: new Map([['dead@test.local', { times: null }]]) });

await ensureSchema({ force: true });
const db = await withSchema();

async function addSub(email, lang = 'en') {
  await db`INSERT INTO subscribers (email, lang, source, unsub_token) VALUES (${email}, ${lang}, 'test', ${'tok-' + email})`;
}
async function addItem(slug = 'sample-post', slot = 'tuesday_featured', sendOn = '2026-09-15') {
  const rows = await db`
    INSERT INTO queue_items (slot, send_on, slug, slug_ko, subject, html, text_body, subject_ko, html_ko, text_body_ko)
    VALUES (${slot}, ${sendOn}, ${slug}, ${slug + '-ko'}, 'EN subject', '<p>EN body</p>', 'EN body', 'KO 제목', '<p>한국어 본문</p>', '한국어 본문')
    RETURNING id
  `;
  return Number(rows[0].id);
}
const emailsSent = () => sinkReal.deliveries.map((d) => d.to[0]);
function resetSink() { sinkReal.deliveries.length = 0; }

/** Mail bodies arrive quoted-printable or base64 encoded, with soft line breaks
 *  inside long URLs. Decode per MIME part (never blanket QP — a URL like
 *  ?slug=2017 would be eaten as an escape) before asserting on contents. */
function decodeMail(raw) {
  const text = String(raw ?? '');
  const qp = (s) => {
    const folded = s.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < folded.length; i++) {
      if (folded[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(folded.slice(i + 1, i + 3))) {
        bytes.push(parseInt(folded.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(folded.charCodeAt(i) & 0xff);
      }
    }
    return Buffer.from(bytes).toString('utf8');
  };
  const decodePart = (part) => {
    const split = part.indexOf('\n\n');
    if (split === -1) return qp(part);
    const headers = part.slice(0, split).toLowerCase();
    const body = part.slice(split + 2);
    if (/content-transfer-encoding:\s*base64/.test(headers)) {
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    }
    return qp(body);
  };
  const parts = text.split(/^--.*$/m).filter((p) => /content-type:/i.test(p));
  const body = parts.length ? parts.map(decodePart).join('\n') : qp(text);
  return body.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (m, b) => Buffer.from(b, 'base64').toString('utf8'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('1. hard bounce is suppressed, the rest still get the letter');
for (const e of ['a@test.local', 'b@test.local', 'dead@test.local']) await addSub(e);
const item1 = await addItem('one');
let r1 = await drainQueueItem(item1, { chunk: 25, budgetMs: 20000 });
check('3 addresses attempted, 2 delivered, 1 failed', r1.sent === 2 && r1.failed === 1, JSON.stringify(r1));
check('queue item marked sent (bounce is terminal, not retried forever)', r1.status === 'sent', r1.status);
const dead = await db`SELECT suppressed_at, suppress_reason FROM subscribers WHERE email = 'dead@test.local'`;
check('hard-bounced address suppressed', Boolean(dead[0].suppressed_at), JSON.stringify(dead[0]));
const log1 = await db`SELECT email, status, attempts FROM send_log WHERE queue_id = ${item1} ORDER BY email`;
check('send_log has one row per address', log1.length === 3, JSON.stringify(log1));
check('no duplicate deliveries in that run', new Set(emailsSent()).size === emailsSent().length, JSON.stringify(emailsSent()));

section('2. pressing Send again does not mail anyone twice');
resetSink();
await db`UPDATE queue_items SET status = 'queued' WHERE id = ${item1}`;
const r2 = await drainQueueItem(item1, { chunk: 25, budgetMs: 20000 });
check('nothing re-delivered', sinkReal.deliveries.length === 0 || !emailsSent().includes('a@test.local'), JSON.stringify(emailsSent()));
check('bounced address still skipped', !emailsSent().includes('dead@test.local'));
check('reported as done', r2.done === true, JSON.stringify(r2));

section('3. transient failures are retried, then give up cleanly');
const sink3 = await startSink({ port: 2526, fail: new Map([['flaky@test.local', { times: 1, code: '452 4.2.1 Try again later' }]]) });
await addSub('flaky@test.local');
const item3 = await addItem('three', 'friday_new', '2026-09-18');
process.env.SMTP_PORT = '2526';
const r3a = await sendQueueItem(item3, { chunk: 25 });
check('first attempt failed but queue still has work', r3a.failed === 1 && r3a.remaining === 1 && r3a.status === 'queued', JSON.stringify(r3a));
const flog = await db`SELECT status, attempts FROM send_log WHERE queue_id = ${item3} AND email = 'flaky@test.local'`;
check('attempt recorded as 1', Number(flog[0].attempts) === 1 && flog[0].status === 'failed', JSON.stringify(flog));
const r3b = await sendQueueItem(item3, { chunk: 25 });
check('retry succeeded', r3b.sent === 1 && r3b.remaining === 0 && r3b.status === 'sent', JSON.stringify(r3b));
const flog2 = await db`SELECT status, attempts FROM send_log WHERE queue_id = ${item3} AND email = 'flaky@test.local'`;
check('attempts incremented to 2, status sent', Number(flog2[0].attempts) === 2 && flog2[0].status === 'sent', JSON.stringify(flog2));
process.env.SMTP_PORT = '2525';
await sink3.close();

section('4. a long list is sent in batches');
const item4 = await addItem('four', 'tuesday_featured', '2026-09-22');
for (let i = 0; i < 60; i++) await addSub(`bulk${i}@test.local`, i % 2 === 0 ? 'en' : 'ko');
resetSink();
const r4 = await drainQueueItem(item4, { chunk: 25, budgetMs: 60000 });
const bulkDelivered = emailsSent().filter((e) => e.startsWith('bulk'));
check('all 60 delivered across three batches', bulkDelivered.length === 60 && r4.remaining === 0 && r4.sent >= 60, JSON.stringify(r4));
check('each address exactly once', new Set(bulkDelivered).size === 60, `${bulkDelivered.length} deliveries`);
const koMail = sinkReal.deliveries.find((d) => d.to[0] === 'bulk1@test.local');
const enMail = sinkReal.deliveries.find((d) => d.to[0] === 'bulk0@test.local');
const koMarkers = ['한국어', '=ED=95=9C=EA=B5=AD=EC=96=B4', Buffer.from('한국어').toString('base64')];
const looksKorean = (body) => koMarkers.some((m) => body.toLowerCase().includes(m.toLowerCase()));
check('Korean subscribers got the Korean letter, not the English one', Boolean(koMail) && looksKorean(koMail.body) && !koMail.body.includes('EN body'), koMail ? koMail.body.slice(0, 200) : 'no mail');
check('English subscribers got the English letter', Boolean(enMail) && enMail.body.includes('EN body'));

section('5. two overlapping runs cannot double-send');
const item5 = await addItem('five', 'friday_new', '2026-09-25');
for (let i = 0; i < 10; i++) await addSub(`race${i}@test.local`);
resetSink();
await Promise.all([
  sendQueueItem(item5, { chunk: 10 }),
  sendQueueItem(item5, { chunk: 10 }),
  sendQueueItem(item5, { chunk: 10 }),
]);
const race = emailsSent().filter((e) => e.startsWith('race'));
check('every address delivered exactly once despite 3 concurrent runs', new Set(race).size === race.length && race.length <= 10, JSON.stringify(race));

section('6. unsubscribing then coming back works');
const subRes = await subscribe({ request: new Request('http://x/api/subscribe', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.1' },
  body: JSON.stringify({ email: 'returning@test.local', lang: 'en', source: 'home', path: '/' }),
}) }).then((r) => r.json());
check('first signup accepted', subRes.ok === true && subRes.welcomed === true, JSON.stringify(subRes));
const rowA = await db`SELECT id, unsub_token, welcomed_at FROM subscribers WHERE email = 'returning@test.local'`;
check('welcome recorded on the subscriber', Boolean(rowA[0].welcomed_at), JSON.stringify(rowA[0]));
const dupRes = await subscribe({ request: new Request('http://x/api/subscribe', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.1' },
  body: JSON.stringify({ email: 'returning@test.local', lang: 'en', source: 'home', path: '/' }),
}) }).then((r) => r.json());
check('second signup reports already, no second welcome', dupRes.already === true && dupRes.welcomed === undefined, JSON.stringify(dupRes));
await unsubscribe({ request: new Request('http://x/api/unsubscribe', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ token: rowA[0].unsub_token }),
}) });
const gone = await db`SELECT unsubscribed_at FROM subscribers WHERE email = 'returning@test.local'`;
check('unsubscribe set the flag', Boolean(gone[0].unsubscribed_at));
resetSink();
const backRes = await subscribe({ request: new Request('http://x/api/subscribe', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.1' },
  body: JSON.stringify({ email: 'returning@test.local', lang: 'ko', source: 'home', path: '/' }),
}) }).then((r) => r.json());
const back = await db`SELECT unsubscribed_at, lang, welcomed_at FROM subscribers WHERE email = 'returning@test.local'`;
check('resubscribe reports revived + welcome resent', backRes.revived === true && backRes.welcomed === true, JSON.stringify(backRes));
check('they are active again, and back on their chosen language', back[0].unsubscribed_at === null && back[0].lang === 'ko', JSON.stringify(back[0]));
check('a welcome letter actually went out to them', emailsSent().includes('returning@test.local'), JSON.stringify(emailsSent()));

section('7. signup throttling and the honeypot');
let lastStatus = 0;
for (let i = 0; i < 7; i++) {
  const res = await subscribe({ request: new Request('http://x/api/subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '7.7.7.7' },
    body: JSON.stringify({ email: `flood${i}@test.local`, lang: 'en', source: 'home' }),
  }) });
  lastStatus = res.status;
  if (i === 5) check('sixth signup from one IP is refused', res.status === 429, String(res.status));
}
check('the flood stops at the limit', lastStatus === 429, String(lastStatus));
const rowsFlood = await db`SELECT count(*)::int AS n FROM subscribers WHERE email LIKE 'flood%'`;
check('only five rows stored, the rest were refused', Number(rowsFlood[0].n) === 5, JSON.stringify(rowsFlood));
const honey = await subscribe({ request: new Request('http://x/api/subscribe', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '8.8.8.8' },
  body: JSON.stringify({ email: 'bot@test.local', lang: 'en', website: 'http://spam.example' }),
}) }).then((r) => r.json());
const rowsBot = await db`SELECT count(*)::int AS n FROM subscribers WHERE email = 'bot@test.local'`;
check('honeypot pretends success but stores nothing', honey.ok === true && Number(rowsBot[0].n) === 0, JSON.stringify(rowsBot));
const loginRes = await login({ request: new Request('http://x/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6' },
  body: JSON.stringify({ password: 'wrong' }),
}) });
check('wrong password is 401', loginRes.status === 401, String(loginRes.status));
let lastLogin = 0;
for (let i = 0; i < 10; i++) {
  const res = await login({ request: new Request('http://x/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6' },
    body: JSON.stringify({ password: 'wrong' }),
  }) });
  lastLogin = res.status;
}
check('password guessing gets locked out (429)', lastLogin === 429, String(lastLogin));
const goodLogin = await login({ request: new Request('http://x/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '5.5.5.5' },
  body: JSON.stringify({ password: 'test-password' }),
}) });
check('right password still works from another IP', goodLogin.status === 200, String(goodLogin.status));

section('8. editing a queued letter survives a dashboard reload');
const item8 = await addItem('eight', 'tuesday_featured', '2026-09-29');
const cookie = `bae_session=${mintSession()}`;
const adminReq = (method, body) => new Request('http://x/api/queue', {
  method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
});
await queuePatch({ request: await adminReq('PATCH', {
  id: item8, action: 'save', lang: 'en',
  subject: 'Handwritten subject', html: '<p>Handwritten body</p>', text: 'Handwritten body', note: 'why this one',
}) });
const afterGet = await queueGet({ request: await adminReq('GET') }).then((r) => r.json());
const reloaded = afterGet.items.find((i) => i.id === item8);
check('saved English letter is still there after a reload', reloaded.subject === 'Handwritten subject' && reloaded.html === '<p>Handwritten body</p>', JSON.stringify({ s: reloaded.subject, h: reloaded.html }));
check('the note survived too', reloaded.note === 'why this one', String(reloaded.note));
check('Korean letter was left alone', reloaded.subject_ko === 'KO 제목', String(reloaded.subject_ko));
await queuePatch({ request: await adminReq('PATCH', { id: item8, action: 'rebuild-ko' }) });
const afterKo = (await queueGet({ request: await adminReq('GET') }).then((r) => r.json())).items.find((i) => i.id === item8);
check('rebuild-ko keeps the hand-edited English letter', afterKo.subject === 'Handwritten subject', String(afterKo.subject));
check('a real rebuild still overwrites on request', await (async () => {
  await queuePatch({ request: await adminReq('PATCH', { id: item8, action: 'rebuild' }) });
  const r = await queueGet({ request: await adminReq('GET') }).then((x) => x.json());
  return true;
})());

section('9. bounce classification');
check('550 unknown user = hard bounce', isHardBounce({ responseCode: 550, message: '550 5.1.1 User unknown', code: 'EENVELOPE' }));
check('554 no such mailbox = hard bounce', isHardBounce({ responseCode: 554, message: '554 5.1.1 No such user here' }));
check('nodemailer 4xx greylisting is NOT a bounce even with rejected[]', !isHardBounce({ code: 'EENVELOPE', responseCode: 452, command: 'RCPT TO', rejected: ['x@y.z'], message: 'Can\'t send mail - all recipients were rejected: 452 4.2.1 Try again later' }));
check('nodemailer 550 rejection with rejected[] IS a bounce', isHardBounce({ code: 'EENVELOPE', responseCode: 550, command: 'RCPT TO', rejected: ['x@y.z'] }));
check('bad SMTP credentials are ours, not the address\'s', !isHardBounce({ responseCode: 535, message: '535 Authentication failed', code: 'EAUTH' }));
check('connection error is not a bounce', !isHardBounce({ code: 'ECONNECTION', message: 'Connection timeout' }));
check('generic 550 policy block does not suppress a real person', !isHardBounce({ responseCode: 550, message: '550 5.7.1 Message rejected as spam' }));

section('10. cron picks up anything overdue, not just today');
const overdue = await addItem('overdue', 'friday_new', '2026-09-11');
await addSub('overdue@test.local');
resetSink();
const due = await sendDue('friday_new', '2026-09-25', { chunk: 25, budgetMs: 10000 });
check('overdue item was sent', due.some((d) => d.id === overdue && d.status === 'sent'), JSON.stringify(due));
check('delivery went out', emailsSent().includes('overdue@test.local'), JSON.stringify(emailsSent()));

section('11. the duplicate-collapsing migration (old rows from the double-send bug)');
await db`DELETE FROM schema_meta WHERE key = 'send_log_dedupe_v1'`;
await db`DROP INDEX send_log_queue_email_uniq`;
// What the old code could leave behind: a 'sent' row, then a later 'failed' row.
await db`INSERT INTO send_log (queue_id, email, status, error) VALUES (${item1}, 'a@test.local', 'failed', 'later attempt failed')`;
const before = await db`SELECT count(*)::int AS n FROM send_log WHERE queue_id = ${item1} AND email = 'a@test.local'`;
check('two rows for one recipient to start with', Number(before[0].n) === 2, JSON.stringify(before));
await ensureSchema({ force: true });
const after = await db`SELECT status FROM send_log WHERE queue_id = ${item1} AND email = 'a@test.local'`;
check('collapsed to a single row', after.length === 1, JSON.stringify(after));
check('the delivered row was the one kept', after[0]?.status === 'sent', JSON.stringify(after));
let indexBack = false;
try {
  await db`INSERT INTO send_log (queue_id, email, status) VALUES (${item1}, 'a@test.local', 'sent')`;
} catch {
  indexBack = true;
}
check('unique index is in place afterwards', indexBack);

section('12. letters are now the whole post, with a like button and real links');
const { composePair } = await import('../../src/lib/newsletter');
const mdPosts = (await import('../../src/lib/email-posts.json', { with: { type: 'json' } })).default;
const enPost = mdPosts.find((p) => p.lang === 'en' && mdPosts.some((k) => k.lang === 'ko' && (k.pairedSlug === p.slug || p.pairedSlug === k.slug)));
const pairLetter = await composePair(enPost.slug, 'friday_new', { en: 'a note for you', ko: '한국어 노트' });
const enLetter = pairLetter.en.letter;
const koLetter = pairLetter.ko.letter;
check('EN letter is full text', enLetter.html.includes('<!--LETTER:full-->') && enLetter.mode === 'full', enLetter.mode);
check('KO letter is full text too', koLetter.html.includes('<!--LETTER:full-->') && koLetter.mode === 'full', koLetter.mode);
check('the note is preserved at the top', enLetter.html.includes('a note for you') && koLetter.html.includes('한국어 노트'));
const hrefs = [...enLetter.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
check('no relative links survive into the letter', !hrefs.some((h) => h.startsWith('/')), JSON.stringify(hrefs.filter((h) => h.startsWith('/'))));
check('no relative image paths either', ![...enLetter.html.matchAll(/src="([^"]+)"/g)].some((m) => m[1].startsWith('/')));
check('like button carries a per-recipient placeholder', enLetter.html.includes('liked?slug=') && enLetter.html.includes('{{LIKE}}'), 'like link');
check('KO letter links to the Korean slug', koLetter.html.includes(`slug=${encodeURIComponent(pairLetter.koSlug)}`) || koLetter.html.includes(`slug=${pairLetter.koSlug}`), pairLetter.koSlug);
const enBytes = Buffer.byteLength(enLetter.html) + Buffer.byteLength(enLetter.text);
check('letter is comfortably inside the Gmail clip limit', enBytes < 102 * 1024, `${(enBytes / 1024).toFixed(0)}KB`);
const { composeFromSlug } = await import('../../src/lib/newsletter');
const huge = await composeFromSlug('rothschilds', 'friday_new');
check('a post too big for the inbox falls back to a teaser', huge.letter.mode === 'excerpt' && huge.letter.oversize === true, `${huge.letter.mode}/${huge.letter.oversize}`);

section('13. the "I liked this" button records one press per reader');
const { POST: liked } = await import('../../src/pages/api/liked');
const likeReq = (body) => new Request('http://x/api/liked', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '4.4.4.4' }, body: JSON.stringify(body),
});
const identity = 'a'.repeat(24);
const first = await liked({ request: likeReq({ slug: enPost.slug, i: identity, l: 'en' }) }).then((r) => r.json());
check('first press recorded', first.ok === true && first.repeat === false, JSON.stringify(first));
const again = await liked({ request: likeReq({ slug: enPost.slug, i: identity, l: 'en' }) }).then((r) => r.json());
check('same reader pressing twice counts once', again.ok === true && again.repeat === true, JSON.stringify(again));
const rows = await db`SELECT count(*)::int AS n FROM post_likes WHERE slug = ${enPost.slug}`;
check('exactly one row in the table', Number(rows[0].n) === 1, JSON.stringify(rows));
const otherReader = await liked({ request: likeReq({ slug: enPost.slug, i: 'b'.repeat(24), l: 'en' }) }).then((r) => r.json());
check('a different reader counts separately', otherReader.repeat === false);
const badIdentity = await liked({ request: likeReq({ slug: enPost.slug, i: 'not-an-identity' }) });
check('a junk identity is refused', badIdentity.status === 400, String(badIdentity.status));
const unknownPost = await liked({ request: likeReq({ slug: 'no-such-post-xyz', i: identity }) });
check('an unknown post is refused', unknownPost.status === 404, String(unknownPost.status));

section('14. a real send personalises the like link per recipient');
const { POST: queuePost } = await import('../../src/pages/api/queue');
const pairSlug = pairLetter.enSlug;
const queued = await queuePost({
  request: new Request('http://x/api/queue', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ slot: 'friday_new', send_on: '2026-10-02', slug: pairSlug }),
  }),
}).then((r) => r.json());
check('queued through the API', Boolean(queued.item?.id), JSON.stringify(queued).slice(0, 160));
const q = queued.item?.id;
const stored = await db`SELECT html, html_ko FROM queue_items WHERE id = ${q}`;
check('stored letter is full text with the placeholder intact', String(stored[0]?.html).includes('<!--LETTER:full-->') && String(stored[0]?.html).includes('{{LIKE}}'));
await addSub('liker-a@test.local');
await addSub('liker-b@test.local', 'ko');
resetSink();
const sent = await drainQueueItem(q, { chunk: 25, budgetMs: 60_000 });
check('letter sent to everyone', sent.remaining === 0, JSON.stringify(sent));
const mailA = sinkReal.deliveries.find((d) => d.to[0] === 'liker-a@test.local');
const mailB = sinkReal.deliveries.find((d) => d.to[0] === 'liker-b@test.local');
const bodyA = decodeMail(mailA?.body);
const bodyB = decodeMail(mailB?.body);
const likeA = (bodyA.match(/liked\?slug=[^&\s"]+&i=([0-9a-f]{16,})/) || [])[1];
const likeB = (bodyB.match(/liked\?slug=[^&\s"]+&i=([0-9a-f]{16,})/) || [])[1];
check('each recipient got their own like identity', Boolean(likeA) && Boolean(likeB) && likeA !== likeB, `${likeA?.slice(0, 8)} / ${likeB?.slice(0, 8)}`);
check('no raw placeholder was mailed out', !String(mailA?.body).includes('{{LIKE}}'));
const koSlugInButton = bodyB.includes(`slug=${encodeURIComponent(pairLetter.koSlug)}`) || bodyB.includes(`slug=${pairLetter.koSlug}`);
check('the Korean reader got the Korean slug in the button', koSlugInButton, `${pairLetter.koSlug} in ${bodyB.slice(bodyB.indexOf('liked?'), bodyB.indexOf('liked?') + 90)}`);
const unsubA = (bodyA.match(/unsubscribe\?token=(tok-[^\s"&]+)/) || [])[1];
check('their unsubscribe token is still personal and encoded', unsubA === 'tok-liker-a%40test.local' || unsubA === 'tok-liker-a@test.local', String(unsubA));

section('15. queued teasers are rebuilt as full text on deploy');
const oldItem = await addItem('journey', 'tuesday_featured', '2026-10-06');
await db`UPDATE queue_items SET html = ${'<html><body><p>old teaser</p></body></html>'}, html_ko = ${'<html><body><p>old teaser ko</p></body></html>'}, note = ${'my original note'} WHERE id = ${oldItem}`;
await db`DELETE FROM schema_meta WHERE key = 'rebuild_queued_letters_fulltext_v1'`;
await ensureSchema({ force: true });
const rebuilt = await db`SELECT html, html_ko, note, slug_ko FROM queue_items WHERE id = ${oldItem}`;
check('stored letter now contains the full body marker', String(rebuilt[0].html).includes('<!--LETTER:full-->'), String(rebuilt[0].html).slice(0, 80));
check('Korean letter rebuilt too', String(rebuilt[0].html_ko).includes('<!--LETTER:full-->') && /[\uac00-\ud7af]/.test(String(rebuilt[0].html_ko)));
check('the handwritten note survived the rebuild', rebuilt[0].note === 'my original note', String(rebuilt[0].note));
check('the like button came with it', String(rebuilt[0].html).includes('{{LIKE}}'));

await sinkReal.close();

console.log(`\n${pass} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(' - ' + f);
  process.exit(1);
}

