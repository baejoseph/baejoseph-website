export function cronUnauthorized(request: Request): Response | null {
  const secret = import.meta.env.CRON_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!secret || token !== secret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
