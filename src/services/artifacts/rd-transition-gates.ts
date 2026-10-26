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
 *
 * THE TYPE RULE IS SCOPED TO THE RID — WITH AN ANTI-LIE FALLBACK. A rid
 * declares the paths it touched in its own artifact's `## Changed paths`
 * section, and the rule judges THAT set instead of the whole working tree: the
 * old judgement blamed a docs rid for another slice's `src/**` change, because
 * it read the working tree rather than the request.
 *
 * SCOPING ALONE WOULD BE AN ESCAPE HATCH ("this rid did not change it" would
 * pass anything), so the fallback runs beside it: a product-source change in the
 * working tree that NO rid claimed is still refused. The fallback only runs
 * when EVERY rid artifact in the session declares its paths — an incomplete
 * table cannot prove "nobody claimed it", and guessing there would blame one
 * slice for another's change. When it does not run, the returned note says so:
 * a silently skipped check is indistinguishable from a passing one.
 *
 * EVERY DECISION IS RECORDED. Each gate that runs emits one `gate` event
 * carrying its stable id and what it decided (`pass` / `block` / `bypass`), so
 * the layer that decides can be read back instead of inferred from the absence
 * of an error. A refusal is recorded BEFORE it is thrown.
 */
import type { RequestType } from './artifact-prerequisites.js';
import {
  FileSizeViolationError,
  type RequestArtifactState
} from './request-artifact-state-helpers.js';
import {
  readGitChangeSet,
  type ChangedFiles,
  type GitChangeSet
} from '../scan/file-size-baseline.js';
import { scanFileSize } from '../scan/file-size-scan.js';
import {
  corroborateDeclaredType,
  diffUnavailableVerdict,
  isProductSourcePath,
  isToolingOnlyDeclaredType
} from '../scan/type-corroboration.js';
import { isArtifactWorkspaceFile } from '../scan/type-sanity-service.js';
import { listSessionRdArtifactIds, readRidChangeClaims } from '../scan/rid-change-claims.js';
import { slugifyDescription } from '../../shared/incrementing-number.js';
import { normalizePath } from '../../shared/path-utils.js';
import {
  bypassedGateIds,
  gateLabel,
  rdGateRecorder,
  type RdGateRecorder
} from './rd-gate-event.js';

export type RdGatePhase = 'implemented' | 'qa-handoff' | 'handed-off';

/**
 * True for the three states the RD gates judge. A type PREDICATE, so a caller
 * that filters on it keeps the narrowed state — the old inline `||` chain did
 * the same narrowing, and losing it would make the phase un-assignable.
 */
export function isRdGatePhase(state: RequestArtifactState): state is RdGatePhase {
  return state === 'implemented' || state === 'qa-handoff' || state === 'handed-off';
}

/** The three ways the declared-type rule can refuse. */
export type RdGateViolationKind = 'source-touched' | 'source-unclaimed' | 'diff-unavailable';

export type RdGateViolation = { ok: false; kind: RdGateViolationKind; message: string };

export class TypeCorroborationViolationError extends Error {
  readonly code = 'TYPE_CORROBORATION_VIOLATION';
  readonly declaredType: RequestType;
  readonly kind: RdGateViolationKind;
  constructor(declaredType: RequestType, verdict: RdGateViolation) {
    super(verdict.message);
    this.name = 'TypeCorroborationViolationError';
    this.declaredType = declaredType;
    this.kind = verdict.kind;
  }
}

/** Written into the artifact when `--allow-incomplete` skips a gate that COULD
 *  have judged this type: a silent bypass is indistinguishable from a pass. */
export function rdGatesBypassNote(phase: RdGatePhase): string {
  const gates = bypassedGateIds(phase)
    .map((gateId) => gateLabel(gateId))
    .join(', ');
  return (
    `bypassed the rd ${phase} gates (${gates}) via --allow-incomplete; ` +
    'none of them was evaluated'
  );
}

/**
 * The gates a bypassed transition skipped, each with its own event. The note
 * names them, and a reader has to be able to ask which one was never
 * evaluated — one aggregate event per transition cannot answer that.
 */
function reportBypass(record: RdGateRecorder, phase: RdGatePhase): string {
  const note = rdGatesBypassNote(phase);
  for (const gateId of bypassedGateIds(phase)) {
    record(gateId, 'bypass', { reason: note });
  }
  return note;
}

/** The shared read, or the fail-closed verdict built from the same message. */
function readOrRefuse(
  record: RdGateRecorder,
  projectRoot: string,
  declaredType: RequestType
): GitChangeSet {
  try {
    return readGitChangeSet(projectRoot, 'HEAD');
  } catch {
    const verdict = diffUnavailableVerdict(declaredType);
    // BEFORE the throw: after it the event would never fire, and "the diff
    // could not be read" is one of the facts this stream exists to keep.
    record('claim-table', 'block', { violationKind: 'diff-unavailable', reason: verdict.message });
    throw new TypeCorroborationViolationError(declaredType, verdict);
  }
}

/** The note written when the anti-lie fallback could not run. */
function fallbackDisabledNote(sessionId: string, missing: number, total: number): string {
  return (
    `认领表不完整，反撒谎兜底未启用：session '${sessionId}' 的 ${total} 个 RD artifact 中有 ` +
    `${missing} 个未带 "## Changed paths" 段，无法证明工作树里没有无人认领的产品源文件改动 ` +
    '(the anti-lie fallback is disabled while the session claim table is incomplete).'
  );
}

