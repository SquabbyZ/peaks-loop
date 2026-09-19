// scripts/dist-freshness.mjs
//
// Is `dist/` still built from the `src/` on disk?
//
// WHY THIS EXISTS
//
// The integration suite spawns the BUILT CLI (`bin/peaks.js` -> `dist/`). That
// is a legitimate choice for a packaged-CLI end-to-end test — and it has a
// failure mode that reads as success: when `dist/` is STALE the suite passes
// against code that no longer exists. Measured 2026-09-17 on this repository:
// 18 files under `src/` were newer than every artifact in `dist/`, and the
// integration suite was green.
//
// THE COMPARISON, AND WHY IT IS THIS ONE
//
// Two candidate comparisons were on the table:
//
//   (a) MTIME — stale iff the newest `src/**/*.ts` is newer than the newest
//       `dist/**/*.js`. Cheap, needs no build change. Sound here, and the
//       soundness was MEASURED rather than assumed: `git checkout HEAD -- .`
//       does not touch the mtime of a file whose content did not change
//       (verified with a two-file probe — the edited file moved, the untouched
//       one did not), so a checkout cannot produce a false "stale"; and
//       `scripts/clean-dist.mjs` wipes `dist/` before every build, so the
//       newest dist mtime IS the build completion time. Its two residual
//       weaknesses: an explicit `touch` on a source file reads as stale, and a
//       content change that preserves mtimes is invisible.
//
//   (b) IDENTITY — a content digest of the tsc inputs, recorded at build time
//       in `dist/.dist-stamp.json`. Immune to every form of mtime churn by
//       construction, and it can also see a content change that mtime misses.
//       Its cost: it needs a build step, and a `dist/` built before the step
//       existed carries no stamp at all.
//
// This module uses IDENTITY as the authority and MTIME as the fallback for an
// unstamped tree, so that it is exact where it can be and still catches the
// real defect on a dist built before the stamp existed. The result says which
// comparison produced it, so a green is never ambiguous about what was
// actually verified.
//
// SCOPE OF THE DIGEST: `src/**/*.ts`, which is exactly `tsconfig.build.json`'s
// `include`. That is the set `tsc -p tsconfig.build.json` compiles into the
// root `dist/`, so it is the set "dist was built from" can mean. Line endings
// are normalised (CRLF -> LF) before hashing: the working tree's eol setting
// must not be able to read as a source change.
//
// Claim about the sibling axis (deliberately not covered): `packages/*/src` is
// a separate emit into `packages/*/dist`, and `scripts/sync-version.mjs`
// rewrites `packages/peaks-loop-shared/src/version.ts` on EVERY `pretest` and
// `prebuild`. An mtime rule spanning that file would fire on every test run;
// a digest rule for it is possible but is a different axis. Not attempted here.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Bumped only if the digest's input definition changes. */
export const DIST_STAMP_VERSION = 1;

/** Relative to the project root. Wiped with the rest of `dist/` by clean-dist. */
export const DIST_STAMP_RELATIVE_PATH = '.dist-stamp.json';

/** The command that makes any staleness finding go away. */
export const REBUILD_COMMAND = 'pnpm build';

const SOURCE_EXTENSION = '.ts';

function listFiles(dir, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, predicate, out);
    else if (entry.isFile() && predicate(entry.name)) out.push(full);
  }
  return out;
}

function toPosix(path) {
  return path.replace(/\\/g, '/');
}

/**
 * The digest of the tsc build inputs under `projectRoot/src`.
 *
 * Sorted by relative path so the value does not depend on directory order;
 * CRLF normalised so it does not depend on the checkout's eol setting.
 */
export function computeSourceDigest(projectRoot) {
  const srcRoot = join(projectRoot, 'src');
  const files = listFiles(srcRoot, (name) => name.endsWith(SOURCE_EXTENSION))
    .map((full) => ({ full, rel: toPosix(full.slice(srcRoot.length + 1)) }))
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const outer = createHash('sha256');
  for (const file of files) {
    const content = readFileSync(file.full, 'utf8').replace(/\r\n/g, '\n');
    const inner = createHash('sha256').update(content, 'utf8').digest('hex');
    outer.update(`${file.rel}\0${inner}\n`, 'utf8');
  }
  return { digest: outer.digest('hex'), fileCount: files.length };
}

