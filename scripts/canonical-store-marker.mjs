#!/usr/bin/env node
//
// The `.peaks-managed` sidecar — its FORMAT, its reader, its writer, and the
// version comparison the store's staleness decision rests on.
//
// WHY IT IS ITS OWN MODULE. `canonical-store.mjs` was one line under the
// 300-line cap, and the marker grew a second fact (the version that produced
// the copy) plus a parser that must keep reading the LEGACY shape — the plain
// single-path line already sitting on every user's machine. The format is a
// CONTRACT with those machines, so the code that owns it lives in one file
// with the compatibility rules written down beside it.
//
// THE TWO FACTS. A sidecar records (1) the SOURCE PATH the copy was made from
// and (2) the PACKAGE VERSION that copy came from. The path says WHERE the
// bytes came from; the version says HOW OLD they are. The version is the fact
// that makes staleness KNOWABLE: without it a store frozen at 4.1.15 is
// indistinguishable from a store that is current, which is why a downstream
// machine sat on a stale skill for an unknown number of releases.
//
// THE FORMAT. One line of JSON:
//
//   {"format":"peaks-managed-v2","path":"<source path>","version":"<version>"}
//
// THE LEGACY FORMAT IS STILL READ. A sidecar holding a plain path — the shape
// every install before this one wrote — parses as `{path, version: null}`:
// "ours, version unknown". A reader that threw on the old format would break
// every existing install, so it does not. Only a writer that KNOWS the version
// writes the new shape; a reader never rewrites a marker it merely read.
//
// THE PATH IS NOT AUTHORITY. The recorded path is provenance, not ownership:
// ownership is decided by the PRESENCE of the sidecar, so a store entry the
// user authored (no sidecar) is still never overwritten.

import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Sidecar suffix, same convention `install-skills.mjs` already writes. */
export const MANAGED_MARKER_SUFFIX = '.peaks-managed';

/** The marker shape this module writes. A reader accepts it and the legacy one. */
export const MANAGED_MARKER_FORMAT = 'peaks-managed-v2';

/** Scratch prefix for the atomic write; never a valid asset name. */
const TEMP_PREFIX = '.peaks-tmp-';

/** How many segments a release string is compared by: MAJOR.MINOR.PATCH. */
const RELEASE_SEGMENTS = 3;

function getPathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/** A marker is a plain single-linked file — never a link, never a hardlink. */
function validateMarkerPath(markerPath) {
  const stats = getPathStats(markerPath);
  if (!stats) return;
  if (stats.isSymbolicLink()) throw new Error('Peaks managed marker path must not be a symlink');
  if (!stats.isFile()) throw new Error('Peaks managed marker path must be a file');
  if (stats.nlink !== 1) throw new Error('Peaks managed marker path must not be hardlinked');
}

/**
 * The v2 marker parsed, or null when the content is not one. A legacy plain
 * path is not JSON; a legacy JSON marker (the pre-canonical-store agent shape)
 * is JSON but does not carry this format tag, so it is not ours either.
 */
function parseVersionedMarker(content) {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.format !== MANAGED_MARKER_FORMAT) return null;
  return {
    path: typeof parsed.path === 'string' && parsed.path.length > 0 ? parsed.path : null,
    version: typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : null
  };
}

/**
 * The sidecar's two facts, or null when there is no sidecar. A LEGACY sidecar
 * (a plain path, or the pre-canonical-store JSON shape) reads as a path with
 * `version: null` — "ours, version unknown".
 *
 * @param {string} targetPath
 * @returns {{ path: string | null, version: string | null } | null}
 */
export function readManagedMarker(targetPath) {
  const markerPath = `${targetPath}${MANAGED_MARKER_SUFFIX}`;
  validateMarkerPath(markerPath);
  if (!existsSync(markerPath)) return null;
  const content = readFileSync(markerPath, 'utf8');
  const versioned = parseVersionedMarker(content);
  if (versioned !== null) return versioned;
  const legacy = content.trim();
  return { path: legacy.length > 0 ? legacy : null, version: null };
}

/**
 * The recorded path, for the callers that only need that. A v2 marker answers
 * its path; every other shape answers its content unchanged, which is what the
 * pre-canonical-store readers already expected to find.
 *
 * @param {string} targetPath
 * @returns {string | null}
 */
export function readManagedTarget(targetPath) {
  const marker = readManagedMarker(targetPath);
  if (marker === null) return null;
  return marker.path;
}

