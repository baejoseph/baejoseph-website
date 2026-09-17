// Test double for the Neon HTTP driver: same tagged-template shape, but the SQL
// runs on pg-mem (real Postgres semantics in-process) instead of over the wire.
import { newDb } from 'pg-mem';

const db = newDb({ autoCreateForeignKeyIndices: true });
const pg = db.adapters.createPg();
const pool = new pg.Pool();

export function neon(_url) {
  return async function sql(strings, ...values) {
    let text = '';
    const params = [];
    strings.forEach((chunk, i) => {
      text += chunk;
      if (i < values.length) {
        text += '$' + (i + 1);
        params.push(values[i]);
      }
    });
    // pg-mem can't infer types for parameters in LIMIT; inline the integers.
    text = text.replace(/limit \$(\d+)/gi, (m, n) => {
      const v = params[Number(n) - 1];
      return typeof v === 'number' ? `limit ${v}` : m;
    });
    const res = await pool.query(text, params).catch((err) => {
      // pg-mem refuses to *plan* idempotent DDL against objects that already
      // exist ("parts have not been read by the query planner"). The statement
      // is a no-op in that case, so treat it as one.
      const msg = String(err?.message || '');
      const idempotent = /^\s*(create table if not exists|create index if not exists|alter table [\s\S]+ if not exists|create unique index if not exists)/i.test(text);
      if (idempotent && msg.includes('not been read by the query planner')) return { rows: [] };
      throw err;
    });
    return res.rows;
  };
}

export const __db = db;
export const __pool = pool;
