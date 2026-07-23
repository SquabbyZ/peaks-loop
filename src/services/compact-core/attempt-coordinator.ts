/**
 * Task 1.5 — attempt coordinator (design §4.2, §5, §6, §9, §10).
 *
 * The coordinator is the vendor-neutral control-plane brain. It owns the
 * §6.1 state machine: it reads the session circuit, negotiates capability
 * through an injected certified bridge, chooses native vs fallback under
 * the §5 admission rules, persists each attempt stage before dispatch,
 * and — critically — only ever claims `AUTO_COMPACT_COMPLETED` after BOTH
 * a §9-valid completion receipt AND a matching resume receipt. Exit code,
 * process spawn, a "started" event, or a completion message alone never
 * prove success (design §9.3; global constraint).
 *
 * Phase-1 boundary (see plan §"RD / QA Slice Boundaries"):
 *   - The host bridge is an injected seam (a certified fake in tests, a
 *     certified provider later). This module imports no host SDK, spawns
 *     nothing, and branches on capability values only — never a vendor
 *     discriminator (design §2.3 red line, enforced by
 *     `vendor-neutrality.test.ts`).
 *   - The convergence-capsule engine lands in Phase 2. The optional
 *     `createFallbackCapsule` dependency seam lets Phase 2 inject a real
 *     capsule + digest; while absent, the coordinator must NEVER claim
 *     fallback completion (no fabricated digest, no fabricated continuity,
 *     no fabricated checkpoint). Dry-run may still plan fallback.
 *
 * Concurrency (handoff #1): Task 1.3's store/circuit are read-modify-write
 * and are NOT safe under parallel increments by themselves. The
 * coordinator therefore serializes all `compactAuto` calls per `sessionId`
 * through an in-process promise-chain mutex. The lock tail is the entry's
 * own completion (success or throw), so a thrown attach/probe/journal/
 * bridge/store error releases the lock and the NEXT call proceeds; the
 * public boundary swallows those throws and resolves a typed non-success.
 *
 * Failure taxonomy (handoff #8):
 *   - Verification failure: a completion receipt was received and
 *     evaluated against §9 and lost. Moves the session counter.
 *   - Invocation failure: the bridge rejected the call, the stream ended
 *     with no completion, the epoch changed, or the capsule engine was
 *     absent. Does NOT touch the counter; may trigger the single
 *     native→fallback switch.
 *   - Internal/bridge/store throw (new): caught at the public boundary,
 *     converted to a typed `AUTO_COMPACT_EXHAUSTED + remain-blocked`
 *     result, and the lock released.
 */
import { createHash } from 'node:crypto';
import {
  decideCompactPath,
  type ProviderCertification
} from './compact-policy.js';
import { verifyContextReduction } from './context-verifier.js';
import {
  AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN,
  recordVerificationFailure as recordCircuitFailure
} from './circuit-breaker.js';
import {
  decideManualFallback,
  type CertifiedManualCompactMetadata,
  type ManualFallbackDecision
} from './manual-fallback.js';
import type { AttemptStore, CompactAttemptJournal } from './attempt-store.js';
import type { CapabilityProfile } from './protocol/capability-profile.js';
import type { HostCompactBridge } from './protocol/host-compact-bridge.js';
import type {
  CapsuleReplacementRequest,
  NativeCompactRequest,
  ProbeRequest,
  ResumeRequest
} from './protocol/bridge-requests.js';
import type {
  CompactCompletionReceipt,
  ContextMeasurementReading,
  ResumeReceipt
} from './protocol/bridge-receipts.js';
import type { CompactEvent } from './protocol/compact-events.js';

/** Blocking codes the coordinator can return (design §5.3, §10.3, §10.4). */
export const AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE =
  'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE' as const;
export const AUTO_COMPACT_EXHAUSTED = 'AUTO_COMPACT_EXHAUSTED' as const;

