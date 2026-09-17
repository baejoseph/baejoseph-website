/**
 * Runs the newsletter self-test.
 *
 * The test drives the real source — src/lib/* and the API route handlers — with two
 * stand-ins so it needs no network and no secrets:
 *   - pg-mem behind the Neon driver (same tagged-template shape, real SQL semantics);
 *   - a hand-rolled SMTP server that speaks just enough for nodemailer.
 *
 * esbuild bundles it because the source uses import.meta.env (Vite-only) and a bare
 * '@neondatabase/serverless' import that the shim replaces.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

const step = (label, args, opts = {}) => {
  const res = spawnSync('node', args, { stdio: 'inherit', cwd: root, ...opts });
  if (res.status !== 0) {
    console.error(`\n${label} failed`);
    process.exit(res.status ?? 1);
  }
};

// The letters under test are the ones the build ships.
step('generating email bodies', [join(root, 'scripts/build-email-posts.mjs')]);

const outfile = join(mkdtempSync(join(tmpdir(), 'selftest-')), 'bundle.mjs');
await build({
  entryPoints: [join(here, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: { '@neondatabase/serverless': join(here, 'neon-shim.mjs') },
  define: { 'import.meta.env': '{}' },
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});

step('self-test', [outfile]);
