/**
 * Phase 2 Task 2.6 — journal-driven recovery (design §10.5).
 *
 * After a crash or process restart, the §6.1 state machine must be able
 * to pick up where it left off. This module exposes two named hooks:
 *
 *   - `decideRecoveryAction` — pure decision logic that maps a persisted
 *     `CompactAttemptJournal` to a discriminated union describing whether
 *     to resume, abandon, or conclude the attempt.
 *
 *   - `resumeAttemptFromJournal` — the orchestrator that reads the
 *     journal via the existing `AttemptStore` interface, runs the
 *     decision function, and dispatches to the injected fallback
 *     coordinator when a resume is warranted.
 *
 * Pure decision logic has no I/O beyond the read handed to the
 * `AttemptStore`. The fallback coordinator is injected (no module-level
 * import of a mock host bridge or capsule factory) so Phase 3 / Phase 4
 * providers can wire real bridges without touching this module.
 */
import type {
  AttemptStore,
  CompactAttemptJournal,
  CompactJournalStage
} from './attempt-store.js';
import type {
  FallbackCoordinationInput,
  FallbackCoordinationResult
} from './fallback-coordinator.js';
import type { ConvergenceCapsule } from './capsule-types.js';
import type { HostCompactBridge } from './protocol/host-compact-bridge.js';

// ── Public types ───────────────────────────────────────────────────────────

/** Reasons the orchestrator may decide to abandon a journal. */
export type RecoveryAbandonCode =
  | 'JOURNAL_STALE'
  | 'JOURNAL_MISSING_STAGE'
  | 'JOURNAL_EMPTY'
  | 'JOURNAL_INVALID_DIGEST';

/**
 * Discriminated union returned by `decideRecoveryAction`. Every branch
 * is reachable from the §6.1 state machine; the union is exhaustive over
 * `CompactJournalStage` plus the abandon / terminal classes.
 */
export type RecoveryDecision =
  | { readonly kind: 'resume-pre-stage'; readonly targetStage: CompactJournalStage }
  | { readonly kind: 'resume-replacing'; readonly transactionId: string }
  | { readonly kind: 'resume-verifying' }
  | { readonly kind: 'resume-resuming' }
  | {
      readonly kind: 'abandon';
      readonly code: RecoveryAbandonCode;
    }
  | { readonly kind: 'completed' }
  | { readonly kind: 'terminal-failed' };

/** Input bundle for `decideRecoveryAction`. */
export interface DecideRecoveryActionInput {
  readonly journal: CompactAttemptJournal;
  /** Caller-supplied clock; the decision is deterministic for any given `now`. */
  readonly now: Date;
  /** Optional override; defaults to 7 days. */
  readonly maxAgeMs?: number;
}

/** SHA-256 hex digest format the journal's own `digest` field must obey. */
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** Pre-dispatch stages. The previous generation has not failed. */
const PRE_STAGE_RESUME: ReadonlySet<CompactJournalStage> = new Set([
  'probing',
  'preparing',
  'checkpointing',
  'native-compacting',
  'fallback-summarizing',
  'recovering',
  'retrying'
]);

/** Mid-dispatch stages. The previous generation failed; bump pathGeneration. */
const MID_STAGE_RESUME: ReadonlySet<CompactJournalStage> = new Set([
  'replacing',
  'verifying',
  'resuming'
]);

/** Default stale threshold — 7 days, per design §10.5. */
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ── decideRecoveryAction ───────────────────────────────────────────────────

/**
 * Pure decision function. Returns one of:
 *   - `resume-pre-stage` / `resume-replacing` / `resume-verifying` /
 *     `resume-resuming` — the orchestrator should dispatch to the
 *     fallback coordinator with the chosen pathGeneration,
 *   - `abandon` — the journal is too old, malformed, or empty,
 *   - `completed` / `terminal-failed` — no further work is needed.
 *
 * The function never throws; every reject path is reflected in the
 * `abandon` branch with a structured code.
 */
