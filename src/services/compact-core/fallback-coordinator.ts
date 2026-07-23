/**
 * Phase 2 Task 2.5 — mock host bridge + fallback coordinator (design §4.4,
 * §6.1, §9, §10.2, §10.3).
 *
 * This module ships:
 *
 *   - `makeMockHostBridge` — a deterministic, vendor-neutral test bridge
 *     that returns a `CertifiedBridgeAttachment` and exposes an
 *     `attempts.bucket.calls` map for test inspection. Default profile
 *     satisfies every strong-guarantee field so admission passes.
 *
 *   - `runFallbackCompaction` — the §6.1 fallback state machine: probe →
 *     replaceWithCapsule → measureContext → verifyContextReduction →
 *     resume. Returns a typed result; never throws on a failure path.
 *
 *   - `createFallbackCapsule` — pure deterministic capsule builder that
 *     materializes a `ConvergenceCapsule` from cursors and seals its
 *     SHA-256 digest. This is the seam Phase 1.5 was missing.
 *
 *   - `createFallbackCapsuleSeam` — higher-order factory matching the
 *     Phase 1.5 `FallbackCapsuleFactory.create` signature so the existing
 *     coordinator can drive the fallback path end-to-end.
 *
 * Vendor-neutrality: this module imports only Phase 1.5 / Phase 2.1-2.3
 * modules + `node:crypto`. No host names, no binaries, no slash commands,
 * no vendor conditionals. The static vendor-neutrality test scans this
 * file and will fail if a forbidden term creeps in.
 */
import { createHash } from 'node:crypto';
import type {
  CapabilityProfile
} from './protocol/capability-profile.js';
import type {
  HostCompactBridge
} from './protocol/host-compact-bridge.js';
import type {
  CapsuleReplacementRequest,
  InspectTransactionRequest,
  MeasureContextRequest,
  NativeCompactRequest,
  ProbeRequest,
  ResumeRequest,
  RollbackRequest
} from './protocol/bridge-requests.js';
import type {
  CompactCompletionReceipt,
  ContextMeasurementReading,
  ResumeReceipt,
  TransactionReceipt
} from './protocol/bridge-receipts.js';
import type {
  CompactEvent
} from './protocol/compact-events.js';
import {
  digestCapsule
} from './capsule-digest.js';
import type {
  ApprovedGoal,
  ConvergenceCapsule,
  JobCursor,
  NextAction,
  RequestCursor,
  TaskSnapshot,
  WorkflowMode
} from './capsule-types.js';
import {
  deriveCapsuleId,
  SCHEMA_VERSION
} from './capsule-types.js';
import {
  verifyContextReduction,
  type ContextReductionVerification
} from './context-verifier.js';
import type { CertifiedBridgeAttachment } from './attempt-coordinator.js';

// ── Failure codes ──────────────────────────────────────────────────────────

/** Failure codes the fallback coordinator returns on each reject path. */
export const FALLBACK_PROBE_FAILED = 'FALLBACK_PROBE_FAILED' as const;
export const FALLBACK_REPLACE_FAILED = 'FALLBACK_REPLACE_FAILED' as const;
export const FALLBACK_REDUCE_FAILED = 'FALLBACK_REDUCE_FAILED' as const;
export const FALLBACK_RESUME_FAILED = 'FALLBACK_RESUME_FAILED' as const;

/** Common string-literal union of every failure code. */
export type FallbackFailureCode =
  | typeof FALLBACK_PROBE_FAILED
  | typeof FALLBACK_REPLACE_FAILED
  | typeof FALLBACK_REDUCE_FAILED
  | typeof FALLBACK_RESUME_FAILED;

/** Typed errors the coordinator raises internally; the public surface wraps them in a result. */
export class FallbackReplaceError extends Error {
  readonly code = FALLBACK_REPLACE_FAILED;
  constructor(message: string) {
    super(message);
    this.name = 'FallbackReplaceError';
  }
}

