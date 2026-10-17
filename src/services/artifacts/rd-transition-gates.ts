/**
 * The gates `transitionRequestArtifact` applies on `rd → implemented`,
 * `rd → qa-handoff` and `rd → handed-off`: the per-file size ratchet and the
 * declared-type corroboration. Extracted so `request-artifact-service.ts`
 * (already over its cap) grows by one call instead of two blocks, and so the
 * checks run for EVERY caller — not only the CLI flag path.
 *
 * ONE ENUMERATION PER TRANSITION. At `implemented` the change set is read once
 * and shared: the type rule judges every path (deletions included, rename
 * sources included), while the size scan measures the A/M/R/untracked subset.
 * `qa-handoff` / `handed-off` run only the type rule (two git spawns); the size
 * ratchet keeps the single state it has always judged.
 */
import type { RequestType } from './artifact-prerequisites.js';
import { FileSizeViolationError } from './request-artifact-state-helpers.js';
import { readGitChangeSet, type GitChangeSet } from '../scan/file-size-baseline.js';
import { scanFileSize } from '../scan/file-size-scan.js';
import {
  corroborateDeclaredType,
  diffUnavailableVerdict,
  isToolingOnlyDeclaredType,
  type TypeCorroboration
} from '../scan/type-corroboration.js';

export type RdGatePhase = 'implemented' | 'qa-handoff' | 'handed-off';

export class TypeCorroborationViolationError extends Error {
  readonly code = 'TYPE_CORROBORATION_VIOLATION';
  readonly declaredType: RequestType;
  readonly kind: 'source-touched' | 'diff-unavailable';
  constructor(declaredType: RequestType, verdict: Extract<TypeCorroboration, { ok: false }>) {
    super(verdict.message);
    this.name = 'TypeCorroborationViolationError';
    this.declaredType = declaredType;
    this.kind = verdict.kind;
  }
}

/** Written into the artifact when `--allow-incomplete` skips a gate that COULD
 *  have judged this type: a silent bypass is indistinguishable from a pass. */
export function rdGatesBypassNote(phase: RdGatePhase): string {
  const gates =
    phase === 'implemented'
      ? 'file-size ratchet, declared-type corroboration'
      : 'declared-type corroboration';
  return (
    `bypassed the rd ${phase} gates (${gates}) via --allow-incomplete; ` +
    'none of them was evaluated'
  );
}

/** The shared read, or the fail-closed verdict built from the same message. */
function readOrRefuse(projectRoot: string, declaredType: RequestType): GitChangeSet {
  try {
    return readGitChangeSet(projectRoot, 'HEAD');
  } catch {
    throw new TypeCorroborationViolationError(declaredType, diffUnavailableVerdict(declaredType));
  }
}

export function runRdTransitionGates(options: {
  projectRoot: string;
  declaredType: RequestType;
  allowIncomplete: boolean;
  phase: RdGatePhase;
}): string | null {
  const judged = isToolingOnlyDeclaredType(options.declaredType);
  if (options.allowIncomplete) return judged ? rdGatesBypassNote(options.phase) : null;
  if (!judged) {
    // The size ratchet still runs at implemented; the type rule is a no-op here.
    if (options.phase === 'implemented') {
      const size = scanFileSize({ projectRoot: options.projectRoot });
      if (!size.ok) throw new FileSizeViolationError(size.violations);
    }
    return null;
  }
  if (options.phase !== 'implemented') {
    const verdict = corroborateDeclaredType({
      projectRoot: options.projectRoot,
      declaredType: options.declaredType
    });
    if (!verdict.ok) throw new TypeCorroborationViolationError(options.declaredType, verdict);
    return null;
  }
  const changeSet = readOrRefuse(options.projectRoot, options.declaredType);
  const verdict = corroborateDeclaredType({
    projectRoot: options.projectRoot,
    declaredType: options.declaredType,
    changedPaths: changeSet.changedPaths
  });
  if (!verdict.ok) throw new TypeCorroborationViolationError(options.declaredType, verdict);
  const size = scanFileSize({
    projectRoot: options.projectRoot,
    changedFiles: changeSet.changedFiles
  });
  if (!size.ok) throw new FileSizeViolationError(size.violations);
  return null;
}
