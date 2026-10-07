#!/usr/bin/env node
//
// The canonical store's FILE-shaped entry point — one `.md` asset per entry, not a
// tree. `canonical-store.mjs` owns the copy and the link for DIRECTORY assets
// (skills, linked with a junction); this module owns them for `agents` and
// `output-styles`, where the entry is a single file and the only link Windows will
// take is a FILE SYMLINK, which needs developer mode or Administrator.
//
// WHY IT IS A SEPARATE MODULE — three behaviours with no counterpart in the
// directory case, each one a place the slice could have gone silently wrong:
//
//   1. THE FALLBACK IS REPORTED. When the symlink is refused the entry is written as
//      a REAL COPY — today's behaviour, reused — and the return value says
//      `fallback: { mode: 'copy', … }`. A degradation that carries no reason is
//      indistinguishable from a success; that lesson is already paid for here.
//
//   2. OWNERSHIP BY PROVENANCE, NOT BY STRING EQUALITY. The pre-canonical-store
//      installer sidecarred `resolve(recorded) === resolve(sourcePath)` against the
//      PACKAGE path of the installing version — measured on a real machine, a path
//      with a NODE VERSION inside it (`…\nvm\v24.21.0\node_modules\…`). See
//      `isOwnedLegacyEntry` for what replaced it, and why both of its arms matter.
//
//   3. A COPY MUST NOT FREEZE. The fallback copy is detected as ours and kept
//      byte-equal to the canonical copy on every run, so a refusal still propagates
//      upgrades. It does NOT retry the symlink: a retry deletes and rebuilds the file
//      each run, which breaks the installer's mtime idempotence assertion.

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';

import {
  MANAGED_MARKER_SUFFIX,
  ensureCanonicalCopy,
  linkResolvesTo,
  readManagedTarget,
  writeManagedMarker
} from './canonical-store.mjs';

/** Codes that mean "this host refused to create the link", not "the link is wrong". */
const LINK_REFUSED_CODES = new Set(['EPERM', 'EACCES', 'UNKNOWN', 'ENOTSUP', 'EINVAL']);

/** The `kind` each family wrote into its pre-canonical-store JSON sidecar. */
const LEGACY_MARKER_KIND = Object.freeze({ agents: 'agent', 'output-styles': 'output-style' });

/** Scratch prefix for the atomic copy; never a valid asset name (assets start with a letter). */
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

/** The resolved, case-folded identity of a path, or null when it does not resolve. */
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

/** Does the recorded provenance TEXT name the canonical entry? Realpath on both sides. */
function provenanceNamesCanonicalPath(recorded, canonicalPath) {
  if (typeof recorded !== 'string' || recorded.length === 0) return false;
  const recordedIdentity = resolveIdentity(recorded);
  const canonicalIdentity = resolveIdentity(canonicalPath);
  return recordedIdentity !== null && recordedIdentity === canonicalIdentity;
}

/**
 * The sidecar shape written before the canonical store existed: JSON naming the
 * package path the file was copied from, plus a content hash. Parsed, never trusted.
 */
function parseLegacyMarker(recorded) {
  if (typeof recorded !== 'string' || !recorded.startsWith('{')) return null;
  try {
    const marker = JSON.parse(recorded);
    const assetName = marker?.agentName ?? marker?.outputStyleName;
    if (marker?.version !== 1 || typeof marker.kind !== 'string') return null;
    if (typeof assetName !== 'string' || typeof marker.sourcePath !== 'string') return null;
    return { kind: marker.kind, assetName, sourcePath: marker.sourcePath };
  } catch {
    return null;
  }
}

/** A link is ours when it points at the canonical copy, or when it points at nothing. */
function isOwnedLink(entryPath, canonicalPath, recorded) {
  if (linkResolvesTo(entryPath, canonicalPath)) return true;
  if (!existsSync(entryPath)) return true;
  return recorded !== null && linkResolvesTo(entryPath, recorded);
}