/**
 * A certified attachment returned by the injected bridge factory. The
 * `certification` and `manualMetadata` come from the provider layer
 * (Phase 3); Phase 1 supplies them via a fake. `manualMetadata` is the
 * already-digest-signed metadata consumed by `decideManualFallback`.
 */
export interface CertifiedBridgeAttachment {
  readonly bridge: HostCompactBridge;
  readonly certification: ProviderCertification;
  readonly manualMetadata: CertifiedManualCompactMetadata | null;
}

/**
 * Phase-2 seam. When provided, the coordinator calls this factory to
 * produce a real convergence capsule + digest before any
 * `replaceWithCapsule` dispatch. When absent, the coordinator refuses to
 * execute the fallback mutation (handoff #5: never fabricate a digest
 * from session/attempt/generation alone) — it still plans fallback under
 * dry-run so the plan surface is honest about what *would* run.
 */
export interface FallbackCapsuleFactory {
  create(input: {
    readonly sessionId: string;
    readonly attemptId: string;
    readonly pathGeneration: number;
  }):
    | { readonly capsule: unknown; readonly capsuleDigest: string }
    | Promise<{ readonly capsule: unknown; readonly capsuleDigest: string }>;
}

export interface CompactCoordinatorDependencies {
  readonly attachBridge: (
    sessionId: string,
    attemptId: string
  ) => Promise<CertifiedBridgeAttachment>;
  readonly store: AttemptStore;
  readonly now: () => Date;
  readonly newAttemptId: () => string;
  /** Optional Phase-2 capsule factory; see `FallbackCapsuleFactory`. */
  readonly createFallbackCapsule?: FallbackCapsuleFactory['create'];
}

export interface CompactAutoInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly targetRatio: number;
  readonly dryRun: boolean;
}

export type CompactAutoResult =
  | {
      readonly ok: true;
      readonly code: 'AUTO_COMPACT_PLAN';
      readonly path: 'native' | 'fallback';
      readonly profile: CapabilityProfile;
    }
  | {
      readonly ok: true;
      readonly code: 'AUTO_COMPACT_COMPLETED';
      readonly receipt: CompactCompletionReceipt;
    }
  | {
      readonly ok: false;
      readonly code:
        | typeof AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE
        | typeof AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN
        | typeof AUTO_COMPACT_EXHAUSTED;
      readonly manualFallback: ManualFallbackDecision;
    };

export interface AttemptCoordinator {
  compactAuto(input: CompactAutoInput): Promise<CompactAutoResult>;
}

/**
 * In-process, per-session serialization. The stored tail is the previous
 * call's completion (success or throw); a thrown predecessor does NOT
 * poison the successor because we register `.then(_, _)` so the tail
 * always settles. The real result/errors still propagate to the original
 * caller via `await run`.
 */
const sessionLocks = new Map<string, Promise<unknown>>();

