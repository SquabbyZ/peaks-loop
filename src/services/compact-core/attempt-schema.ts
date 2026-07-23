/**
 * Task 1.2 — durable attempt journals and session circuit state.
 *
 * This module is the *only* schema source for attempt journals and
 * session-circuit state. It is intentionally vendor-neutral and contains
 * no host, vendor, or CLI-verb strings (design §2.3, §15, §17).
 *
 * The companion runtime store lives at `./attempt-store.ts`. Together
 * they form the durable seam that the later verifier, circuit, and
 * coordinator slices consume.
 *
 * Two persistence paths (§10.5):
 *
 *   .peaks/_runtime/<sessionId>/compact-attempts/<attemptId>.journal.json
 *   .peaks/_runtime/<sessionId>/compact-attempts/session-circuit.json
 *
 * Hard constraints honored here:
 *   - journal contains no raw continuation token, capsule, transcript,
 *     secret, or vendor command (§15).
 *   - strict Zod on the on-disk shape; `schemaVersion: 1` is the only
 *     accepted version and any field shape drift throws.
 *   - the §6.1 state machine is captured by `COMPACT_JOURNAL_STAGES`,
 *     which is intentionally wider than `CompactStage` exported from
 *     `./protocol/compact-events.js` (that one is just the progress
 *     surface emitted over the wire). Renamed from `COMPACT_STAGES` so
 *     it cannot be confused with the wire-emit `CompactStage` set.
 */
import { z } from 'zod';

/**
 * Ordered list of every state the §6.1 state machine can be in, including
 * the recovery / retry / terminal branches. Used by the journal to
 * record the exact state at each atomic write.
 *
 * Distinct from `CompactStage` in `./protocol/compact-events.ts`:
 * `CompactStage` is the narrower set of progress events the core emits
 * over the wire; `COMPACT_JOURNAL_STAGES` is the full state set the
 * durable journal must be able to express.
 */
export const COMPACT_JOURNAL_STAGES = [
  'probing',
  'preparing',
  'checkpointing',
  'native-compacting',
  'fallback-summarizing',
  'replacing',
  'verifying',
  'resuming',
  'recovering',
  'retrying',
  'rolled-back',
  'blocked',
  'completed'
] as const;

export type CompactJournalStage = (typeof COMPACT_JOURNAL_STAGES)[number];

/** ISO-8601 UTC timestamp string. */
const IsoTimestamp = z.string().datetime({ offset: true });

/** Strict, non-empty, path-segment-safe identifier. */
const PathSegment = z
  .string()
  .min(1, 'must not be empty')
  .max(256, 'must not exceed 256 chars')
  .regex(/^[A-Za-z0-9._-]+$/, 'must match /^[A-Za-z0-9._-]+$/ (no separators, traversal, or NUL)');

/** Idempotency key the journal has *sealed* (already dispatched). */
const SealedIdempotencyKey = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/, 'must match /^[A-Za-z0-9._:-]+$/');

/** Failure code the attempt last emitted (or null). */
const FailureCode = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'must be SCREAMING_SNAKE_CASE');

/**
 * Schema for one attempt journal (design §6 + §10.5).
 *
 * Invariants the store enforces on top of this schema:
 *   - `pathGeneration` is monotonically non-decreasing across writes.
 *   - `stage` does not regress except via the recovery transition family
 *     (`verifying → recovering → retrying → verifying`). See
 *     `isPermittedStageTransition` for the exact rule.
 *   - `updatedAt` is refreshed on every successful write.
 *   - the same `attemptId` always carries the same `(sessionId,
 *     capabilityEpoch)` (cross-field guards live in the store).
 */
export const CompactAttemptJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: PathSegment,
    attemptId: PathSegment,
    pathGeneration: z.number().int().min(0).max(1_000_000),
    stage: z.enum(COMPACT_JOURNAL_STAGES),
    verificationFailureCount: z.number().int().min(0).max(1_000_000),
    capabilityEpoch: z.string().min(1).max(128),
    sealedIdempotencyKeys: z.array(SealedIdempotencyKey).max(1024),
    lastFailureCode: FailureCode.nullable(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp
  })
  .strict();

