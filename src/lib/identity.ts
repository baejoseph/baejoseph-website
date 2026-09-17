import { createHmac } from 'node:crypto';

/**
 * Anonymous, per-(post, reader) identity for engagement links.
 *
 * The "I liked this" button has to know whether this is the same person pressing
 * it twice, without putting an email address — or the reader's unsubscribe token —
 * into a URL. So the identity is an HMAC of the post slug and the address: stable
 * enough to de-duplicate, opaque in the link, and the database only ever sees the
 * hash.
 */
function salt() {
  return import.meta.env.ADMIN_SECRET || process.env.ADMIN_SECRET || '';
}

export function identityHash(slug: string, email: string) {
  return createHmac('sha256', salt())
    .update(`${slug}|${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
}