export class FallbackReductionError extends Error {
  readonly code = FALLBACK_REDUCE_FAILED;
  readonly before: ContextMeasurementReading;
  readonly after: ContextMeasurementReading;
  readonly targetRatio: number;
  readonly requiredMaximum: number;
  constructor(args: {
    message: string;
    before: ContextMeasurementReading;
    after: ContextMeasurementReading;
    targetRatio: number;
    requiredMaximum: number;
  }) {
    super(args.message);
    this.name = 'FallbackReductionError';
    this.before = args.before;
    this.after = args.after;
    this.targetRatio = args.targetRatio;
    this.requiredMaximum = args.requiredMaximum;
  }
}

export class FallbackResumeError extends Error {
  readonly code = FALLBACK_RESUME_FAILED;
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = 'FallbackResumeError';
    this.reason = reason;
  }
}

export class FallbackProbeError extends Error {
  readonly code = FALLBACK_PROBE_FAILED;
  constructor(message: string) {
    super(message);
    this.name = 'FallbackProbeError';
  }
}

// ── Stage log ──────────────────────────────────────────────────────────────

/**
 * A stage record the coordinator appends as it advances. Used by tests
 * to verify the canonical §6.1 ordering without scraping ANSI output.
 */
export type FallbackStage =
  | { readonly kind: 'preparing' }
  | { readonly kind: 'summarizing' }
  | { readonly kind: 'replacing' }
  | { readonly kind: 'verifying' }
  | { readonly kind: 'resuming' }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly code: FallbackFailureCode };

// ── Public result type ─────────────────────────────────────────────────────

/** Discriminated union of every public outcome of `runFallbackCompaction`. */
export type FallbackCoordinationResult =
  | {
      readonly ok: true;
      readonly code: 'FALLBACK_COMPLETED';
      readonly receipt: CompactCompletionReceipt;
      readonly resumeReceipt: ResumeReceipt;
      readonly stages: readonly FallbackStage[];
    }
  | {
      readonly ok: false;
      readonly code: FallbackFailureCode;
      readonly error: FallbackReplaceError | FallbackReductionError | FallbackResumeError | FallbackProbeError;
      readonly stages: readonly FallbackStage[];
    };

/** Inputs for `runFallbackCompaction`. */
export interface FallbackCoordinationInput {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly capabilityEpoch: string;
  readonly bridge: HostCompactBridge;
  /** Capsule payload; the coordinator never mutates it. */
  readonly capsule: ConvergenceCapsule;
  readonly targetRatio: number;
  readonly continuationToken: string;
  /** Caller-supplied clock; defaults to `new Date()`. */
  readonly now?: () => Date;
}

// ── sha256 helper ──────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ── runFallbackCompaction ──────────────────────────────────────────────────

/**
 * The §6.1 fallback state machine. Pure of vendor knowledge; consumes
 * an already-attached `HostCompactBridge` and a pre-built capsule. Never
 * throws on a failure path; failures are returned as a typed
 * `FallbackCoordinationResult`.
 *
 * Steps:
 *   1. probe — re-validate the capability epoch against the bridge's
 *      current profile.
 *   2. replaceWithCapsule — drain the event stream; expect a `completed`
 *      event with sameUi=true carrying a §9 receipt.
 *   3. measureContext — when the receipt's `completionSource` is
 *      `remeasure`, call `measureContext` and use the live reading as
 *      the verified `after`.
 *   4. verifyContextReduction — strict `after < min(before*0.70,
 *      targetRatio)`. Failure → `FallbackReductionError`.
 *   5. resume — call `bridge.resume`; verify `sameUi === true`, identity
 *      match, and `continuationTokenDigest === sha256(token)`. Failure
 *      → `FallbackResumeError`.
 */
