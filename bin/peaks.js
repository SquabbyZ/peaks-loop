#!/usr/bin/env node
/**
 * peaks-loop CLI shim.
 *
 * This file used to be a bare static `import '../dist/cli/index.js'`. That
 * dies with a raw `ERR_MODULE_NOT_FOUND` stack trace — before any peaks code
 * runs — whenever the local build is stale or incomplete. The reproducible
 * trigger: `scripts/sync-version.mjs` (run by `npm run build`, `pretest`,
 * `prepublish`) unlinks `packages/peaks-loop-shared/dist/version.js`, so every
 * `node bin/peaks.js <anything>` fails with an opaque Node error until the
 * workspace packages are rebuilt.
 *
 * The guard below is the only behaviour added. The happy path is unchanged:
 * the same entry module is imported with the same `process.argv`, and the
 * CLI's own exit codes pass through untouched. Only a resolution failure
 * whose missing specifier is OURS — an internal workspace package or any
 * `dist/` artifact — is converted into an actionable message; every other
 * error is rethrown unchanged (a genuinely missing third-party dependency
 * must still surface as the raw Node error).
 */
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Workspace-internal packages whose absence always means "stale build". */
const INTERNAL_PACKAGE_NAMES = ['peaks-loop-shared', 'peaks-loop-internal-runtime'];

/**
 * The specifier Node could not resolve. Prefer the structured `err.url`
 * (a clean `file://` URL); fall back to the quoted target in the message.
 * The importer path is deliberately never parsed — `dist/cli/index.js` is
 * the importer for every error, so matching it would flag third-party
 * misses as stale-build misses.
 */
function missingSpecifier(err) {
  if (typeof err?.url === 'string' && err.url.length > 0) return err.url;
  const message = typeof err?.message === 'string' ? err.message : '';
  const pkg = /Cannot find package '([^']+)'/.exec(message);
  if (pkg !== null) return pkg[1];
  const mod = /Cannot find module '([^']+)'/.exec(message);
  if (mod !== null) return mod[1];
  return '';
}

function isInternalSpecifier(specifier) {
  const normalized = specifier.replace(/\\/g, '/');
  if (normalized.length === 0) return false;
  for (const name of INTERNAL_PACKAGE_NAMES) {
    if (
      normalized === name ||
      normalized.startsWith(`${name}/`) ||
      normalized.includes(`/${name}/`) ||
      normalized.endsWith(`/${name}`)
    ) {
      return true;
    }
  }
  return normalized.startsWith('dist/') || /\/dist\//.test(normalized);
}

try {
  await import('../dist/cli/index.js');
} catch (err) {
  const specifier = err?.code === 'ERR_MODULE_NOT_FOUND' ? missingSpecifier(err) : '';
  if (specifier.length === 0 || !isInternalSpecifier(specifier)) throw err;
  process.stderr.write(
    'peaks-loop: internal module not found — the local build is stale or incomplete.\n' +
      `  missing: ${specifier}\n` +
      `  fix:     run \`npm run build\` in ${PACKAGE_ROOT}, then retry.\n`
  );
  process.exitCode = 1;
}
