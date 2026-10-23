#!/usr/bin/env node
//
// The peaks-loop canonical asset store — `~/.peaks/{skills,agents,output-styles}` (was
// `~/.agents`; HISTORY — see `rd/evidence-root-switch.md` for why it moved).
//
// WHY. `install-skills.mjs` linked each IDE skills dir straight at
// `<packageRoot>/skills/<name>`, a path that changes on every `npm i -g
// peaks-loop@latest`: the links bound to a VERSION, not to a PATH peaks-loop owns.
//
// WIRED FOR SKILLS (slice 2) and PRUNED (slice 3); agents / output-styles are later.
// `scripts/install-skills.mjs` is the only caller today. Idempotence is by CONTENT
// AND BY VERSION — an asset whose bytes already match is not rewritten, and an
// asset made by an OLDER release is refreshed even when its bytes happen to
// match — and OWNERSHIP is by MARKER: see `isManagedEntry`, which gates the
// replace path here and the delete path in `scripts/canonical-store-prune.mjs`.
// The marker itself, its format and the version it records, live in
// `scripts/canonical-store-marker.mjs`.

import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { contentMatches, getPathStats, linkResolvesTo } from './canonical-store-fs.mjs';
import {
  LEGACY_MARKER_KIND,
  MANAGED_MARKER_SUFFIX,
  isVersionBehind,
  markerExists,
  parseLegacyMarker,
  readManagedMarker,
  readManagedTarget,
  writeManagedMarker
} from './canonical-store-marker.mjs';

// The marker API is re-exported from here so every existing importer — the
// link module, the prune module, the type declarations — keeps its one
// import site, while the format itself lives in the module that owns it.
export {
  LEGACY_MARKER_KIND,
  MANAGED_MARKER_SUFFIX,
  parseLegacyMarker,
  readManagedMarker,
  readManagedTarget,
  writeManagedMarker
};
export { linkResolvesTo };

/** The three asset families, parallel under the canonical root. */
export const CANONICAL_ASSET_KINDS = Object.freeze(['skills', 'agents', 'output-styles']);

/** Redirects the canonical root; `PEAKS_HOME` is this repo's existing name for
 *  `~/.peaks` (`src/services/sop/sop-paths.ts`). */
export const CANONICAL_ROOT_ENV = 'PEAKS_HOME';

/** Scratch prefix for the atomic write; never a valid name (assets do not start with a dot). */
const TEMP_PREFIX = '.peaks-tmp-';

/**
 * Does peaks-loop own `targetPath`? Our `.peaks-managed` marker beside it is the
 * only proof: a path the user authored carries none and must never be replaced or
 * removed (a DANGLING link counts as ours).
 *
 * The marker's PRESENCE is the proof, not its content — the content is
 * provenance, and a sidecar this build cannot parse is still a sidecar. Reading
 * the content here would make an unreadable marker indistinguishable from a
 * missing one, and the missing one is the user's.
 */
export function isManagedEntry(targetPath) {
  const stats = getPathStats(targetPath);
  if (!stats) return false;
  if (stats.isSymbolicLink()) return isOurLink(targetPath, stats);
  return markerExists(targetPath);
}

/** Reject anything that is not one plain path segment; names reach the filesystem. */
function assertAssetName(name, kind) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`Peaks canonical ${kind} name must be a single path segment`);
  }
}

/**
 * The canonical root: `options.root`, else `$PEAKS_HOME`, else `~/.peaks`.
 * @param {{ root?: string }} [options]
 */
export function resolveCanonicalRoot(options = {}) {
  const configured = options.root ?? process.env[CANONICAL_ROOT_ENV];
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return resolve(configured);
  }
  return resolve(join(homedir(), '.peaks'));
}

/**
 * One asset family's directory inside the canonical root.
 * @param {'skills' | 'agents' | 'output-styles'} kind
 * @param {{ root?: string }} [options]
 */
export function resolveKindRoot(kind, options = {}) {
  if (!CANONICAL_ASSET_KINDS.includes(kind)) {
    throw new Error(
      `Peaks canonical asset kind must be one of ${CANONICAL_ASSET_KINDS.join(', ')}`
    );
  }
  return join(resolveCanonicalRoot(options), kind);
}

/**
 * Materialise `sourcePath` as a REAL COPY at `<kindRoot>/<name>`: idempotent by
 * content AND by version, and REFUSING when the landing path is not ours — an
 * existing entry with no marker beside it gets `action: 'unmanaged'` instead of
 * the `rmSync` that used to run unconditionally (the `~/.peaks/agents/ecc`
 * shape).
 *
 * THE DECISION, in order:
 *
 *   1. the entry exists and carries NO marker → `unmanaged`. Never overwritten.
 *      This is the user's own copy, and it is the protection the whole chain
 *      rests on.
 *   2. the entry's RECORDED VERSION is behind the source package's version →
 *      refreshed, whatever the bytes say and whatever path the marker names.
 *      A copy that cannot name its version (the legacy sidecar) is "version
 *      unknown", and unknown is stale: the source package is authoritative.
 *   3. the bytes differ → refreshed.
 *   4. otherwise the copy is current. A marker whose recorded PATH no longer
 *      matches is still a stale fact about a current copy, so it is corrected
 *      — the bytes are left alone.
 *   5. an entry the store does not hold is `absent`: there is nothing to
 *      compare, so it is neither current nor stale.
 *
 * `options.version` is the version of the package that owns `skills/<name>`
 * (`package.json#version` of the install root). Without it there is nothing to
 * compare against and the decision falls back to the bytes alone.
 *
 * @param {{ sourcePath: string, name: string, kind: string, root?: string, version?: string, dryRun?: boolean }} options
 */
