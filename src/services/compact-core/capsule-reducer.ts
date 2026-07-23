/**
 * Phase 2 Task 2.2 — deterministic bounded capsule reduction.
 *
 * `reduceCapsule` is a pure function that returns a fresh
 * `ConvergenceCapsule` whose body fits within `maxUtf8Bytes`. It is the
 * second half of the deterministic, digest-locked capsule contract
 * defined in design §7: the capsule schema + canonical digest
 * (`capsule-types.ts`, `capsule-digest.ts`) bound the payload, and the
 * reducer is what makes that binding cheap to ship across sessions by
 * shedding non-mandatory payload when the budget is tight.
 *
 * Mandatory retention (NEVER dropped):
 *   - `goal`
 *   - `mode`
 *   - `activeJob` (nullable; preserved as null when null)
 *   - `activeRequest` (nullable; preserved as null when null)
 *   - `completedGates`
 *   - blocking `openQuestions` (any `OpenQuestion` with
 *     `blocking === true`)
 *   - `activeTasks`
 *   - `nextAction`
 *
 * Drop order (mandatory, in this sequence; each step runs exactly once):
 *   1. Deduplicate `failureHistory` by `code` (keep first occurrence).
 *   2. Demote `artifactIndex` entries to bare `ArtifactPointer`
 *      (strip `kind` if present).
 *   3. Drop decisions whose `madeAt` is not the most recent among
 *      decisions with identical `id` (keep latest by `madeAt`).
 *      NOTE: the brief referred to this field as `decidedAt`; the
 *      canonical `DecisionRecord` schema uses `madeAt` (see
 *      `capsule-types.ts`). The reducer follows the schema.
 *   4. Truncate `failureHistory` to the most recent 5 entries
 *      (oldest dropped first) — ONLY if the budget is still exceeded
 *      after steps 1-3.
 *
 * If the body is still over budget after step 4, the reducer throws
 * `CapsuleBudgetExceededError` carrying the actual byte count and the
 * mandatory field count. The mandatory field count is always > 0
 * because the reducer never drops mandatory fields.
 *
 * The output capsule is always a fresh object; the input is never
 * mutated. Body bytes are computed using the same canonicalization
 * the digest uses (sorted keys, dropped `undefined`, preserved array
 * order), so byte counts and digests agree.
 *
 * Vendor-neutrality: this module imports only `node:buffer` (transitively
 * via `Buffer.byteLength`) and the local `capsule-types` /
 * `capsule-digest` modules. No host names, no binaries, no slash
 * commands, no vendor conditionals.
 */
import { canonicalize, digestCapsule } from './capsule-digest.js';
import type {
  ArtifactPointer,
  ConvergenceCapsule,
  DecisionRecord,
  FailureRecord,
  OpenQuestion
} from './capsule-types.js';

/** Error thrown when the capsule body still exceeds the budget after all 4 drop steps. */
export class CapsuleBudgetExceededError extends Error {
  /** Actual canonical body byte count after all 4 drop steps. */
  readonly actualBytes: number;
  /** Number of mandatory categories still retained (always > 0 when thrown). */
  readonly mandatoryFieldCount: number;

  constructor(actualBytes: number, mandatoryFieldCount: number) {
    super(
      `capsule body exceeds budget: ${actualBytes} bytes (mandatory fields retained = ${mandatoryFieldCount})`
    );
    this.name = 'CapsuleBudgetExceededError';
    this.actualBytes = actualBytes;
    this.mandatoryFieldCount = mandatoryFieldCount;
  }
}

/** Tail length preserved by step 4 (oldest dropped first). */
const FAILURE_HISTORY_TAIL = 5;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Remove the top-level `digest` field. Mirrors `digestCapsule`'s strip
 * step so the byte counter and the digest see the same payload.
 */
function stripTopDigest(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(payload)) {
    if (k !== 'digest') out[k] = payload[k];
  }
  return out;
}

/**
 * Canonical body byte count (UTF-8). Uses the same canonicalization
 * the digest uses — sorted keys, dropped `undefined`, preserved array
 * order — so the count agrees with what the digest hashes.
 */
export function canonicalBodyBytes(
  capsule: Record<string, unknown>
): number {
  const body = stripTopDigest(capsule);
  const canonical = canonicalize(body);
  return Buffer.byteLength(JSON.stringify(canonical), 'utf8');
}

/** Step 1: dedupe `failureHistory` by `code`, keep first occurrence. */
function dedupeFailureHistoryByCode(
  history: readonly FailureRecord[]
): FailureRecord[] {
  const seen = new Set<string>();
  const out: FailureRecord[] = [];
  for (const f of history) {
    if (seen.has(f.code)) continue;
    seen.add(f.code);
    out.push({ ...f });
  }
  return out;
}

/** Step 2: demote `artifactIndex` to bare `ArtifactPointer` (strip `kind`). */
function demoteArtifactIndex(
  index: readonly ArtifactPointer[]
): ArtifactPointer[] {
  return index.map(p => {
    const { kind: _k, ...rest } = p;
    void _k;
    return { path: rest.path, sha256: rest.sha256, summary: rest.summary };
  });
}

/**
 * Step 3: dedupe decisions by `id`, keep the latest `madeAt`.
 * Preserves first-seen order across distinct ids.
 */
function dedupeDecisionsByLatestMadeAt(
  decisions: readonly DecisionRecord[]
): DecisionRecord[] {
  const bestById = new Map<string, DecisionRecord>();
  const order: string[] = [];
  for (const d of decisions) {
    const existing = bestById.get(d.id);
    if (!existing) {
      bestById.set(d.id, { ...d });
      order.push(d.id);
    } else if (d.madeAt > existing.madeAt) {
      bestById.set(d.id, { ...d });
    }
  }
  const out: DecisionRecord[] = [];
  for (const id of order) {
    const found = bestById.get(id);
    if (found) out.push(found);
  }
  return out;
}