/**
 * Is there a sidecar beside this path at all? Ownership is decided by
 * PRESENCE, not by the content: a sidecar we cannot parse is still a sidecar,
 * and an empty one still marks the entry as ours.
 *
 * @param {string} targetPath
 */
export function markerExists(targetPath) {
  const markerPath = `${targetPath}${MANAGED_MARKER_SUFFIX}`;
  validateMarkerPath(markerPath);
  return existsSync(markerPath);
}

/**
 * Write the sidecar through a sibling temp file, so no reader sees it
 * half-written. With a `version`, the v2 shape is written; without one, the
 * legacy single-path line is written — the shape every caller that does not
 * know a version has always written.
 *
 * @param {string} targetPath
 * @param {string} provenance
 * @param {string} [version]
 */
export function writeManagedMarker(targetPath, provenance, version) {
  const markerPath = `${targetPath}${MANAGED_MARKER_SUFFIX}`;
  validateMarkerPath(markerPath);
  mkdirSync(dirname(markerPath), { recursive: true });
  const tempPath = `${markerPath}${TEMP_PREFIX}${randomUUID()}`;
  const body =
    typeof version === 'string' && version.length > 0
      ? `${JSON.stringify({ format: MANAGED_MARKER_FORMAT, path: provenance, version })}\n`
      : `${provenance}\n`;
  writeFileSync(tempPath, body, 'utf8');
  renameSync(tempPath, markerPath);
}

/**
 * The `kind` each family wrote into its pre-canonical-store JSON sidecar.
 */
export const LEGACY_MARKER_KIND = Object.freeze({
  agents: 'agent',
  'output-styles': 'output-style'
});

/**
 * The sidecar shape written before the canonical store existed: JSON naming the
 * package path the file was copied from, plus a content hash. Parsed, never
 * trusted — and it is a MARKER FORMAT, so it is read here, beside the format
 * this module writes.
 *
 * @param {string} recorded
 * @returns {{ kind: string, assetName: string, sourcePath: string } | null}
 */
export function parseLegacyMarker(recorded) {
  if (typeof recorded !== 'string' || !recorded.startsWith('{')) return null;
  let marker;
  try {
    marker = JSON.parse(recorded);
  } catch {
    return null;
  }
  const assetName = marker?.agentName ?? marker?.outputStyleName;
  if (marker?.version !== 1 || typeof marker.kind !== 'string') return null;
  if (typeof assetName !== 'string' || typeof marker.sourcePath !== 'string') return null;
  return { kind: marker.kind, assetName, sourcePath: marker.sourcePath };
}

/**
 * A release string's `MAJOR.MINOR.PATCH`, as three numbers. Only the leading
 * triple is read: a prerelease suffix compares as its release triple, and a
 * segment that is missing or not a number reads as 0 — which is also what
 * makes an UNREADABLE version the oldest one, and therefore stale.
 */
function releaseTriple(version) {
  const segments = String(version).replace(/^v/i, '').split('-')[0].split('.');
  const triple = [];
  for (let index = 0; index < RELEASE_SEGMENTS; index += 1) {
    const parsed = Number.parseInt(segments[index] ?? '', 10);
    triple.push(Number.isNaN(parsed) ? 0 : parsed);
  }
  return triple;
}

/**
 * Negative when `a` predates `b`, positive when it follows, 0 when their
 * release triples are equal.
 *
 * @param {string} a
 * @param {string} b
 */
export function compareVersions(a, b) {
  const left = releaseTriple(a);
  const right = releaseTriple(b);
  for (let index = 0; index < RELEASE_SEGMENTS; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Is the recorded version BEHIND the source version?
 *
 * Three answers, and the middle one is the whole point of this module:
 *   - no source version known  → false. Nothing to compare against, so the
 *     decision falls back to the bytes.
 *   - no recorded version      → TRUE. "Version unknown" is stale: the source
 *     package is authoritative, and a copy that cannot say how old it is
 *     cannot be shown to be current.
 *   - both known               → true only when the recorded one is OLDER. A
 *     copy recorded by a NEWER version is not behind, and is left alone.
 *
 * @param {string | null} recorded
 * @param {string | null} source
 */
export function isVersionBehind(recorded, source) {
  if (typeof source !== 'string' || source.length === 0) return false;
  if (typeof recorded !== 'string' || recorded.length === 0) return true;
  return compareVersions(recorded, source) < 0;
}