export function ensureCanonicalCopy(options) {
  const { sourcePath, name, kind } = options;
  const version =
    typeof options.version === 'string' && options.version.length > 0 ? options.version : null;
  const dryRun = options.dryRun === true;
  assertAssetName(name, kind);
  const kindRoot = resolveKindRoot(kind, options);
  const canonicalPath = join(kindRoot, name);

  const exists = getPathStats(canonicalPath) !== null;
  if (exists && !isManagedEntry(canonicalPath)) {
    return { canonicalPath, action: 'unmanaged', state: 'unmanaged', version: null };
  }

  const marker = readManagedMarker(canonicalPath);
  const recordedVersion = marker?.version ?? null;
  const versionStale = exists && isVersionBehind(recordedVersion, version);
  const bytesMatch = contentMatches(sourcePath, canonicalPath);

  if (exists && !versionStale && bytesMatch) {
    if (marker?.path !== sourcePath && !dryRun) {
      // The version the copy was made from is kept when the source's version is
      // unknown: a rewrite must not turn a known fact into an unknown one.
      writeManagedMarker(canonicalPath, sourcePath, version ?? recordedVersion);
    }
    return { canonicalPath, action: 'unchanged', state: 'current', version: recordedVersion };
  }

  // An entry the store does not hold is not stale — it is ABSENT. It is not
  // current either: "current" says the store holds a copy that is not behind,
  // and there is no copy to compare. An entry it holds is stale when its version
  // is behind or its bytes differ.
  const state = exists ? 'stale' : 'absent';
  const reason = versionStale ? 'version' : 'content';
  if (dryRun) {
    return {
      canonicalPath,
      action: 'planned',
      state,
      version: recordedVersion,
      reason: exists ? reason : null
    };
  }

  mkdirSync(kindRoot, { recursive: true });
  const tempPath = join(kindRoot, `${TEMP_PREFIX}${randomUUID()}`);
  try {
    cpSync(sourcePath, tempPath, { recursive: true });
    rmSync(canonicalPath, { recursive: true, force: true });
    renameSync(tempPath, canonicalPath);
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw error;
  }
  writeManagedMarker(canonicalPath, sourcePath, version);
  return {
    canonicalPath,
    action: 'installed',
    state,
    version,
    reason: exists ? reason : null
  };
}

/**
 * Is `linkPath` a link peaks-loop may replace? A link we own carries our sidecar
 * whose recorded path really is what the link resolves to; a DANGLING one counts.
 */
function isOurLink(linkPath, stats) {
  if (!stats.isSymbolicLink()) return false;
  if (!existsSync(linkPath)) return true;
  const recorded = readManagedTarget(linkPath);
  return recorded !== null && linkResolvesTo(linkPath, recorded);
}

/**
 * Point an IDE entry at the canonical copy, copying and repairing as needed. Only a
 * link peaks-loop owns is ever replaced; a real directory the user authored is left
 * alone and reported `skipped`. An `unmanaged` copy is never linked TO either.
 *
 * With `dryRun`, nothing is written: the copy is planned and the link is
 * reported `planned`, so a caller can show what a repair WOULD do before it
 * does it.
 *
 * @param {{ sourcePath: string, name: string, kind: string, linkPath?: string, root?: string, version?: string, dryRun?: boolean }} options
 */
export function reconcileCanonicalEntry(options) {
  const { linkPath } = options;
  const copied = ensureCanonicalCopy(options);
  if (copied.action === 'unmanaged') return { ...copied, linkAction: 'skipped' };
  if (typeof linkPath !== 'string' || linkPath.length === 0) {
    return { ...copied, linkAction: 'skipped' };
  }
  if (linkResolvesTo(linkPath, copied.canonicalPath)) {
    return { ...copied, linkAction: 'unchanged' };
  }

  const current = getPathStats(linkPath);
  if (current && !isOurLink(linkPath, current)) {
    return { ...copied, linkAction: 'skipped' };
  }
  if (options.dryRun === true) {
    return { ...copied, linkAction: 'planned' };
  }

  let linkAction = 'linked';
  if (current) {
    unlinkSync(linkPath);
    const markerPath = `${linkPath}${MANAGED_MARKER_SUFFIX}`;
    if (existsSync(markerPath)) unlinkSync(markerPath);
    linkAction = 'repaired';
  }

  mkdirSync(dirname(linkPath), { recursive: true });
  const linkType = lstatSync(copied.canonicalPath).isDirectory()
    ? process.platform === 'win32'
      ? 'junction'
      : 'dir'
    : 'file';
  symlinkSync(copied.canonicalPath, linkPath, linkType);
  writeManagedMarker(linkPath, copied.canonicalPath);
  return { ...copied, linkAction };
}