export async function runFallbackCompaction(
  input: FallbackCoordinationInput
): Promise<FallbackCoordinationResult> {
  const now = input.now ?? (() => new Date());
  const stages: FallbackStage[] = [{ kind: 'preparing' }];
  const record = (stage: FallbackStage): void => {
    stages.push(stage);
  };

  // (1) probe + re-validate the epoch.
  const probeRequest: ProbeRequest = {
    kind: 'probe',
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    pathGeneration: input.pathGeneration
  };
  let probeProfile: CapabilityProfile;
  try {
    probeProfile = await input.bridge.probe(probeRequest);
  } catch (error) {
    const err = new FallbackProbeError(
      `probe rejected: ${(error as Error).message ?? String(error)}`
    );
    record({ kind: 'failed', code: FALLBACK_PROBE_FAILED });
    return { ok: false, code: FALLBACK_PROBE_FAILED, error: err, stages };
  }
  if (probeProfile.capabilityEpoch !== input.capabilityEpoch) {
    const err = new FallbackProbeError(
      `stale capability epoch: expected ${input.capabilityEpoch}, got ${probeProfile.capabilityEpoch}`
    );
    record({ kind: 'failed', code: FALLBACK_PROBE_FAILED });
    return { ok: false, code: FALLBACK_PROBE_FAILED, error: err, stages };
  }

  // (2) replaceWithCapsule + collect the event stream + accept the receipt.
  const replaceRequest: CapsuleReplacementRequest = {
    kind: 'capsule-replacement',
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    pathGeneration: input.pathGeneration,
    capabilityEpoch: input.capabilityEpoch,
    capsuleDigest: input.capsule.digest,
    rollbackRequired: true
  };
  record({ kind: 'summarizing' });
  record({ kind: 'replacing' });

  let receipt: CompactCompletionReceipt | null = null;
  try {
    const iterable = input.bridge.replaceWithCapsule(replaceRequest);
    for await (const event of iterable) {
      if (event.attemptId !== input.attemptId) continue;
      if (event.pathGeneration !== input.pathGeneration) continue;
      if (event.type === 'stage') {
        if (event.stage === 'verifying') record({ kind: 'verifying' });
      }
      if (event.type === 'completed') {
        const r = event.receipt;
        if (
          r.attemptId === input.attemptId &&
          r.pathGeneration === input.pathGeneration &&
          r.path === 'fallback' &&
          r.sameUi === true
        ) {
          receipt = r;
        }
      }
    }
  } catch (error) {
    const err = new FallbackReplaceError(
      `replaceWithCapsule rejected: ${(error as Error).message ?? String(error)}`
    );
    record({ kind: 'failed', code: FALLBACK_REPLACE_FAILED });
    return { ok: false, code: FALLBACK_REPLACE_FAILED, error: err, stages };
  }
  if (receipt === null) {
    const err = new FallbackReplaceError(
      'replaceWithCapsule stream ended without a current-generation completed event'
    );
    record({ kind: 'failed', code: FALLBACK_REPLACE_FAILED });
    return { ok: false, code: FALLBACK_REPLACE_FAILED, error: err, stages };
  }

  // (3) measureContext — remeasure when the receipt requires it.
  let resolvedAfter: ContextMeasurementReading = receipt.after;
  if (receipt.completionSource === 'remeasure') {
    const measureRequest: MeasureContextRequest = {
      kind: 'measure-context',
      sessionId: input.sessionId,
      attemptId: input.attemptId,
      pathGeneration: input.pathGeneration
    };
    try {
      resolvedAfter = await input.bridge.measureContext(measureRequest);
    } catch (error) {
      const err = new FallbackReductionError({
        message: `measureContext rejected: ${(error as Error).message ?? String(error)}`,
        before: receipt.before,
        after: receipt.after,
        targetRatio: input.targetRatio,
        requiredMaximum: Math.min(receipt.before.ratio * 0.7, input.targetRatio)
      });
      record({ kind: 'failed', code: FALLBACK_REDUCE_FAILED });
      return { ok: false, code: FALLBACK_REDUCE_FAILED, error: err, stages };
    }
  }

  // (4) verifyContextReduction — strict.
  const reduction: ContextReductionVerification = verifyContextReduction({
    before: { ratio: receipt.before.ratio },
    after: { ratio: resolvedAfter.ratio },
    targetRatio: input.targetRatio
  });
  if (!reduction.passed) {
    const err = new FallbackReductionError({
      message:
        `context did not reduce enough: after=${resolvedAfter.ratio} ` +
        `not below requiredMaximum=${reduction.requiredMaximum}`,
      before: receipt.before,
      after: resolvedAfter,
      targetRatio: input.targetRatio,
      requiredMaximum: reduction.requiredMaximum
    });
    record({ kind: 'failed', code: FALLBACK_REDUCE_FAILED });
    return { ok: false, code: FALLBACK_REDUCE_FAILED, error: err, stages };
  }

  // (5) resume.
  record({ kind: 'resuming' });
  const resumeRequest: ResumeRequest = {
    kind: 'resume',
    sessionId: input.sessionId,
    attemptId: input.attemptId,
    pathGeneration: input.pathGeneration,
    capabilityEpoch: input.capabilityEpoch,
    continuationToken: input.continuationToken
  };
  let resumeReceipt: ResumeReceipt;
  try {
    resumeReceipt = await input.bridge.resume(resumeRequest);
  } catch (error) {
    const err = new FallbackResumeError(
      `resume rejected: ${(error as Error).message ?? String(error)}`,
      'resume-rejected'
    );
    record({ kind: 'failed', code: FALLBACK_RESUME_FAILED });
    return { ok: false, code: FALLBACK_RESUME_FAILED, error: err, stages };
  }
  const expectedDigest = sha256(input.continuationToken);
  if (resumeReceipt.attemptId !== input.attemptId) {
    const err = new FallbackResumeError(
      `resume receipt attemptId mismatch: expected ${input.attemptId}, got ${resumeReceipt.attemptId}`,
      'attempt-id-mismatch'
    );
    record({ kind: 'failed', code: FALLBACK_RESUME_FAILED });
    return { ok: false, code: FALLBACK_RESUME_FAILED, error: err, stages };
  }
  if (resumeReceipt.pathGeneration !== input.pathGeneration) {
    const err = new FallbackResumeError(
      `resume receipt pathGeneration mismatch: expected ${input.pathGeneration}, got ${resumeReceipt.pathGeneration}`,
      'path-generation-mismatch'
    );
    record({ kind: 'failed', code: FALLBACK_RESUME_FAILED });
    return { ok: false, code: FALLBACK_RESUME_FAILED, error: err, stages };
  }
  if (resumeReceipt.sameUi !== true) {
    const err = new FallbackResumeError(
      'resume receipt does not confirm sameUi === true',
      'same-ui-false'
    );
    record({ kind: 'failed', code: FALLBACK_RESUME_FAILED });
    return { ok: false, code: FALLBACK_RESUME_FAILED, error: err, stages };
  }
  if (resumeReceipt.continuationTokenDigest !== expectedDigest) {
    const err = new FallbackResumeError(
      `resume receipt digest mismatch: expected ${expectedDigest}, got ${resumeReceipt.continuationTokenDigest}`,
      'digest-mismatch'
    );
    record({ kind: 'failed', code: FALLBACK_RESUME_FAILED });
    return { ok: false, code: FALLBACK_RESUME_FAILED, error: err, stages };
  }

  // Success.
  record({ kind: 'completed' });
  // When a remeasure was taken, surface the live reading in the receipt
  // returned to the caller so it reflects the verified measurement.
  const sealedReceipt: CompactCompletionReceipt =
    resolvedAfter === receipt.after
      ? receipt
      : { ...receipt, after: resolvedAfter };
  return {
    ok: true,
    code: 'FALLBACK_COMPLETED',
    receipt: sealedReceipt,
    resumeReceipt,
    stages
  };
}

