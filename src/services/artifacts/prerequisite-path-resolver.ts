/**
 * Where a prerequisite resolves on disk: its declared path, the numbered
 * filename prefix `request init` writes, and the historical session-root tiers.
 *
 * THE ONE RESOLVER. The transition (`checkPrerequisites`) and the commit gate
 * (`checkExpiredBackCompatCommitGate`) both ask this module, so a numbered
 * prefix or a legacy root that one honours cannot be misread by the other.
 * It lives here, rather than in `artifact-prerequisites.ts`, because that file
 * is over the file-size cap and a change may only shrink it.
 */

import { join, dirname, basename } from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathExists } from 'peaks-loop-shared/fs';

import { NUMBERED_PREFIX_RE, slugifyDescription } from '../../shared/incrementing-number.js';
import type { ArtifactPrerequisite } from './artifact-prerequisites.js';

export function resolvePrerequisitePath(
  prerequisite: ArtifactPrerequisite,
  requestId: string
): string {
  return prerequisite.relativePath.replace('<rid>', requestId);
}

/** The two session-root tiers the resolver probes: the canonical session home
 *  and the pre-F3 legacy one. ONE constructor, so the transition and the commit
 *  gate cannot disagree about where a session's evidence lives. */
export type SessionRoots = { canonical: string | null; legacy: string | null };

export function sessionRootsFor(projectRoot: string, sessionId: string | undefined): SessionRoots {
  if (sessionId === undefined) return { canonical: null, legacy: null };
  return {
    canonical: join(projectRoot, '.peaks', '_runtime', sessionId),
    legacy: join(projectRoot, '.peaks', sessionId)
  };
}

/**
 * Resolve a prerequisite to an on-disk path, tolerating the numbered filename
 * prefix that `request init` writes (e.g. `001-<rid>.md`). When the prerequisite
 * path contains `<rid>`, we accept either the legacy bare `<rid>.md` form or any
 * `NNN-<rid>.md` numbered form — mirroring the matcher in request-artifact-service.
 * Returns the matched absolute path, or null when nothing matches.
 */
async function resolvePrerequisiteAbsolutePath(
  sessionRoot: string,
  prerequisite: ArtifactPrerequisite,
  requestId: string
): Promise<string | null> {
  const relative = resolvePrerequisitePath(prerequisite, requestId);
  const exact = join(sessionRoot, relative);
  if (await pathExists(exact)) {
    return exact;
  }
  // Only `<rid>`-templated prerequisites can carry a numbered prefix; fixed paths
  // (e.g. rd/tech-doc.md) are matched exactly above.
  if (!prerequisite.relativePath.includes('<rid>')) {
    return null;
  }
  const dir = dirname(exact);
  // The on-disk suffix is the SLUG of this basename — the writer lowercases the
  // rid — so a mixed-case rid used to be reported absent with the file on disk.
  const suffix = `-${slugifyDescription(basename(exact).replace(/\.md$/, ''))}.md`;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
  const match = entries.find((name) => NUMBERED_PREFIX_RE.test(name) && name.endsWith(suffix));
  return match ? join(dir, match) : null;
}

/**
 * Resolve a prerequisite to an on-disk path, with a 2-tier fallback
 * dirs are no longer created):
 *   1. `<canonicalSessionRoot>/<relative>` (post-F3 canonical session
 *      home, when `canonicalSessionRoot` is provided).
 *   2. `<legacySessionRoot>/<relative>` (pre-F3 legacy session home,
 *      when `legacySessionRoot` is provided).
 * Tolerates the numbered filename prefix that `request init` writes
 * (e.g. `001-<rid>.md`) at every tier. Returns the matched absolute
 * path, or null when nothing matches.
 *
 * Back-compat: once neither primary session-root tier resolved, the
 * resolver walks `prerequisite.legacyRelativePaths` in declared order
 * and tries each at BOTH session roots before declaring the prereq
 * missing. This covers both artifacts that moved location
 * (`rd/security-review.md` → `audit/security.md`) and ones that later
 * gained a rid in the filename (`audit/security.md` →
 */
export async function resolvePrerequisiteAbsolutePathWithFallback(
  canonicalSessionRoot: string | null,
  legacySessionRoot: string | null,
  prerequisite: ArtifactPrerequisite,
  requestId: string
): Promise<string | null> {
  const roots: Array<string | null> = [canonicalSessionRoot, legacySessionRoot];
  // First pass: try the primary relativePath at every root.
  for (const root of roots) {
    if (root === null) continue;
    const found = await resolvePrerequisiteAbsolutePath(root, prerequisite, requestId);
    if (found !== null) return found;
  }
  // Second pass: the single previous location, then any further older
  // ones, at every root — newest first, so a session that somehow holds
  // both a pre-rid and a v2.11.x file resolves to the newer shape.
  // Only the relativePath is swapped — the same numbered-prefix
  // tolerance applies via the shared resolver.
  const legacyTiers: Array<string> = [
    ...(prerequisite.legacyRelativePath !== undefined ? [prerequisite.legacyRelativePath] : []),
    ...(prerequisite.legacyRelativePaths ?? [])
  ];
  for (const legacy of legacyTiers) {
    const legacyPrereq: ArtifactPrerequisite = {
      ...prerequisite,
      relativePath: legacy
    };
    for (const root of roots) {
      if (root === null) continue;
      const found = await resolvePrerequisiteAbsolutePath(root, legacyPrereq, requestId);
      if (found !== null) return found;
    }
  }
  return null;
}