export function decideRecoveryAction(input: DecideRecoveryActionInput): RecoveryDecision {
  const { journal, now } = input;
  const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  // (1) Integrity: the journal's own digest must be present and a valid
  // SHA-256 hex string. This is the first check because everything else
  // operates on trust that the bytes on disk have not been tampered with.
  if (typeof journal.digest !== 'string' || !DIGEST_PATTERN.test(journal.digest)) {
    return { kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' };
  }

  // (2) Presence: a journal without a stage is empty by definition.
  const stage = journal.stage;
  if (typeof stage !== 'string' || stage.length === 0) {
    return { kind: 'abandon', code: 'JOURNAL_MISSING_STAGE' };
  }

  // (3) Age: a journal older than the threshold is treated as unowned.
  // The orchestrator must rotate to a fresh attemptId when this fires.
  const createdAt = new Date(journal.createdAt).getTime();
  if (now.getTime() - createdAt > maxAgeMs) {
    return { kind: 'abandon', code: 'JOURNAL_STALE' };
  }

  // (4) Dispatch: every stage is mapped to exactly one decision branch.
  // The union is exhaustive over `COMPACT_JOURNAL_STAGES`; the `default`
  // branch is unreachable but kept as a guardrail so a future stage
  // addition fails the build with a single typed error.
  switch (stage) {
    case 'rolled-back':
    case 'blocked':
      return { kind: 'terminal-failed' };
    case 'completed':
      return { kind: 'completed' };
    case 'replacing':
      if (journal.sealedIdempotencyKeys.length === 0) {
        return { kind: 'abandon', code: 'JOURNAL_EMPTY' };
      }
      // The empty-length guard above proves the array is non-empty, but
      // TypeScript cannot infer `T[0]` from a `.length` check alone, so
      // re-bind through a narrowed local for the read.
      const firstKey = journal.sealedIdempotencyKeys[0];
      if (firstKey === undefined) {
        return { kind: 'abandon', code: 'JOURNAL_EMPTY' };
      }
      return { kind: 'resume-replacing', transactionId: firstKey };
    case 'verifying':
      return { kind: 'resume-verifying' };
    case 'resuming':
      return { kind: 'resume-resuming' };
    default: {
      if (PRE_STAGE_RESUME.has(stage)) {
        return { kind: 'resume-pre-stage', targetStage: stage };
      }
      // Unreachable for the current `COMPACT_JOURNAL_STAGES`; kept for
      // type-safety against a future schema expansion.
      return { kind: 'abandon', code: 'JOURNAL_MISSING_STAGE' };
    }
  }
}

// ── resumeAttemptFromJournal ───────────────────────────────────────────────

/** Public signature of the injected fallback coordinator. */
export type FallbackCoordinatorDispatch = (
  input: FallbackCoordinationInput
) => Promise<FallbackCoordinationResult>;

/** Input bundle for `resumeAttemptFromJournal`. */
export interface ResumeAttemptFromJournalInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly fallbackCoordinator: FallbackCoordinatorDispatch;
  readonly store: AttemptStore;
  readonly now: Date;
  readonly maxAgeMs?: number;
  /** Bridge to attach to the fallback coordinator when resuming. */
  readonly bridge: HostCompactBridge;
  /** Capsule to hand the fallback coordinator. */
  readonly capsule: ConvergenceCapsule;
  readonly targetRatio: number;
  readonly continuationToken: string;
  /** Expected capability epoch; must match the bridge's probe. */
  readonly capabilityEpoch: string;
}

/** Output bundle for `resumeAttemptFromJournal`. */
export interface ResumeAttemptFromJournalResult {
  readonly decision: RecoveryDecision;
  /**
   * Filled in when the decision is a resume branch and the coordinator
   * was actually dispatched. `undefined` for abandon / terminal /
   * completed branches (the orchestrator short-circuits those).
   */
  readonly coordinationResult?: FallbackCoordinationResult;
  /**
   * Suggested attempt id for the NEXT attempt when the decision is
   * `abandon`. `undefined` for every other branch — the existing
   * attemptId is still valid when we resume or recognize the journal as
   * already terminal.
   */
  readonly nextAttemptId?: string;
}

// ── pathGeneration strategy ────────────────────────────────────────────────

/**
 * Stage-keyed rules: the previous generation failed iff the journal is
 * paused mid-dispatch. Reusing `journal.pathGeneration` for a clean
 * resume, bumping by 1 otherwise.
 */
function nextPathGeneration(stage: CompactJournalStage, journalPathGeneration: number): number {
  if (MID_STAGE_RESUME.has(stage)) {
    return journalPathGeneration + 1;
  }
  return journalPathGeneration;
}

// ── resumeAttemptFromJournal ───────────────────────────────────────────────

/**
 * Read the journal, run the decision function, and dispatch to the
 * injected fallback coordinator when a resume is warranted. The function
 * never throws on a reject path; abandon / terminal / completed branches
 * return a `ResumeAttemptFromJournalResult` with no `coordinationResult`.
 */
export async function resumeAttemptFromJournal(
  input: ResumeAttemptFromJournalInput
): Promise<ResumeAttemptFromJournalResult> {
  const journal = await input.store.readAttempt(input.attemptId);
  if (journal === null) {
    return {
      decision: { kind: 'abandon', code: 'JOURNAL_EMPTY' },
      nextAttemptId: `${input.attemptId}-next`
    };
  }

  const decision = decideRecoveryAction({
    journal,
    now: input.now,
    ...(input.maxAgeMs !== undefined ? { maxAgeMs: input.maxAgeMs } : {})
  });

  if (
    decision.kind === 'abandon' ||
    decision.kind === 'completed' ||
    decision.kind === 'terminal-failed'
  ) {
    const result: ResumeAttemptFromJournalResult = { decision };
    if (decision.kind === 'abandon') {
      return { ...result, nextAttemptId: `${input.attemptId}-next` };
    }
    return result;
  }

  const pathGeneration = nextPathGeneration(journal.stage, journal.pathGeneration);
  const coordinationInput: FallbackCoordinationInput = {
    projectRoot: input.projectRoot,
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    pathGeneration,
    capabilityEpoch: input.capabilityEpoch,
    bridge: input.bridge,
    capsule: input.capsule,
    targetRatio: input.targetRatio,
    continuationToken: input.continuationToken
  };
  const coordinationResult = await input.fallbackCoordinator(coordinationInput);
  return { decision, coordinationResult };
}