// ── createFallbackCapsule ──────────────────────────────────────────────────

/** Inputs the caller hands to `createFallbackCapsule`. */
export interface CreateFallbackCapsuleInput {
  readonly attemptId: string;
  readonly sourceSessionId: string;
  readonly goal: ApprovedGoal;
  readonly mode: WorkflowMode;
  readonly cursor: JobCursor | RequestCursor | null;
  readonly tasks: readonly TaskSnapshot[];
  readonly nextAction: NextAction;
  /** Caller-supplied clock; the `now` injected into deterministic fields. */
  readonly now: () => Date;
}

/**
 * Build a real `ConvergenceCapsule` from the cursors + approved goal +
 * active tasks + next action. The capsule's `capsuleId` is derived from
 * the attempt/session/first-payload material so it is stable across
 * restarts; the `digest` is the SHA-256 of the canonical body. Empty
 * `failureHistory`, `decisions`, `openQuestions`, and `artifactIndex`
 * pass through as `[]`. The result is a sealed, verified record.
 */
export function createFallbackCapsule(input: CreateFallbackCapsuleInput): ConvergenceCapsule {
  const measuredAt = input.now().toISOString();
  // Split the cursor into the right typed slot. A `RequestCursor` carries
  // `requestId`; a `JobCursor` carries `jobId`. Anything else → both null.
  let activeJob: JobCursor | null = null;
  let activeRequest: RequestCursor | null = null;
  if (input.cursor !== null) {
    if ('jobId' in input.cursor) {
      activeJob = input.cursor;
    } else if ('requestId' in input.cursor) {
      activeRequest = input.cursor;
    }
  }

  // Deterministic capsuleId keyed on (attemptId, sessionId, first payload
  // field — the goal.id). Stable across calls with identical inputs.
  const firstPayload = `goal:${input.goal.id}`;
  const capsuleId = deriveCapsuleId({
    compactAttemptId: input.attemptId,
    sourceSessionId: input.sourceSessionId,
    firstPayload
  });

  // Build the body without `digest`, then hash.
  const body: Omit<ConvergenceCapsule, 'digest'> = {
    schemaVersion: SCHEMA_VERSION,
    capsuleId,
    compactAttemptId: input.attemptId,
    sourceSessionId: input.sourceSessionId,
    goal: { ...input.goal },
    mode: input.mode,
    activeJob,
    activeRequest,
    completedGates: [],
    activeTasks: input.tasks.map(t => ({ ...t })),
    decisions: [],
    openQuestions: [],
    failureHistory: [],
    artifactIndex: [],
    nextAction: { ...input.nextAction },
    idempotency: { scope: input.sourceSessionId, sealedKeys: [`init:${input.attemptId}`] },
    sourceContextMeasurement: {
      promptBytes: 0,
      capacityBytes: 1,
      ratio: 0,
      computedAt: measuredAt,
      windowKind: '200k'
    }
  };
  const digest = digestCapsule(body);
  return { ...body, digest };
}