async function withSessionLock<T>(
  sessionId: string,
  fn: () => Promise<T>
): Promise<T> {
  const predecessor = sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = predecessor.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  sessionLocks.set(sessionId, tail);
  try {
    return await run;
  } finally {
    // Best-effort cleanup: drop the entry once we are the last in line so
    // the map does not grow without bound across many sessions. Runs on
    // both success and throw paths.
    if (sessionLocks.get(sessionId) === tail) {
      sessionLocks.delete(sessionId);
    }
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Digest the coordinator computes over the continuation token it sends to
 * `resume`. The resume receipt must echo exactly this digest; the raw
 * token is never persisted (design §4.5). Phase 1 uses a plain SHA-256;
 * swapping in a project-local keyed HMAC is a later hardening seam and
 * does not change this call site's contract.
 */
function continuationDigest(token: string): string {
  return sha256(token);
}

type PathKind = 'native' | 'fallback';

type RunOutcome =
  | { readonly kind: 'completed'; readonly receipt: CompactCompletionReceipt }
  | { readonly kind: 'invoke-failed' }
  | { readonly kind: 'no-completion' }
  | { readonly kind: 'stale-epoch' }
  | { readonly kind: 'verification-failed'; readonly code: string };

export function createAttemptCoordinator(
  deps: CompactCoordinatorDependencies
): AttemptCoordinator {
  const { attachBridge, store, now, newAttemptId, createFallbackCapsule } = deps;

  async function compactAuto(input: CompactAutoInput): Promise<CompactAutoResult> {
    return withSessionLock(input.sessionId, () =>
      runCompactAuto(input).catch(async (_error) => {
        // (boundary) Internal/attach/probe/journal/bridge/store throws
        // become a typed non-success at the public surface (handoff #1).
        // The session lock has already been released by withSessionLock's
        // `finally` block, so the next call will proceed normally. The raw
        // error is intentionally NOT surfaced to the caller — the contract
        // is a typed `ok:false` decision (no rejection).
        const circuit = await safeReadCircuit(store);
        return {
          ok: false,
          code: AUTO_COMPACT_EXHAUSTED,
          manualFallback: decideManualFallback({ metadata: null, circuit })
        } satisfies CompactAutoResult;
      })
    );
  }

  async function safeReadCircuit(s: AttemptStore) {
    try {
      return await s.readSessionCircuit();
    } catch {
      // If even the circuit read throws, fabricate a transient "closed"
      // view so the caller still gets a typed decision. Real persisted
      // state is untouched.
      return {
        schemaVersion: 1 as const,
        sessionId: '',
        consecutiveVerificationFailures: 0,
        circuit: 'closed' as const,
        openedAt: null,
        lastAttemptId: null,
        lastFailureCode: null,
        manualPromptShown: false
      };
    }
  }

  async function runCompactAuto(input: CompactAutoInput): Promise<CompactAutoResult> {
    // (1) Entry circuit short-circuit — BEFORE attach/probe/new attempt
    // (handoff #3). An open or awaiting-observation circuit means no new
    // automatic attempt may start (design §10.3). We have no attachment
    // here, so the manual decision is computed with null metadata (it will
    // resolve to `remain-blocked`); re-prompting is the circuit-breaker's
    // job, not this early gate's.
    const entryCircuit = await store.readSessionCircuit();
    if (entryCircuit.circuit !== 'closed') {
      return {
        ok: false,
        code: AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN,
        manualFallback: decideManualFallback({ metadata: null, circuit: entryCircuit })
      };
    }

    // (2) Attach + probe (both read-only). Probe once for admission at
    // pathGeneration=0; every later mutation re-probes with the CURRENT
    // generation and compares the epoch (handoff #2 + handoff #4).
    const preAttemptId = input.dryRun ? '' : newAttemptId();
    const attachment = await attachBridge(input.sessionId, preAttemptId || 'dry-run');
    const admissionProfile = await probe(attachment.bridge, {
      sessionId: input.sessionId,
      attemptId: preAttemptId || 'dry-run',
      pathGeneration: 0
    });

    // (3) Admission decision — pure, capability-only (design §5).
    const decision = decideCompactPath({
      profile: admissionProfile,
      certification: attachment.certification
    });

    if (decision.kind === 'blocked' || decision.kind === 'safe-handoff-consent-required') {
      // Neither strong path is admissible. `safe-handoff` cannot auto-run a
      // strong-guarantee compact, so from this surface it is honestly
      // unsupported (design §5.3); consent handling is a later slice.
      return {
        ok: false,
        code: AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE,
        manualFallback: decideManualFallback({
          metadata: attachment.manualMetadata,
          circuit: entryCircuit
        })
      };
    }

    const path: PathKind = decision.kind;

    // (4) Dry-run is side-effect-free (handoff #3): no attempt id consumed,
    // no journal, no circuit mutation, no mutating bridge call.
    if (input.dryRun) {
      return { ok: true, code: 'AUTO_COMPACT_PLAN', path, profile: admissionProfile };
    }

    return executeAttempt({
      input,
      attempt: {
        attemptId: preAttemptId,
        admissionEpoch: admissionProfile.capabilityEpoch,
        bridge: attachment.bridge,
        certification: attachment.certification,
        admissionProfile,
        manualMetadata: attachment.manualMetadata
      },
      initialPath: path
    });
  }

  interface AttemptContext {
    readonly attemptId: string;
    readonly admissionEpoch: string;
    readonly bridge: HostCompactBridge;
    readonly certification: ProviderCertification;
    readonly admissionProfile: CapabilityProfile;
    readonly manualMetadata: CertifiedManualCompactMetadata | null;
  }

  async function executeAttempt(args: {
    readonly input: CompactAutoInput;
    readonly attempt: AttemptContext;
    readonly initialPath: PathKind;
  }): Promise<CompactAutoResult> {
    const { input, attempt } = args;
    const journal = createJournal(input.sessionId, attempt.attemptId, attempt.admissionEpoch, now());
    // Pre-dispatch persistence (design §10.5): the attempt exists on disk
    // before any host mutation, so a crash mid-attempt is recoverable.
    await writeStage(journal, 'preparing');

    let path = args.initialPath;
    let generation = 0;
    let switched = false;

    // Bounded loop: native → (single) fallback. No path may loop forever
    // (handoff #7). Two iterations is the hard ceiling.
    for (let iteration = 0; iteration < 2; iteration += 1) {
      // Fallback seam gate (handoff #5): without a real capsule factory,
      // we MUST NOT dispatch `replaceWithCapsule` with a fabricated digest.
      // Dry-run already planned fallback; here we return honest
      // EXHAUSTED with `remain-blocked` and skip the mutation entirely.
      if (path === 'fallback' && createFallbackCapsule === undefined) {
        return await blockedExhausted(journal, attempt, args.input);
      }

      const outcome = await runPath({ input, attempt, journal, path, generation });

      if (outcome.kind === 'completed') {
        await writeStage(journal, 'completed');
        return { ok: true, code: 'AUTO_COMPACT_COMPLETED', receipt: outcome.receipt };
      }

      if (outcome.kind === 'invoke-failed' || outcome.kind === 'no-completion') {
        // Invocation-class failure (handoff #8): recover once by switching
        // native→fallback with the SAME attemptId and exactly one
        // generation increment (design §6.3, §10.2). Never touches the
        // verification counter.
        if (path === 'native' && !switched) {
          switched = true;
          path = 'fallback';
          generation += 1;
          continue;
        }
        return await blockedExhausted(journal, attempt, args.input);
      }

      if (outcome.kind === 'stale-epoch') {
        // The bridge's capabilities changed mid-attempt (design §4.4). The
        // attempt is invalid; do not switch paths (a switch would re-probe
        // the same changed epoch). Fail closed.
        return await blockedExhausted(journal, attempt, args.input);
      }

      // Verification failure: a receipt was evaluated against §9 and lost.
      // This is the only outcome that moves the session counter.
      const circuit = await recordCircuitFailure(store, {
        sessionId: input.sessionId,
        attemptId: attempt.attemptId,
        failureCode: outcome.code,
        now: now()
      });

      if (circuit.kind === 'open') {
        return await tripCircuit(journal, attempt);
      }
      // `continue`/`already-open`: bounded skeleton stops here. Re-running
      // the fallback capsule after a verification failure requires the
      // Phase-2 capsule engine; representing it now would be fabrication.
      return await blockedExhausted(journal, attempt, args.input);
    }

    return await blockedExhausted(journal, attempt, args.input);
  }

  /**
   * Execute a single path generation: re-probe the epoch, dispatch the
   * mutation, consume its event stream (ignoring stale-generation events),
   * verify §9 reduction (resolving the after-measurement per profile +
   * certification), then resume and verify the resume receipt. A post-
   * resume epoch re-probe seals completion (handoff #4).
   */
  async function runPath(args: {
    readonly input: CompactAutoInput;
    readonly attempt: AttemptContext;
    readonly journal: JournalHandle;
    readonly path: PathKind;
    readonly generation: number;
  }): Promise<RunOutcome> {
    const { input, attempt, journal, path, generation } = args;

    // (a) Re-probe immediately before mutation and reject a stale epoch
    // (handoff #2 + handoff #4). The probe carries the CURRENT generation
    // so the bridge can correlate re-probes to the in-flight attempt.
    if (!(await epochStillFresh(attempt, generation, input.sessionId))) {
      return { kind: 'stale-epoch' };
    }

    if (path === 'native') {
      await writeStage(journal, 'native-compacting', generation);
    } else {
      await writeStage(journal, 'fallback-summarizing', generation);
    }

    // (b) Dispatch the mutation and collect its event stream. A synchronous
    // throw or an async rejection is an invocation failure.
    let events: readonly CompactEvent[];
    try {
      events = await collectEvents(await dispatch({ input, attempt, path, generation }));
    } catch {
      return { kind: 'invoke-failed' };
    }

    // (c) Accept only the current-generation completion receipt. Late
    // events tagged with an older/other generation are ignored (handoff #4).
    const receipt = pickCurrentCompletion(events, attempt.attemptId, generation, path);
    if (!receipt) {
      return { kind: 'no-completion' };
    }

    // (d) §9 reduction gate with completionSource validation (handoff #3).
    // The receipt's self-claimed `after` is honored ONLY when the certified
    // attachment + profile both permit it. Otherwise we remeasure via the
    // live `measureContext` and use that reading.
    await writeStage(journal, 'verifying', generation);
    const resolvedAfter = await resolveAfterMeasurement({
      receipt,
      bridge: attempt.bridge,
      profile: attempt.admissionProfile,
      certification: attempt.certification,
      sessionId: input.sessionId,
      attemptId: attempt.attemptId,
      generation
    });
    if (resolvedAfter === null) {
      // Receipt claimed a completion source the certified contract does
      // not permit. Treat as verification failure so the session counter
      // reflects the untrusted claim.
      return { kind: 'verification-failed', code: 'COMPLETION_SOURCE_UNTRUSTED' };
    }
    const reduction = verifyContextReduction({
      before: { ratio: receipt.before.ratio },
      after: { ratio: resolvedAfter.ratio },
      targetRatio: input.targetRatio
    });
    if (!reduction.passed) {
      return { kind: 'verification-failed', code: 'CONTEXT_NOT_REDUCED' };
    }

    // (e) Resume, then verify the resume receipt digest/identity/continuity
    // (design §9.2). Success is claimed ONLY after this passes (handoff #5).
    if (!(await epochStillFresh(attempt, generation, input.sessionId))) {
      return { kind: 'stale-epoch' };
    }
    await writeStage(journal, 'resuming', generation);
    const resumeReceipt = await attempt.bridge.resume(
      buildResumeRequest({
        attempt,
        generation,
        sessionId: input.sessionId,
        continuationToken: receipt.continuationToken
      })
    );
    if (!resumeReceiptValid(resumeReceipt, attempt.attemptId, generation, receipt.continuationToken)) {
      return { kind: 'verification-failed', code: 'RESUME_FAILED' };
    }

    // (f) Post-resume epoch re-probe (handoff #4 end-to-end). A change
    // here means the bridge mutability contract changed AFTER the
    // resume — refuse to seal completion. Counts as invocation-class
    // (the bridge is no longer the bridge we admitted), NOT a verification
    // failure (no §9 evaluation lost).
    if (!(await epochStillFresh(attempt, generation, input.sessionId))) {
      return { kind: 'stale-epoch' };
    }

    return { kind: 'completed', receipt };
  }

  async function dispatch(args: {
    readonly input: CompactAutoInput;
    readonly attempt: AttemptContext;
    readonly path: PathKind;
    readonly generation: number;
  }): Promise<AsyncIterable<CompactEvent>> {
    const { input, attempt, path, generation } = args;
    if (path === 'native') {
      const request: NativeCompactRequest = {
        kind: 'native-compact',
        sessionId: input.sessionId,
        attemptId: attempt.attemptId,
        pathGeneration: generation,
        capabilityEpoch: attempt.admissionEpoch,
        targetRatio: input.targetRatio
      };
      return attempt.bridge.invokeNative(request);
    }
    // Fallback: build a real capsule via the injected Phase-2 seam
    // (handoff #5). The seam returns a digest traceable to real capsule
    // bytes; the request carries that digest. The outer loop has already
    // gated on `createFallbackCapsule` presence.
    const seam = createFallbackCapsule;
    if (!seam) {
      throw new Error('createFallbackCapsule is required for fallback execution');
    }
    const result = await Promise.resolve(
      seam({
        sessionId: input.sessionId,
        attemptId: attempt.attemptId,
        pathGeneration: generation
      })
    );
    const request: CapsuleReplacementRequest = {
      kind: 'capsule-replacement',
      sessionId: input.sessionId,
      attemptId: attempt.attemptId,
      pathGeneration: generation,
      capabilityEpoch: attempt.admissionEpoch,
      capsuleDigest: result.capsuleDigest,
      rollbackRequired: true
    };
    // Suppress the unused `capsule` payload warning while still letting
    // the seam produce real content (the digest is the traceable handle).
    void result.capsule;
    return attempt.bridge.replaceWithCapsule(request);
  }

  async function epochStillFresh(
    attempt: AttemptContext,
    generation: number,
    sessionId: string
  ): Promise<boolean> {
    const reprobe = await probe(attempt.bridge, {
      sessionId,
      attemptId: attempt.attemptId,
      pathGeneration: generation
    });
    return reprobe.capabilityEpoch === attempt.admissionEpoch;
  }

  async function tripCircuit(
    journal: JournalHandle,
    attempt: AttemptContext
  ): Promise<CompactAutoResult> {
    await writeStage(journal, 'blocked');
    const circuit = await store.readSessionCircuit();
    const manualFallback = decideManualFallback({ metadata: attempt.manualMetadata, circuit });
    // Latch the manual prompt exactly once when we actually offer one
    // (handoff #2). The store's `markManualPromptShown` is idempotent, and a
    // failed manual observation never clears the latch (Task 1.4 contract).
    if (
      manualFallback.kind === 'offer-natural-language-choice' ||
      manualFallback.kind === 'show-host-native-hint-once'
    ) {
      await store.markManualPromptShown();
    }
    return { ok: false, code: AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN, manualFallback };
  }

  async function blockedExhausted(
    journal: JournalHandle,
    attempt: AttemptContext,
    _input: CompactAutoInput
  ): Promise<CompactAutoResult> {
    await writeStage(journal, 'blocked');
    const circuit = await store.readSessionCircuit();
    return {
      ok: false,
      code: AUTO_COMPACT_EXHAUSTED,
      manualFallback: decideManualFallback({ metadata: attempt.manualMetadata, circuit })
    };
  }

  // ---- journal helpers -------------------------------------------------

  interface JournalHandle {
    current: CompactAttemptJournal;
  }

  function createJournal(
    sessionId: string,
    attemptId: string,
    capabilityEpoch: string,
    at: Date
  ): JournalHandle {
    const iso = at.toISOString();
    return {
      current: {
        schemaVersion: 1,
        sessionId,
        attemptId,
        pathGeneration: 0,
        stage: 'probing',
        verificationFailureCount: 0,
        capabilityEpoch,
        sealedIdempotencyKeys: [],
        lastFailureCode: null,
        createdAt: iso,
        updatedAt: iso
      }
    };
  }

  async function writeStage(
    journal: JournalHandle,
    stage: CompactAttemptJournal['stage'],
    generation?: number
  ): Promise<void> {
    const next: CompactAttemptJournal = {
      ...journal.current,
      stage,
      pathGeneration: generation ?? journal.current.pathGeneration,
      updatedAt: now().toISOString()
    };
    await store.writeAttempt(next);
    journal.current = next;
  }

  return { compactAuto };
}

// ---- pure helpers (module scope, no coordinator state) -----------------

async function probe(
  bridge: HostCompactBridge,
  identity: { readonly sessionId: string; readonly attemptId: string; readonly pathGeneration: number }
): Promise<CapabilityProfile> {
  const request: ProbeRequest = {
    kind: 'probe',
    sessionId: identity.sessionId,
    attemptId: identity.attemptId,
    pathGeneration: identity.pathGeneration
  };
  return bridge.probe(request);
}

async function collectEvents(
  iterable: AsyncIterable<CompactEvent>
): Promise<readonly CompactEvent[]> {
  const out: CompactEvent[] = [];
  for await (const event of iterable) {
    out.push(event);
  }
  return out;
}

function pickCurrentCompletion(
  events: readonly CompactEvent[],
  attemptId: string,
  generation: number,
  path: PathKind
): CompactCompletionReceipt | null {
  for (const event of events) {
    if (event.attemptId !== attemptId || event.pathGeneration !== generation) {
      continue; // stale/foreign generation — ignore (design §6.3, handoff #4)
    }
    if (event.type !== 'completed') {
      continue;
    }
    const receipt = event.receipt;
    if (
      receipt.attemptId === attemptId &&
      receipt.pathGeneration === generation &&
      receipt.path === path &&
      receipt.sameUi === true
    ) {
      return receipt;
    }
  }
  return null;
}

function buildResumeRequest(args: {
  readonly attempt: { readonly attemptId: string; readonly admissionEpoch: string };
  readonly generation: number;
  readonly sessionId: string;
  readonly continuationToken: string;
}): ResumeRequest {
  return {
    kind: 'resume',
    sessionId: args.sessionId,
    attemptId: args.attempt.attemptId,
    pathGeneration: args.generation,
    capabilityEpoch: args.attempt.admissionEpoch,
    continuationToken: args.continuationToken
  };
}

function resumeReceiptValid(
  receipt: ResumeReceipt,
  attemptId: string,
  generation: number,
  continuationToken: string
): boolean {
  return (
    receipt.attemptId === attemptId &&
    receipt.pathGeneration === generation &&
    receipt.sameUi === true &&
    receipt.continuationTokenDigest === continuationDigest(continuationToken)
  );
}

/**
 * Validate the receipt's `completionSource` against the certified
 * attachment + profile (handoff #3). Returns the trusted `after`
 * measurement, or `null` when the receipt claims a source the contract
 * does not permit (caller must convert to verification failure).
 *
 * Rules:
 *   - `host-event`: trusted ONLY when `certified-strong` AND the profile's
 *     `completionSignal === 'event-with-measurement'`. Otherwise we must
 *     remeasure.
 *   - `remeasure`: ALWAYS remeasure via `measureContext`; never trust the
 *     receipt's `after`.
 */
async function resolveAfterMeasurement(args: {
  readonly receipt: CompactCompletionReceipt;
  readonly bridge: HostCompactBridge;
  readonly profile: CapabilityProfile;
  readonly certification: ProviderCertification;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly generation: number;
}): Promise<ContextMeasurementReading | null> {
  const source = args.receipt.completionSource;
  const canTrustEvent =
    args.certification === 'certified-strong' &&
    args.profile.completionSignal === 'event-with-measurement';
  if (source === 'host-event') {
    if (!canTrustEvent) return null;
    return args.receipt.after;
  }
  // 'remeasure' source: contract requires a live remeasure regardless of
  // what the receipt claims.
  return args.bridge.measureContext({
    kind: 'measure-context',
    sessionId: args.sessionId,
    attemptId: args.attemptId,
    pathGeneration: args.generation
  });
}

// Tiny helpers live above; bridgeCapsuleReplace was removed when dispatch
// became async.