export type CompactAttemptJournal = z.infer<typeof CompactAttemptJournalSchema>;

/**
 * §10.3 invariant: when the circuit is anything other than `closed`, the
 * failure counter MUST be exactly the trip threshold. Persisted state
 * whose counter is past threshold is treated as corruption and rejected
 * (fail closed). When the circuit is `closed`, the counter is bounded
 * in `[0, threshold]`. The threshold constant is hoisted as a literal
 * here so the schema does not close over a forward reference.
 */
const TRIP_THRESHOLD = 3;
const OpenFailureCount = z.literal(TRIP_THRESHOLD);
const ClosedFailureCount = z.number().int().min(0).max(TRIP_THRESHOLD);

export const CompactSessionCircuitStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: PathSegment,
    consecutiveVerificationFailures: z.union([OpenFailureCount, ClosedFailureCount]),
    circuit: z.enum(['closed', 'open', 'awaiting-manual-observation']),
    openedAt: IsoTimestamp.nullable(),
    lastAttemptId: PathSegment.nullable(),
    lastFailureCode: FailureCode.nullable(),
    manualPromptShown: z.boolean()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.circuit !== 'closed' && value.consecutiveVerificationFailures !== TRIP_THRESHOLD) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['consecutiveVerificationFailures'],
        message: `non-closed circuit requires exactly ${TRIP_THRESHOLD} failures, got ${value.consecutiveVerificationFailures}`
      });
    }
  });

export type CompactSessionCircuitState = z.infer<typeof CompactSessionCircuitStateSchema>;

/**
 * Threshold at which the §10.3 circuit must open. Exported so the
 * coordinator can re-derive the constant without importing the store.
 * Kept in sync with `TRIP_THRESHOLD` above; if it ever needs to change,
 * update both.
 */
export const VERIFICATION_CIRCUIT_TRIP_THRESHOLD = 3;

/** Stages that form the §10.2 recovery transition family. */
const RECOVERY_STAGE_FAMILY: ReadonlySet<CompactJournalStage> = new Set([
  'recovering',
  'retrying',
  'rolled-back',
  'blocked'
]);

/** Terminal stages: no transition out of them is permitted (§10.3). */
const TERMINAL_STAGES: ReadonlySet<CompactJournalStage> = new Set([
  'rolled-back',
  'blocked',
  'completed'
]);

/**
 * The single permitted re-entry transition from the recovery family
 * back into the happy path. Per design §10.2: a verification failure
 * trips `verifying → recovering → retrying`, after which the next
 * attempt re-runs §9 (verification). That means `retrying` must be
 * allowed to advance to `verifying`.
 *
 * No other recovery-stage → happy-path transition is permitted; the
 * other recovery states (`rolled-back`, `blocked`) are terminal.
 */
const RETRYING_TO_VERIFYING: ReadonlyArray<readonly [CompactJournalStage, CompactJournalStage]> = [
  ['retrying', 'verifying']
];

/**
 * Return true when `next` is a permitted stage transition from `prev`
 * given the design §6.1 + §10.2 rules.
 *
 * Rules:
 *   - Terminal stages (`rolled-back`, `blocked`, `completed`): no
 *     transition out is permitted; a re-write of the same stage is the
 *     only legal operation (§10.3 / §10.4).
 *   - Same stage: always allowed (idempotent re-write).
 *   - Forward monotonic path along `COMPACT_JOURNAL_STAGES`: allowed.
 *   - Transition *into* the recovery family (`recovering`, `retrying`,
 *     `rolled-back`, `blocked`): allowed from any non-terminal stage.
 *   - Transition *out of* the recovery family: only the single explicit
 *     re-entry `retrying → verifying` is permitted. `recovering` cannot
 *     jump to verifying directly; it must pass through `retrying` first.
 */