// ── createFallbackCapsuleSeam ──────────────────────────────────────────────

/** Getter bundle the seam consumes. Each getter is called only when the
 * corresponding capsule field is needed. */
export interface CreateFallbackCapsuleSeamGetters {
  readonly getSourceState: () => {
    readonly goal: ApprovedGoal;
    readonly mode: WorkflowMode;
    readonly cursor: JobCursor | RequestCursor | null;
    readonly nextAction: NextAction;
  };
  readonly getActiveTasks: () => readonly TaskSnapshot[];
  readonly getGoal?: () => ApprovedGoal;
  readonly getMode?: () => WorkflowMode;
  readonly getCursor?: () => JobCursor | RequestCursor | null;
  readonly getNextAction?: () => NextAction;
  readonly getNow: () => Date;
}

/**
 * Higher-order factory matching Phase 1.5's `FallbackCapsuleFactory.create`
 * signature. Returns a function `(input) => Promise<{ capsule, capsuleDigest }>`.
 * The seam collapses the per-field getters into a single call to
 * `createFallbackCapsule` and surfaces the resulting `digest` as the
 * `capsuleDigest` field the coordinator already expects.
 */
export function createFallbackCapsuleSeam(
  getters: CreateFallbackCapsuleSeamGetters
): (input: {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly pathGeneration: number;
}) => Promise<{ readonly capsule: ConvergenceCapsule; readonly capsuleDigest: string }> {
  return async (input) => {
    // Honor per-field overrides if the caller supplied them; otherwise
    // fall back to the bundled `getSourceState` getter.
    const state = getters.getSourceState();
    const goal = getters.getGoal ? getters.getGoal() : state.goal;
    const mode = getters.getMode ? getters.getMode() : state.mode;
    const cursor = getters.getCursor ? getters.getCursor() : state.cursor;
    const nextAction = getters.getNextAction ? getters.getNextAction() : state.nextAction;
    const tasks = getters.getActiveTasks();
    const capsule = createFallbackCapsule({
      attemptId: input.attemptId,
      sourceSessionId: input.sessionId,
      goal,
      mode,
      cursor,
      tasks,
      nextAction,
      now: getters.getNow
    });
    return { capsule, capsuleDigest: capsule.digest };
  };
}

