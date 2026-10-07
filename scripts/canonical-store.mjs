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
// `scripts/install-skills.mjs` is the only caller today. Idempotence is by CONTENT —
// an asset whose bytes already match is not rewritten — and OWNERSHIP is by MARKER:
// see `isManagedEntry`, which gates the replace path here and the delete path in
// `scripts/canonical-store-prune.mjs`.

import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** The three asset families, parallel under the canonical root. */
export const CANONICAL_ASSET_KINDS = Object.freeze(['skills', 'agents', 'output-styles']);

/** Redirects the canonical root; `PEAKS_HOME` is this repo's existing name for
 *  `~/.peaks` (`src/services/sop/sop-paths.ts`). */
export const CANONICAL_ROOT_ENV = 'PEAKS_HOME';

/** Sidecar suffix, same convention `install-skills.mjs` already writes. */
export const MANAGED_MARKER_SUFFIX = '.peaks-managed';

/** Scratch prefix for the atomic write; never a valid name (assets do not start with a dot). */
const TEMP_PREFIX = '.peaks-tmp-';

function getPathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** `\\?\C:\x` and `\\?\UNC\srv\share` are spellings of a path, not other paths. */
function stripLongPathPrefix(value) {
  const uncPrefix = '\\\\?\\UNC\\';
  if (value.startsWith(uncPrefix)) return `\\\\${value.slice(uncPrefix.length)}`;
  const prefix = '\\\\?\\';
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

/**
 * The real, resolved, case-folded identity of a path, or null when it does not
 * resolve (a dangling junction included).
 */
function resolveIdentity(path) {
  let resolved;
  try {
    resolved = realpathSync(path);
  } catch {
    return null;
  }
  const normalized = stripLongPathPrefix(resolved);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/**
 * Whether `linkPath` resolves to the same directory as `expectedPath`. Both sides
 * go through `realpath`, so a `\\?\` prefix, a `.` segment or a case difference
 * cannot make one directory look like two.
 */
export function linkResolvesTo(linkPath, expectedPath) {
  const actual = resolveIdentity(linkPath);
  const expected = resolveIdentity(expectedPath);
  return actual !== null && expected !== null && actual === expected;
}

/**
 * Does peaks-loop own `targetPath`? Our `.peaks-managed` marker beside it is the
 * only proof: a path the user authored carries none and must never be replaced or
 * removed (a DANGLING link counts as ours).
 */
export function isManagedEntry(targetPath) {
  const stats = getPathStats(targetPath);
  if (!stats) return false;
  if (stats.isSymbolicLink()) return isOurLink(targetPath, stats);
  return readManagedTarget(targetPath) !== null;
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

/** A marker is a plain single-linked file — never a link, never a hardlink. */
function validateMarkerPath(markerPath) {
  const stats = getPathStats(markerPath);
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new Error('Peaks managed marker path must not be a symlink');
  if (!stats.isFile()) throw new Error('Peaks managed marker path must be a file');
  if (stats.nlink !== 1) throw new Error('Peaks managed marker path must not be hardlinked');
}

/** The `.peaks-managed` sidecar beside `targetPath`, trimmed, or null — the same
 *  convention `install-skills.mjs` writes (one line holding the producing path). */
export function readManagedTarget(targetPath) {
  const markerPath = `${targetPath}${MANAGED_MARKER_SUFFIX}`;
  validateMarkerPath(markerPath);
  if (!existsSync(markerPath)) return null;
  return readFileSync(markerPath, 'utf8').trim();
}

/** Write the sidecar through a sibling temp file, so no reader sees it half-written. */
export function writeManagedMarker(targetPath, provenance) {
  const markerPath = `${targetPath}${MANAGED_MARKER_SUFFIX}`;
  validateMarkerPath(markerPath);
  mkdirSync(dirname(markerPath), { recursive: true });
  const tempPath = `${markerPath}${TEMP_PREFIX}${randomUUID()}`;
  writeFileSync(tempPath, `${provenance}\n`, 'utf8');
  renameSync(tempPath, markerPath);
}

/** Every file and directory under `rootPath`, as sorted `/`-joined relative paths. */
function listTreeEntries(rootPath) {
  const entries = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const relativePath = prefix === '' ? name : `${prefix}/${name}`;
      const stats = lstatSync(join(dir, name));
      if (stats.isDirectory()) {
        entries.push(`${relativePath}/`);
        walk(join(dir, name), relativePath);
      } else if (stats.isFile()) {
        entries.push(relativePath);
      } else {
        throw new Error(
          `Peaks canonical store cannot read ${join(dir, name)}: not a file or directory`
        );
      }
    }
  };
  walk(rootPath, '');
  return entries;
}

/** True when `targetPath` already holds exactly the bytes `sourcePath` holds. */
function contentMatches(sourcePath, targetPath) {
  const targetStats = getPathStats(targetPath);
  if (!targetStats || targetStats.isSymbolicLink()) return false;
  if (!targetStats.isDirectory()) {
    return targetStats.isFile() && readFileSync(sourcePath).equals(readFileSync(targetPath));
  }
  const sourceEntries = listTreeEntries(sourcePath);
  const targetEntries = listTreeEntries(targetPath);
  if (sourceEntries.length !== targetEntries.length) return false;
  for (let index = 0; index < sourceEntries.length; index += 1) {
    if (sourceEntries[index] !== targetEntries[index]) return false;
    if (sourceEntries[index].endsWith('/')) continue;
    const from = join(sourcePath, sourceEntries[index]);
    const to = join(targetPath, targetEntries[index]);
    if (!readFileSync(from).equals(readFileSync(to))) return false;
  }
  return true;
}

/**
 * Materialise `sourcePath` as a REAL COPY at `<kindRoot>/<name>`: idempotent by
 * content, and REFUSING when the landing path is not ours — an existing entry with
 * no marker beside it gets `action: 'unmanaged'` instead of the `rmSync` that used
 * to run unconditionally (the `~/.peaks/agents/ecc` shape).
 *
 * @param {{ sourcePath: string, name: string, kind: string, root?: string }} options
 */
export function ensureCanonicalCopy(options) {
  const { sourcePath, name, kind } = options;
  assertAssetName(name, kind);
  const kindRoot = resolveKindRoot(kind, options);
  const canonicalPath = join(kindRoot, name);

  if (getPathStats(canonicalPath) && !isManagedEntry(canonicalPath)) {
    return { canonicalPath, action: 'unmanaged' };
  }
  if (contentMatches(sourcePath, canonicalPath)) {
    if (readManagedTarget(canonicalPath) !== sourcePath) {
      writeManagedMarker(canonicalPath, sourcePath);
    }
    return { canonicalPath, action: 'unchanged' };
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
  writeManagedMarker(canonicalPath, sourcePath);
  return { canonicalPath, action: 'installed' };
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
 * @param {{ sourcePath: string, name: string, kind: string, linkPath?: string, root?: string }} options
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

  let linkAction = 'linked';
  const current = getPathStats(linkPath);
  if (current) {
    if (!isOurLink(linkPath, current)) return { ...copied, linkAction: 'skipped' };
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