export function isPermittedStageTransition(
  prev: CompactJournalStage,
  next: CompactJournalStage
): boolean {
  if (next === prev) return true;
  if (TERMINAL_STAGES.has(prev)) return false;
  if (RECOVERY_STAGE_FAMILY.has(next)) return true;
  if (RECOVERY_STAGE_FAMILY.has(prev)) {
    return RETRYING_TO_VERIFYING.some(([from, to]) => from === prev && to === next);
  }
  const order = COMPACT_JOURNAL_STAGES.indexOf(next) - COMPACT_JOURNAL_STAGES.indexOf(prev);
  return order > 0;
}

/**
 * Throws when `sessionId` or `attemptId` is unsafe to join onto a
 * filesystem path. Used by the store *before* every join so we never
 * hand a `../` segment to `path.join`.
 */
export function assertSafePathSegment(label: 'sessionId' | 'attemptId', value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.length > 256) {
    throw new Error(`${label} must not exceed 256 chars`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(
      `${label} "${value}" is not a safe path segment (must match /^[A-Za-z0-9._-]+$/)`
    );
  }
}

export function assertSafeIdempotencyKey(value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('idempotency key must be a non-empty string');
  }
  if (value.length > 256) {
    throw new Error('idempotency key must not exceed 256 chars');
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(
      `idempotency key "${value}" is not safe (must match /^[A-Za-z0-9._:-]+$/)`
    );
  }
}

// ---------------------------------------------------------------------------
// Containment helpers (fix 1: realpath-based junction/reparse escape guard).
//
// These are *pure* functions that take resolved canonical paths so tests
// can inject pre-resolved values without needing symlink privilege. The
// store calls them with `fs.realpathSync(...)` output. The helpers refuse
// any resolved target whose canonical path does not sit inside the
// canonical `.peaks/_runtime/` anchor of the project root.
//
// On Windows, `lstat(...).isSymbolicLink()` returns FALSE for junctions
// and reparse points, so a junction at `compact-attempts/` can redirect
// writes outside the project while still appearing to be a regular
// directory. Realpath-based containment is the only portable guard.
// ---------------------------------------------------------------------------

export interface ContainmentCheckInput {
  readonly projectRoot: string;
  readonly canonicalProjectRoot: string;
  /** Canonical path of the candidate target (after realpathSync). */
  readonly canonicalTarget: string;
  /**
   * Optional canonical path of the candidate target's parent directory
   * (after realpathSync). Used to detect a junction at the target's
   * parent that redirects the target itself.
   */
  readonly canonicalTargetParent?: string | undefined;
}

/**
 * Returns true iff `canonicalTarget` sits inside
 * `<canonicalProjectRoot>/.peaks/_runtime` (or in that anchor itself).
 *
 * The anchor is `<projectRoot>/.peaks/_runtime` — the canonical runtime
 * sandbox. Anything resolving outside it is a containment violation and
 * must be rejected by the store. The check is `realpath`-based so it
 * follows (and therefore detects) Windows junctions and reparse points.
 */
export function isInsideRuntimeAnchor(input: ContainmentCheckInput): boolean {
  const anchor = joinCanonical(input.canonicalProjectRoot, '.peaks', '_runtime');
  if (!isSameOrNested(input.canonicalTarget, anchor)) return false;
  if (input.canonicalTargetParent !== undefined) {
    if (!isSameOrNested(input.canonicalTargetParent, anchor)) return false;
  }
  return true;
}

/**
 * Compare two canonical, platform-normalized paths. Returns true when
 * `child === parent` or `child` is nested inside `parent`. Pure; safe
 * to call from tests with injected strings.
 */
export function isSameOrNested(child: string, parent: string): boolean {
  if (child === parent) return true;
  const sep = parent.includes('\\') ? '\\' : '/';
  const prefix = parent.endsWith(sep) ? parent : parent + sep;
  return child.startsWith(prefix);
}

function joinCanonical(base: string, ...segments: readonly string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const parts = [base.replace(/[\\/]+$/, ''), ...segments];
  return parts.join(sep);
}