// ── makeMockHostBridge ─────────────────────────────────────────────────────

/** Script selector the mock honours when emitting events / errors. */
export type MockScript = 'native-throws' | 'fallback-replaces' | 'native-resumes';

/** Options for `makeMockHostBridge`. All fields are optional with sane defaults. */
export interface MakeMockHostBridgeOptions {
  readonly profile?: CapabilityProfile;
  readonly completionSource?: 'host-event' | 'remeasure';
  readonly script?: MockScript;
  readonly eventSequences?: {
    readonly nativeEvents?: readonly CompactEvent[];
    readonly fallbackEvents?: readonly CompactEvent[];
  };
}

/** Strong-default capability profile the bridge advertises. */
export function strongDefaultProfile(): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'invoke-and-observe',
    contextReplacement: 'in-place',
    progressSurface: 'host-rendered',
    continuation: 'same-ui',
    completionSignal: 'event-with-measurement',
    rollbackSupport: 'transactional',
    capabilityEpoch: 'epoch-default'
  };
}

/** Mock-bridge attempts ledger exposed for test inspection. */
export interface MockAttemptsLedger {
  /** Map of bridge-call name → invocation count. Keys: probe, invokeNative,
   * replaceWithCapsule, measureContext, resume, inspectTransaction, rollback. */
  readonly calls: Map<string, number>;
}

export interface MockHostBridgeAttachment extends CertifiedBridgeAttachment {
  readonly attempts: { readonly bucket: MockAttemptsLedger };
}

/** Default §9-compliant fallback event stream the mock emits when no override is provided. */
export function defaultFallbackEvents(args: {
  readonly attemptId: string;
  readonly pathGeneration: number;
  readonly completionSource: 'host-event' | 'remeasure';
  readonly before: number;
  readonly after: number;
  readonly continuationToken: string;
}): readonly CompactEvent[] {
  const base: CompactEvent = {
    type: 'stage',
    attemptId: args.attemptId,
    pathGeneration: args.pathGeneration,
    stage: 'summarizing',
    label: 'Summarizing'
  };
  const replacing: CompactEvent = {
    type: 'stage',
    attemptId: args.attemptId,
    pathGeneration: args.pathGeneration,
    stage: 'replacing',
    label: 'Replacing'
  };
  const progress: CompactEvent = {
    type: 'progress',
    attemptId: args.attemptId,
    pathGeneration: args.pathGeneration,
    completed: 1,
    total: 2,
    unit: 'work'
  };
  const verifying: CompactEvent = {
    type: 'stage',
    attemptId: args.attemptId,
    pathGeneration: args.pathGeneration,
    stage: 'verifying',
    label: 'Verifying'
  };
  const receipt: CompactCompletionReceipt = {
    attemptId: args.attemptId,
    pathGeneration: args.pathGeneration,
    path: 'fallback',
    sameUi: true,
    before: { ratio: args.before, source: 'exact', measuredAt: '2026-07-23T00:00:00.000Z' },
    after: { ratio: args.after, source: 'exact', measuredAt: '2026-07-23T00:00:01.000Z' },
    completionSource: args.completionSource,
    continuationToken: args.continuationToken,
    completedAt: '2026-07-23T00:00:02.000Z'
  };
  const completed: CompactEvent = {
    type: 'completed',
    attemptId: args.attemptId,
    pathGeneration: args.pathGeneration,
    receipt
  };
  return [base, replacing, progress, verifying, completed];
}