/** Step 4: truncate `failureHistory` to the most recent `FAILURE_HISTORY_TAIL` entries. */
function truncateFailureHistoryTail(
  history: readonly FailureRecord[]
): FailureRecord[] {
  if (history.length <= FAILURE_HISTORY_TAIL) {
    return history.map(f => ({ ...f }));
  }
  return history.slice(-FAILURE_HISTORY_TAIL).map(f => ({ ...f }));
}

/**
 * Count mandatory categories still present in the reduced body. Used
 * by `CapsuleBudgetExceededError`; always > 0 because the reducer
 * never drops mandatory fields.
 */
function countMandatoryCategories(capsule: {
  readonly goal: ConvergenceCapsule['goal'];
  readonly mode: ConvergenceCapsule['mode'];
  readonly activeJob: ConvergenceCapsule['activeJob'];
  readonly activeRequest: ConvergenceCapsule['activeRequest'];
  readonly completedGates: readonly ConvergenceCapsule['completedGates'][number][];
  readonly activeTasks: readonly ConvergenceCapsule['activeTasks'][number][];
  readonly openQuestions: readonly OpenQuestion[];
  readonly nextAction: ConvergenceCapsule['nextAction'];
}): number {
  let n = 0;
  if (capsule.goal) n++;
  if (capsule.mode) n++;
  if (capsule.activeJob !== null && capsule.activeJob !== undefined) n++;
  if (capsule.activeRequest !== null && capsule.activeRequest !== undefined) n++;
  if (capsule.completedGates.length > 0) n++;
  if (capsule.activeTasks.length > 0) n++;
  if (capsule.openQuestions.some(q => q.blocking)) n++;
  if (capsule.nextAction) n++;
  return n;
}

/** Build a fresh body object from the reducer's intermediate state. */
function buildBody(input: ConvergenceCapsule, state: {
  failureHistory: FailureRecord[];
  artifactIndex: ArtifactPointer[];
  decisions: DecisionRecord[];
  openQuestions: OpenQuestion[];
}): Omit<ConvergenceCapsule, 'digest'> {
  return {
    schemaVersion: input.schemaVersion,
    capsuleId: input.capsuleId,
    compactAttemptId: input.compactAttemptId,
    sourceSessionId: input.sourceSessionId,
    goal: { ...input.goal },
    mode: input.mode,
    activeJob: input.activeJob ? { ...input.activeJob } : null,
    activeRequest: input.activeRequest ? { ...input.activeRequest } : null,
    completedGates: input.completedGates.map(g => ({ ...g })),
    activeTasks: input.activeTasks.map(t => ({ ...t })),
    decisions: state.decisions,
    openQuestions: state.openQuestions,
    failureHistory: state.failureHistory,
    artifactIndex: state.artifactIndex,
    nextAction: { ...input.nextAction },
    idempotency: { scope: input.idempotency.scope, sealedKeys: [...input.idempotency.sealedKeys] },
    sourceContextMeasurement: { ...input.sourceContextMeasurement }
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Reduce a `ConvergenceCapsule` to a fresh capsule whose canonical
 * body (excluding `digest`) fits within `maxUtf8Bytes`.
 *
 * Steps 1-3 always run; step 4 runs only if the budget is still
 * exceeded afterwards. If step 4 does not bring the body under
 * budget, the function throws `CapsuleBudgetExceededError`.
 *
 * The input is never mutated; the returned capsule is always a fresh
 * object with a re-digested `digest` field that reflects the reduced
 * body.
 */
export function reduceCapsule(
  input: ConvergenceCapsule,
  maxUtf8Bytes: number
): ConvergenceCapsule {
  if (!Number.isFinite(maxUtf8Bytes) || maxUtf8Bytes < 0) {
    throw new RangeError(
      `maxUtf8Bytes must be a non-negative finite number, got ${maxUtf8Bytes}`
    );
  }

  // Steps 1-3 always run (each step runs once, no re-loops).
  const failureHistory = dedupeFailureHistoryByCode(input.failureHistory);
  const artifactIndex = demoteArtifactIndex(input.artifactIndex);
  const decisions = dedupeDecisionsByLatestMadeAt(input.decisions);

  // Open questions are never targeted by any drop step; preserve them
  // verbatim (blocking ones are mandatory, non-blocking ones are
  // preserved because no step removes them). Deep-clone to avoid
  // sharing references with the input.
  const openQuestions: OpenQuestion[] = input.openQuestions.map(q => ({ ...q }));

  // Body candidate after steps 1-3.
  let body = buildBody(input, { failureHistory, artifactIndex, decisions, openQuestions });
  let actualBytes = canonicalBodyBytes(body as unknown as Record<string, unknown>);

  if (actualBytes <= maxUtf8Bytes) {
    const digest = digestCapsule(body);
    return { ...body, digest } as ConvergenceCapsule;
  }

  // Step 4: truncate failureHistory tail. Only runs if still over budget.
  const truncated = truncateFailureHistoryTail(failureHistory);
  body = buildBody(input, {
    failureHistory: truncated,
    artifactIndex,
    decisions,
    openQuestions
  });
  actualBytes = canonicalBodyBytes(body as unknown as Record<string, unknown>);

  if (actualBytes <= maxUtf8Bytes) {
    const digest = digestCapsule(body);
    return { ...body, digest } as ConvergenceCapsule;
  }

  // Still over budget after all 4 steps: throw with diagnostics.
  const mandatoryFieldCount = countMandatoryCategories(body);
  throw new CapsuleBudgetExceededError(actualBytes, mandatoryFieldCount);
}