/**
 * The LEGACY arm of the ownership test, and the fix for the freeze this slice exists
 * to close. A recorded package path is a version-scoped fact, so it can only be
 * describing one of two things, and BOTH of them are ours:
 *
 *   a recorded path that NO LONGER RESOLVES  — an earlier peaks-loop install, whose
 *       package has since been replaced or removed. This is the arm the old code
 *       lacked entirely: it demanded string equality with the path of the version
 *       installing RIGHT NOW, so from the first `npm i -g peaks-loop@latest` onward
 *       the comparison was false and stayed false, freezing the agent with no error.
 *   a recorded path that IS the package we are installing from — the in-place upgrade
 *       (`npm i -g` replacing the same directory). Here the old string comparison was
 *       TRUE, but the code still skipped: it only reached the rewrite branch when the
 *       content hash MATCHED (`getManagedPeaksAgentIdentity` returns null on any hash
 *       difference), so it rewrote identical bytes and skipped every real upgrade —
 *       the opposite of the "SHA differs → overwrite" its own comment promised.
 *
 * A recorded path that resolves to some OTHER live package stays untouched: that is a
 * second installation, not a stale one, and taking it over would be a regression.
 * Compared through `resolveIdentity` — realpath, `\\?\` stripped, case-folded — never
 * by string: two spellings of the same path are one path, and the s2 slice already paid
 * for that lesson.
 */
function isOwnedLegacyEntry({ kind, name, legacy, sourcePath }) {
  if (legacy === null) return false;
  if (legacy.kind !== LEGACY_MARKER_KIND[kind]) return false;
  if (legacy.assetName !== name) return false;
  const recordedIdentity = resolveIdentity(legacy.sourcePath);
  if (recordedIdentity === null) return true;
  return recordedIdentity === resolveIdentity(sourcePath);
}

/**
 * May peaks-loop replace or delete `entryPath`? A real directory, a foreign link and a
 * file with no sidecar are all "no".
 *
 *   A LINK — ours when it resolves to the canonical copy, when it DANGLES (a link whose
 *            target is gone is still a link we wrote), or when the sidecar's recorded
 *            path is what it resolves to. Identity is `realpath`, never the string:
 *            `\\?\` prefixes and case spellings differ from call to call.
 *   A FILE — ours when the sidecar beside it says so: either it names the canonical
 *            path (what this module writes), or it is the legacy shape above.
 */
function isOwnedFileEntry({ entryPath, canonicalPath, kind, name, sourcePath, recorded }) {
  const stats = getPathStats(entryPath);
  if (!stats) return false;
  if (stats.isSymbolicLink()) return isOwnedLink(entryPath, canonicalPath, recorded);
  if (recorded === null) return false;
  if (provenanceNamesCanonicalPath(recorded, canonicalPath)) return true;
  return isOwnedLegacyEntry({ kind, name, legacy: parseLegacyMarker(recorded), sourcePath });
}

/** True when `entryPath` already holds exactly the bytes the canonical copy holds. */
function holdsCanonicalBytes(entryPath, canonicalPath) {
  try {
    return readFileSync(entryPath).equals(readFileSync(canonicalPath));
  } catch {
    return false;
  }
}

/**
 * What is at the entry path right now, as one of four verdicts the caller acts on:
 * `absent` (write a link or the fallback copy), `foreign` (leave it alone), `copy` (a
 * real copy WE wrote on a host that refused a link, already current) or `ours` (ours,
 * but not the link we want — replace it). `stats` tells "link" from "repair".
 */
function existingEntryVerdict({ entryPath, canonicalPath, kind, name, sourcePath }) {
  const stats = getPathStats(entryPath);
  if (stats === null) return { stats: null, verdict: 'absent' };
  const recorded = readManagedTarget(entryPath);
  if (!isOwnedFileEntry({ entryPath, canonicalPath, kind, name, sourcePath, recorded })) {
    return { stats, verdict: 'foreign' };
  }
  const settled =
    !stats.isSymbolicLink() &&
    provenanceNamesCanonicalPath(recorded, canonicalPath) &&
    holdsCanonicalBytes(entryPath, canonicalPath);
  return { stats, verdict: settled ? 'copy' : 'ours' };
}

