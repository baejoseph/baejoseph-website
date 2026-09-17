import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE = 'bae_session';
const UI_COOKIE = 'bae_admin_ui';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secret() {
  return import.meta.env.ADMIN_SECRET || process.env.ADMIN_SECRET || '';
}

function adminPassword() {
  return import.meta.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function isConfigured() {
  return Boolean(adminPassword() && secret());
}

export function checkPassword(password: string) {
  const expected = adminPassword();
  if (!expected || !password) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mintSession() {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const nonce = randomBytes(8).toString('hex');
  const payload = `1.${exp}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export function readSession(token: string | undefined): boolean {
  if (!token || !secret()) return false;
  const parts = token.split('.');
  if (parts.length !== 4) return false;
  const payload = parts.slice(0, 3).join('.');
  const sig = parts[3];
  const expected = sign(payload);
  try {
    if (sig.length !== expected.length) return false;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  const exp = Number(parts[1]);
  return Number.isFinite(exp) && exp > Math.floor(Date.now() / 1000);
}

export function sessionFromCookieHeader(header: string | null): boolean {
  if (!header) return false;
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return readSession(m?.[1]);
}

export function isAdmin(request: Request) {
  return sessionFromCookieHeader(request.headers.get('cookie'));
}

function cookieBase() {
  const secure = true;
  return `Path=/; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function sessionSetHeaders(token: string) {
  return [
    `${COOKIE}=${token}; HttpOnly; ${cookieBase()}`,
    `${UI_COOKIE}=1; ${cookieBase()}`,
  ];
}

export function sessionClearHeaders() {
  return [
    `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`,
    `${UI_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`,
  ];
}

export function requireAdmin(request: Request): Response | null {
  if (isAdmin(request)) return null;
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
