/**
 * The root scratch sweep: a scratch capture must not sit at the project root.
 *
 * WHAT IT CHECKS. Two shapes, both at the TOP level of the project root:
 *
 *   - `stderr-capture` — a file whose name ends in `.err`. That is the shape a
 *     `2> name.err` redirect of a per-file test run produces, and it is the
 *     shape of the five captures that reached a repository root and were
 *     committed. A tracked file leaves `git status` clean, the file-size census
 *     does not read `.err`, and eslint does not lint it.
 *   - `zero-byte` — a file of zero bytes: a redirect that produced no output at
 *     all. `.gitkeep` is exempt, because an empty placeholder is what it is
 *     for.
 *
 * WHY IT READS THE DISK. A capture that is not tracked yet is still a capture
 * at the root, and it is exactly the one a `git status` sweep cannot see.
 *
 * WHAT IT DOES NOT SEE. A capture inside a subdirectory, and a symlink at the
 * root. The shape this sweep exists for is a regular file next to the
 * manifest.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { EnforcerFinding, RedLineAudit } from '../types.js';

/** The suffix a stderr capture carries: the `2> name.err` redirect. */
export const ROOT_SCRATCH_CAPTURE_SUFFIX = '.err';

/** Root files that are empty on purpose. */
const LEGITIMATELY_EMPTY_ROOT_FILES: ReadonlySet<string> = new Set(['.gitkeep']);

/** Which shape a root file matched. */
export type RootScratchShape = 'stderr-capture' | 'zero-byte';

/** One scratch artifact found at the project root. */
export interface RootScratchArtifact {
  /** The file name, as it sits at the root. */
  readonly name: string;
  /** The shape it matched. */
  readonly shape: RootScratchShape;
  /** The size in bytes; `0` for the zero-byte shape, `-1` when it could not be read. */
  readonly size: number;
}

/** The size of a file, or `-1` when it cannot be read. */
function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

/**
 * Every scratch artifact at the project root.
 *
 * A root that cannot be read THROWS: a sweep that cannot look must not report
 * "clean", which is the one answer it is not entitled to give.
 */
export function findRootScratchArtifacts(input: {
  readonly projectRoot: string;
}): readonly RootScratchArtifact[] {
  const artifacts: RootScratchArtifact[] = [];
  const entries = readdirSync(input.projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const size = fileSize(join(input.projectRoot, name));
    if (name.endsWith(ROOT_SCRATCH_CAPTURE_SUFFIX)) {
      artifacts.push({ name, shape: 'stderr-capture', size });
      continue;
    }
    if (LEGITIMATELY_EMPTY_ROOT_FILES.has(name)) continue;
    if (size === 0) artifacts.push({ name, shape: 'zero-byte', size });
  }
  return artifacts;
}

/** The catalog id the audit reports a root capture under. */
export const ROOT_SCRATCH_FINDING_ID = 'rl-root-scratch-artifacts-001';

/** The rule text the audit reports a root capture under. */
export const ROOT_SCRATCH_RULE = 'Root Scratch Artifacts: No Capture At The Project Root';

/**
 * The audit findings for the root sweep.
 *
 * One `fail` finding per artifact. A root that cannot be swept THROWS: the
 * audit reports a scanner failure rather than a clean sweep, because "clean"
 * is the one answer a sweep that could not look is not entitled to give.
 */
export function rootScratchFindings(input: {
  readonly projectRoot: string;
}): readonly EnforcerFinding[] {
  return findRootScratchArtifacts({ projectRoot: input.projectRoot }).map((artifact) => ({
    enforcerId: ROOT_SCRATCH_FINDING_ID,
    rule: ROOT_SCRATCH_RULE,
    severity: 'fail',
    file: artifact.name,
    detail:
      artifact.shape === 'stderr-capture'
        ? `stderr capture at the project root (${artifact.size} bytes); write scratch under the session runtime dir`
        : 'zero-byte file at the project root; write scratch under the session runtime dir'
  }));
}

/**
 * The audit envelope with the root sweep folded in.
 *
 * The sweep is merged where a command assembles its envelope, not inside
 * `runRedLinesAudit`: that module is at the repository's file-size ceiling, and
 * a line added there moves a ratcheted total UP. Both audit commands call this
 * one helper, so the two surfaces cannot drift apart.
 */
export function withRootScratchFindings(audit: RedLineAudit, projectRoot: string): RedLineAudit {
  return {
    ...audit,
    enforcerFindings: [...audit.enforcerFindings, ...rootScratchFindings({ projectRoot })]
  };
}
