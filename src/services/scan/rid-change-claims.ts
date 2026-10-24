/**
 * The per-rid "changed paths" claim table.
 *
 * A request artifact declares the paths its own slice touched, in a
 * machine-readable section:
 *
 * ```markdown
 * ## Changed paths
 * changedPath: src/services/skills/presence-role.ts
 * ```
 *
 * The format is line-based `key: value` because `prd/handoff-*.md` already uses
 * that shape for its own markers (`schemaVersion: 2`, `sha256:`); a
 * comma-separated list would break on a comma inside a file name.
 *
 * TWO STATES, NOT ONE. An artifact that carries the `## Changed paths` heading
 * HAS declared — an empty list is a declaration ("this slice touched nothing").
 * An artifact WITHOUT it has not, and the caller falls back to the whole
 * working tree, which is STRICTER, not looser. The heading is the switch.
 * The rid is read with the repository's own naming rule
 * (`requestIdFromFileName`), so the writer and this reader cannot drift apart.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { requestIdFromFileName } from '../../shared/incrementing-number.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { guardRuntimeSegment, runtimeRoot } from '../../shared/runtime-root.js';

/** The heading that marks an artifact as HAVING a declaration. */
const CHANGED_PATHS_HEADING_RE = /^#{1,6}\s+changed\s+paths\s*$/i;

/** One declared path per line: `changedPath: <path>`, at the start of the line. */
const CHANGED_PATH_LINE_RE = /^changedPath:\s*(\S.*?)\s*$/;

/** True when the artifact carries the `## Changed paths` heading. */
export function hasChangedPathsSection(body: string): boolean {
  return body.split(/\r?\n/).some((line) => CHANGED_PATHS_HEADING_RE.test(line.trim()));
}

/** Every `changedPath:` line of the body, in the order they were written. */
export function parseChangedPathLines(body: string): readonly string[] {
  const paths: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const declared = CHANGED_PATH_LINE_RE.exec(line)?.[1];
    if (declared !== undefined) paths.push(declared);
  }
  return paths;
}

/** The session's RD request-artifact directory, or null when the id is unusable. */
function rdRequestsDir(projectRoot: string, sessionId: string): string | null {
  const session = guardedSegmentOrNull(sessionId, 'session id');
  if (session === null) return null;
  return runtimeRoot(projectRoot).join(
    session,
    guardRuntimeSegment('rd', 'role'),
    guardRuntimeSegment('requests', 'leaf')
  );
}

/**
 * The id as a guarded segment, or `null` when it is not one: the guard THROWS
 * on an unusable id, so the predicate it applies (`isUnsafePathInput`) is asked
 * first and "unusable" is a VALUE here instead of an exception.
 */
function guardedSegmentOrNull(value: string, label: string) {
  return isUnsafePathInput(value) ? null : guardRuntimeSegment(value, label);
}

/** The artifact file names in that directory; an unreadable directory throws. */
function rdArtifactFileNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((name) => requestIdFromFileName(name) !== null);
  } catch (error) {
    throw new Error(`cannot read the RD artifact directory ${dir}: ${String(error)}`);
  }
}

/** Every rid that HAS an RD artifact in the session — declared or not. The
 * caller compares this list against the claim table to learn whether the table
 * is COMPLETE, which is what decides whether the anti-lie fallback may run.
 */
export function listSessionRdArtifactIds(
  projectRoot: string,
  sessionId: string
): readonly string[] {
  const dir = rdRequestsDir(projectRoot, sessionId);
  if (dir === null) return [];
  const ids: string[] = [];
  for (const name of rdArtifactFileNames(dir)) {
    const rid = requestIdFromFileName(name);
    if (rid !== null && rid.length > 0) ids.push(rid);
  }
  return ids;
}

/**
 * rid -> the paths it declared. ONLY artifacts carrying the `## Changed paths`
 * heading are in the table; a rid without it is NOT, and the caller reads that
 * absence as "this rid declared nothing" and falls back to the whole tree.
 */
export function readRidChangeClaims(
  projectRoot: string,
  sessionId: string
): ReadonlyMap<string, readonly string[]> {
  const dir = rdRequestsDir(projectRoot, sessionId);
  const claims = new Map<string, readonly string[]>();
  if (dir === null) return claims;
  for (const name of rdArtifactFileNames(dir)) {
    const rid = requestIdFromFileName(name);
    if (rid === null || rid.length === 0 || claims.has(rid)) continue;
    let body: string;
    try {
      body = readFileSync(join(dir, name), 'utf8');
    } catch {
      // An unreadable artifact cannot prove a declaration: leave the rid out of
      // the table, which makes the table incomplete and the fallback stand down.
      continue;
    }
    if (!hasChangedPathsSection(body)) continue;
    claims.set(rid, parseChangedPathLines(body));
  }
  return claims;
}
