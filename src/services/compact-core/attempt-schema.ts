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
 *   - the §6.1 state machine is captured by `COMPACT_STAGES`, which is
 *     intentionally wider than `CompactStage` (that one is just the
 *     progress surface emitted over the wire).
 */
import { z } from 'zod';

/**
 * Ordered list of every state the §6.1 state machine can be in, including
 * the recovery / retry / terminal branches. Used by the journal to
 * record the exact state at each atomic write.
 */
export const COMPACT_STAGES = [
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

export type CompactAttemptStage = (typeof COMPACT_STAGES)[number];

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
 *     (`verifying → recovering → retrying → …`).
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
    stage: z.enum(COMPACT_STAGES),
    verificationFailureCount: z.number().int().min(0).max(1_000_000),
    capabilityEpoch: z.string().min(1).max(128),
    sealedIdempotencyKeys: z.array(SealedIdempotencyKey).max(1024),
    lastFailureCode: FailureCode.nullable(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp
  })
  .strict();

export type CompactAttemptJournal = z.infer<typeof CompactAttemptJournalSchema>;

/** Initial empty session-circuit state. The store mints this lazily. */
export const CompactSessionCircuitStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    sessionId: PathSegment,
    consecutiveVerificationFailures: z.number().int().min(0).max(1_000_000),
    circuit: z.enum(['closed', 'open']),
    openedAt: IsoTimestamp.nullable(),
    lastAttemptId: PathSegment.nullable(),
    lastFailureCode: FailureCode.nullable(),
    manualPromptShown: z.boolean()
  })
  .strict();

export type CompactSessionCircuitState = z.infer<typeof CompactSessionCircuitStateSchema>;

/**
 * Threshold at which the §10.3 circuit must open. Exported so the
 * coordinator can re-derive the constant without importing the store.
 */
export const VERIFICATION_CIRCUIT_TRIP_THRESHOLD = 3;

/** Stages that form the §10.2 recovery transition family. */
const RECOVERY_STAGE_FAMILY: ReadonlySet<CompactAttemptStage> = new Set([
  'recovering',
  'retrying',
  'rolled-back',
  'blocked'
]);

/**
 * Return true when `next` is a permitted stage transition from `prev`
 * given the design §6.1 + §10.2 rules. A monotonic forward path is
 * always allowed; backward steps are only allowed when the transition
 * is into the recovery family.
 */
export function isPermittedStageTransition(
  prev: CompactAttemptStage,
  next: CompactAttemptStage
): boolean {
  if (next === prev) return true;
  if (RECOVERY_STAGE_FAMILY.has(next)) return true;
  if (RECOVERY_STAGE_FAMILY.has(prev)) {
    // From a recovery state, we may move into any successor of the
    // recovery branch — but never back into the happy path. `retrying`
    // can return to `verifying` (one step forward), `rolled-back` /
    // `blocked` are terminal.
    return false;
  }
  const order = COMPACT_STAGES.indexOf(next) - COMPACT_STAGES.indexOf(prev);
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