/** Writes `dist/.dist-stamp.json`. Called by the build, after `tsc`. */
export function writeDistStamp(projectRoot) {
  const distDir = join(projectRoot, 'dist');
  const { digest, fileCount } = computeSourceDigest(projectRoot);
  const stampPath = join(distDir, DIST_STAMP_RELATIVE_PATH);
  writeFileSync(
    stampPath,
    `${JSON.stringify({ version: DIST_STAMP_VERSION, digest, fileCount, builtAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8'
  );
  return { stampPath, digest, fileCount };
}

function readStamp(projectRoot) {
  const stampPath = join(projectRoot, 'dist', DIST_STAMP_RELATIVE_PATH);
  if (!existsSync(stampPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(stampPath, 'utf8'));
    if (typeof parsed?.digest !== 'string' || parsed.digest.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Newest mtime among the built artifacts, i.e. when the build finished. */
function newestDistMtime(projectRoot) {
  const distRoot = join(projectRoot, 'dist');
  const files = listFiles(distRoot, (name) => name.endsWith('.js'));
  let newest = 0;
  for (const file of files) {
    const stat = statSync(file);
    if (stat.mtimeMs > newest) newest = stat.mtimeMs;
  }
  return { newest, fileCount: files.length };
}

/** Source files newer than the build, by mtime. The fallback comparison. */
function sourcesNewerThan(projectRoot, cutoffMs) {
  const srcRoot = join(projectRoot, 'src');
  const newer = [];
  for (const file of listFiles(srcRoot, (name) => name.endsWith(SOURCE_EXTENSION))) {
    const stat = statSync(file);
    if (stat.mtimeMs > cutoffMs)
      newer.push({ path: toPosix(file.slice(projectRoot.length + 1)), mtimeMs: stat.mtimeMs });
  }
  return newer.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * Decide whether `dist/` reflects the current `src/`.
 *
 * Returns a discriminated result rather than a boolean so the caller can say
 * WHICH comparison ran — `method: 'digest'` is exact; `method: 'mtime'` means
 * no stamp was present and the weaker rule was used. A caller that only prints
 * `ok` would throw that difference away, which is the ambiguity this whole
 * module exists to remove.
 *
 *   { state: 'no-dist' }                      nothing is built; nothing to verify
 *   { state: 'fresh',   method, ... }         dist matches src
 *   { state: 'stale',   method, ... }         dist predates src
 */
export function evaluateDistFreshness(projectRoot) {
  const root = resolve(projectRoot);
  const distDir = join(root, 'dist');
  if (!existsSync(distDir) || newestDistMtime(root).fileCount === 0) {
    return { state: 'no-dist', distDir };
  }

  const { digest, fileCount } = computeSourceDigest(root);
  const stamp = readStamp(root);

  if (stamp !== null && stamp.version === DIST_STAMP_VERSION) {
    if (stamp.digest === digest) {
      return { state: 'fresh', method: 'digest', distDir, digest, fileCount };
    }
    return {
      state: 'stale',
      method: 'digest',
      distDir,
      digest,
      fileCount,
      builtDigest: stamp.digest,
      builtAt: stamp.builtAt ?? null
    };
  }

  // No usable stamp. `dist/` was produced by something other than this build
  // pipeline, so the exact rule cannot run — fall back to mtime, which is sound
  // on this axis for the reasons in the header.
  const { newest } = newestDistMtime(root);
  const newer = sourcesNewerThan(root, newest);
  const base = { distDir, digest, fileCount, builtMtimeMs: newest, stampPresent: stamp !== null };
  if (newer.length === 0) {
    return { state: 'fresh', method: 'mtime', ...base };
  }
  return { state: 'stale', method: 'mtime', ...base, newerSources: newer };
}