/** The refusal for product-source changes that NO rid claimed. */
function unclaimedMessage(declaredType: RequestType, paths: readonly string[]): string {
  return (
    `Unclaimed product source changes cannot ride a '${declaredType}' request: ${paths.join(', ')} — ` +
    'these paths are changed in the working tree and no request artifact in this session claimed ' +
    'them in a "## Changed paths" section. A docs/chore/config request selects a reduced ' +
    'prerequisite table, so it may not carry src/** or packages/<name>/src/** changes: declare ' +
    'feature, bugfix or refactor (which carry the full QA evidence), have the owning rid claim ' +
    'the path, or move the change out of product source.'
  );
}

/** The product-source paths in the working tree that no rid claimed. */
function unclaimedSourcePaths(
  worktreePaths: readonly string[],
  claims: ReadonlyMap<string, readonly string[]>
): string[] {
  const claimed = new Set<string>();
  for (const paths of claims.values()) {
    for (const path of paths) claimed.add(normalizePath(path));
  }
  return worktreePaths.filter(
    (file) =>
      !isArtifactWorkspaceFile(file) &&
      isProductSourcePath(file) &&
      !claimed.has(normalizePath(file))
  );
}

type ScopedVerdict = { ok: true; note: string | null } | RdGateViolation;

/**
 * The declared type judged against the RID's own paths, with the anti-lie
 * fallback beside it.
 */
function judgeDeclaredType(options: {
  record: RdGateRecorder;
  projectRoot: string;
  declaredType: RequestType;
  requestId: string;
  sessionId: string;
  worktreePaths: readonly string[];
}): ScopedVerdict {
  const claims = readRidChangeClaims(options.projectRoot, options.sessionId);
  const artifactIds = listSessionRdArtifactIds(options.projectRoot, options.sessionId);
  const own = claims.get(options.requestId) ?? claims.get(slugifyDescription(options.requestId));

  // (A) The anti-lie fallback — only when EVERY rid artifact in the session
  // declares its paths. An incomplete table cannot prove "nobody claimed it".
  const missing = artifactIds.filter((rid) => !claims.has(rid));
  const tableComplete = artifactIds.length > 0 && missing.length === 0;
  let note: string | null = null;
  if (tableComplete) {
    const unclaimed = unclaimedSourcePaths(options.worktreePaths, claims);
    if (unclaimed.length > 0) {
      const message = unclaimedMessage(options.declaredType, unclaimed);
      options.record('claim-table', 'block', {
        violationKind: 'source-unclaimed',
        reason: message
      });
      return { ok: false, kind: 'source-unclaimed', message };
    }
    options.record('claim-table', 'pass');
  } else {
    note = fallbackDisabledNote(options.sessionId, missing.length, artifactIds.length);
    // The fallback STOOD DOWN — it did not pass. A bypass says so; a pass
    // would claim a check that never ran.
    options.record('claim-table', 'bypass', { reason: note });
  }

  // (B) The rid's own declaration; the whole working tree when it declared none.
  const scope = own ?? options.worktreePaths;
  const verdict = corroborateDeclaredType({
    projectRoot: options.projectRoot,
    declaredType: options.declaredType,
    changedPaths: scope
  });
  if (!verdict.ok) {
    // The refusal carries the same statement the passing note does: when the
    // anti-lie fallback stood down, a reader of the refusal alone must not be
    // left thinking it was in force.
    const message = note === null ? verdict.message : `${verdict.message} ${note}`;
    const refusal = { violationKind: verdict.kind, reason: message };
    options.record('declared-type-corroboration', 'block', refusal);
    return { ok: false, kind: verdict.kind, message };
  }
  options.record('declared-type-corroboration', 'pass');
  return { ok: true, note };
}

/**
 * The size ratchet, and the event that records what it decided. The refusal
 * is recorded BEFORE the throw — after it the event would never fire.
 */
function runSizeRatchet(
  record: RdGateRecorder,
  projectRoot: string,
  changedFiles?: ChangedFiles
): void {
  const size =
    changedFiles === undefined
      ? scanFileSize({ projectRoot })
      : scanFileSize({ projectRoot, changedFiles });
  if (!size.ok) {
    const error = new FileSizeViolationError(size.violations);
    record('file-size-ratchet', 'block', { reason: error.message });
    throw error;
  }
  record('file-size-ratchet', 'pass');
}

export function runRdTransitionGates(options: {
  projectRoot: string;
  declaredType: RequestType;
  allowIncomplete: boolean;
  phase: RdGatePhase;
  requestId: string;
  sessionId: string;
}): string | null {
  const record = rdGateRecorder({
    projectRoot: options.projectRoot,
    sessionId: options.sessionId,
    sliceRid: options.requestId,
    phase: options.phase
  });
  const judged = isToolingOnlyDeclaredType(options.declaredType);
  if (options.allowIncomplete) {
    return judged ? reportBypass(record, options.phase) : null;
  }
  if (!judged) {
    // The size ratchet still runs at implemented; the type rule is a no-op here.
    if (options.phase === 'implemented') runSizeRatchet(record, options.projectRoot);
    return null;
  }
  // ONE enumeration for the whole transition: the type rule judges the rid's own
  // paths against the same working-tree read the size ratchet measures.
  const changeSet = readOrRefuse(record, options.projectRoot, options.declaredType);
  const verdict = judgeDeclaredType({
    record,
    projectRoot: options.projectRoot,
    declaredType: options.declaredType,
    requestId: options.requestId,
    sessionId: options.sessionId,
    worktreePaths: changeSet.changedPaths
  });
  if (!verdict.ok) throw new TypeCorroborationViolationError(options.declaredType, verdict);
  if (options.phase === 'implemented') {
    runSizeRatchet(record, options.projectRoot, changeSet.changedFiles);
  }
  return verdict.note;
}