/** Write the canonical bytes beside the entry and swap them in, so no reader sees half. */
function writeRealCopy(canonicalPath, entryPath) {
  mkdirSync(dirname(entryPath), { recursive: true });
  const tempPath = `${entryPath}${TEMP_PREFIX}${randomUUID()}`;
  writeFileSync(tempPath, readFileSync(canonicalPath));
  renameSync(tempPath, entryPath);
}

/** A settled fallback copy: nothing to fix, but the degradation must still be visible. */
function settledCopyResult({ copied, entryPath }) {
  return {
    ...copied,
    linkAction: 'copied',
    fallback: {
      mode: 'copy',
      code: null,
      reason: `${entryPath} is a real copy: this host refused the symlink on an earlier run`
    }
  };
}

/**
 * Replace whatever is at the entry path with a link to `copied.canonicalPath` — or,
 * when this host refuses the link, with a real copy plus a reported reason.
 */
function linkOrCopyEntry({ copied, linkPath, current, createFileLink }) {
  if (current !== null) {
    unlinkSync(linkPath);
    const markerPath = `${linkPath}${MANAGED_MARKER_SUFFIX}`;
    if (existsSync(markerPath)) unlinkSync(markerPath);
  }
  mkdirSync(dirname(linkPath), { recursive: true });
  try {
    createFileLink(copied.canonicalPath, linkPath, 'file');
    writeManagedMarker(linkPath, copied.canonicalPath);
    return { ...copied, linkAction: current === null ? 'linked' : 'repaired', fallback: null };
  } catch (error) {
    const code = error?.code;
    if (!LINK_REFUSED_CODES.has(code)) throw error;
    writeRealCopy(copied.canonicalPath, linkPath);
    // Provenance records the CANONICAL path even here, so a later run recognises the
    // copy as ours and keeps it current instead of reading it as user-authored.
    writeManagedMarker(linkPath, copied.canonicalPath);
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...copied,
      linkAction: 'copied',
      fallback: {
        mode: 'copy',
        code: code ?? null,
        reason: `${linkPath} could not be linked: ${message}`
      }
    };
  }
}

/**
 * Store one single-file asset canonically, then point the IDE entry at that copy —
 * a symlink when the host allows one, a real copy when it does not.
 *
 * @param {{
 *   kind: 'agents' | 'output-styles',
 *   name: string,
 *   sourcePath: string,
 *   linkPath?: string,
 *   createFileLink?: (target: string, path: string, type: string) => void
 * }} options
 *   `createFileLink` exists so the refused-symlink arm can be MEASURED on a host where
 *   symlinks are permitted (this one). Without it the fallback branch would be
 *   unreachable in the test suite, and an unverified branch is an unverified claim.
 *   Defaults to `fs.symlinkSync`.
 */
export function reconcileCanonicalFileEntry(options) {
  const { kind, name, sourcePath, linkPath } = options;
  const copied = ensureCanonicalCopy({ kind, name, sourcePath });
  const skipped = { ...copied, linkAction: 'skipped', fallback: null };
  if (copied.action === 'unmanaged') return skipped;
  if (typeof linkPath !== 'string' || linkPath.length === 0) return skipped;
  if (linkResolvesTo(linkPath, copied.canonicalPath)) {
    return { ...copied, linkAction: 'unchanged', fallback: null };
  }
  const entry = existingEntryVerdict({
    entryPath: linkPath,
    canonicalPath: copied.canonicalPath,
    kind,
    name,
    sourcePath
  });
  if (entry.verdict === 'foreign') return skipped;
  if (entry.verdict === 'copy') return settledCopyResult({ copied, entryPath: linkPath });
  return linkOrCopyEntry({
    copied,
    linkPath,
    current: entry.stats,
    createFileLink: options.createFileLink ?? symlinkSync
  });
}