/** Build a `MockHostBridgeAttachment`. Default profile, default script. */
export function makeMockHostBridge(
  options: MakeMockHostBridgeOptions = {}
): MockHostBridgeAttachment {
  const profile = options.profile ?? strongDefaultProfile();
  const completionSource = options.completionSource ?? 'host-event';
  const script = options.script;
  const calls = new Map<string, number>();
  const bump = (name: string): void => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
  };

  // Script-driven helpers.
  const fallbackThrows = script === 'fallback-replaces';
  const nativeThrows = script === 'native-throws';
  const resumeSameUiFalse = script === 'native-resumes';

  const bridge: HostCompactBridge = {
    async probe(_input: ProbeRequest): Promise<CapabilityProfile> {
      bump('probe');
      return profile;
    },
    invokeNative(input: NativeCompactRequest): AsyncIterable<CompactEvent> {
      bump('invokeNative');
      if (nativeThrows) {
        // Async-generator that throws on first next().
        return (async function* throwing(): AsyncIterable<CompactEvent> {
          throw new Error('native invoke rejected by script: native-throws');
          // unreachable yield; the throw above satisfies the generator
          // contract while keeping the function async.
          // eslint-disable-next-line no-unreachable
          yield { type: 'detail', attemptId: input.attemptId, pathGeneration: input.pathGeneration, message: 'unreachable' };
        })();
      }
      const events = options.eventSequences?.nativeEvents ?? defaultFallbackEvents({
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration,
        completionSource,
        before: 0.9,
        after: 0.4,
        continuationToken: 'tok-native-default'
      });
      return (async function* stream(): AsyncIterable<CompactEvent> {
        for (const event of events) {
          yield event;
        }
      })();
    },
    replaceWithCapsule(input: CapsuleReplacementRequest): AsyncIterable<CompactEvent> {
      bump('replaceWithCapsule');
      if (fallbackThrows) {
        return (async function* throwing(): AsyncIterable<CompactEvent> {
          throw new Error('fallback replace rejected by script: fallback-replaces');
          // unreachable yield keeps the function async.
          // eslint-disable-next-line no-unreachable
          yield { type: 'detail', attemptId: input.attemptId, pathGeneration: input.pathGeneration, message: 'unreachable' };
        })();
      }
      const events = options.eventSequences?.fallbackEvents ?? defaultFallbackEvents({
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration,
        completionSource,
        before: 0.9,
        after: 0.4,
        continuationToken: 'tok-fallback-default'
      });
      return (async function* stream(): AsyncIterable<CompactEvent> {
        for (const event of events) {
          yield event;
        }
      })();
    },
    async measureContext(input: MeasureContextRequest): Promise<ContextMeasurementReading> {
      bump('measureContext');
      return {
        ratio: 0.4,
        source: 'exact',
        measuredAt: '2026-07-23T00:00:00.000Z'
      };
      // Reference `input` so strict-TS flags unused param.
      void input;
    },
    async resume(input: ResumeRequest): Promise<ResumeReceipt> {
      bump('resume');
      return {
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration,
        continuationTokenDigest: sha256(input.continuationToken),
        // The script `native-resumes` breaks the §9.2 invariant by
        // returning `sameUi === false`. We assert at the boundary that
        // the literal `true` is the canonical resume shape; the script
        // emits the broken shape as a typed literal cast.
        sameUi: (resumeSameUiFalse ? false : true) as true,
        resumedAt: '2026-07-23T00:00:03.000Z'
      };
    },
    async inspectTransaction(input: InspectTransactionRequest): Promise<TransactionReceipt> {
      bump('inspectTransaction');
      return {
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration,
        state: 'unknown'
      };
    },
    async rollback(input: RollbackRequest): Promise<TransactionReceipt> {
      bump('rollback');
      return {
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration,
        state: 'rolled-back'
      };
    }
  };

  return {
    bridge,
    certification: 'certified-strong',
    manualMetadata: null,
    attempts: { bucket: { calls } }
  };
}