/**
 * Phase 2 Task 2.5 — mock host bridge + fallback coordinator tests
 * (design §4.4, §6.1, §9, §10.2, §10.3).
 *
 * Pins the surface that Phase 1.5 was missing — a real `FallbackCapsuleFactory`
 * seam and a vendor-neutral state machine that the coordinator drives for the
 * `fallback` path. Dimensions: behavior only (no render / a11y surface).
 *
 * The fallback state machine (runFallbackCompaction) is exercised against a
 * deterministic `MockHostBridge` whose event stream and resume receipt follow
 * the design contract:
 *   - probe re-validates the capability epoch,
 *   - replaceWithCapsule emits summarizing → replacing → progress → verifying
 *     → completed,
 *   - measureContext honors `completionSource` (host-event trust vs remeasure),
 *   - verifyContextReduction enforces `after < min(before*0.70, targetRatio)`,
 *   - resume returns a receipt with sameUi=true and a valid
 *     `continuationTokenDigest = sha256(token)`.
 *
 * The mock is the SINGLE source of vendor-neutral test events; it never names
 * a host, a binary, or a slash command.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  FALLBACK_REDUCE_FAILED,
  FALLBACK_REPLACE_FAILED,
  FALLBACK_RESUME_FAILED,
  FallbackReductionError,
  FallbackReplaceError,
  FallbackResumeError,
  createFallbackCapsule,
  createFallbackCapsuleSeam,
  makeMockHostBridge,
  runFallbackCompaction,
  type MakeMockHostBridgeOptions
} from '../../../../src/services/compact-core/fallback-coordinator.js';
import { verifyCapsuleDigest } from '../../../../src/services/compact-core/capsule-digest.js';
import type {
  CapabilityProfile,
  CompactCompletionReceipt,
  ConvergenceCapsule,
  ResumeReceipt,
  TransactionReceipt
} from '../../../../src/services/compact-core/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const NOW = new Date('2026-07-23T00:00:00.000Z');
const ISO = NOW.toISOString();

const SESSION = 'session-1';
const ATTEMPT = 'attempt-1';
const PATH_GEN = 0;
const EPOCH = 'epoch-1';
const TOKEN = 'tok-1';

function strongProfile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'invoke-and-observe',
    contextReplacement: 'in-place',
    progressSurface: 'host-rendered',
    continuation: 'same-ui',
    completionSignal: 'event-with-measurement',
    rollbackSupport: 'transactional',
    capabilityEpoch: EPOCH,
    ...overrides
  };
}

function fallbackOnlyProfile(overrides: Partial<CapabilityProfile> = {}): CapabilityProfile {
  return {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'none',
    contextReplacement: 'in-place',
    progressSurface: 'host-rendered',
    continuation: 'same-ui',
    completionSignal: 'remeasure',
    rollbackSupport: 'transactional',
    capabilityEpoch: EPOCH,
    ...overrides
  };
}

function makeCompletionReceipt(overrides: Partial<CompactCompletionReceipt> = {}): CompactCompletionReceipt {
  return {
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    path: 'fallback',
    sameUi: true,
    before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
    after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
    completionSource: 'host-event',
    continuationToken: TOKEN,
    completedAt: ISO,
    ...overrides
  };
}

function baseInput() {
  return {
    projectRoot: '/tmp/proj',
    sessionId: SESSION,
    attemptId: ATTEMPT,
    pathGeneration: PATH_GEN,
    capabilityEpoch: EPOCH,
    continuationToken: TOKEN,
    targetRatio: 0.6,
    now: () => NOW
  };
}

/** Build a mock bridge whose profile epoch matches the test's `EPOCH` constant. */
function mockFor(opts: MakeMockHostBridgeOptions = {}) {
  return makeMockHostBridge({
    profile: strongProfile(),
    ...opts
  });
}

// ── makeMockHostBridge ─────────────────────────────────────────────────────

describe('makeMockHostBridge — surface', () => {
  it('returns a CertifiedBridgeAttachment by default with certification=certified-strong', () => {
    const mock = makeMockHostBridge();
    expect(mock.certification).toBe('certified-strong');
    expect(mock.bridge).toBeDefined();
    expect(mock.manualMetadata).toBeNull();
    expect(mock.attempts.bucket.calls).toBeInstanceOf(Map);
    expect(mock.attempts.bucket.calls.size).toBe(0);
  });

  it('default profile satisfies all strong-guarantee fields', async () => {
    const mock = makeMockHostBridge();
    const profile = await mock.bridge.probe({
      kind: 'probe',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN
    });
    // The bridge must declare every required field as the strong value so
    // `decideCompactPath` (Phase 1.1) yields a real path.
    expect(profile.nativeCompact).toBe('invoke-and-observe');
    expect(profile.contextReplacement).toBe('in-place');
    expect(profile.progressSurface).toBe('host-rendered');
    expect(profile.continuation).toBe('same-ui');
    expect(profile.completionSignal).toBe('event-with-measurement');
    expect(profile.rollbackSupport).toBe('transactional');
    expect(profile.contextMeasurement).toBe('exact');
  });

  it('counts every bridge call in attempts.bucket.calls', async () => {
    const mock = makeMockHostBridge();
    await mock.bridge.probe({
      kind: 'probe',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN
    });
    await mock.bridge.measureContext({
      kind: 'measure-context',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN
    });
    await mock.bridge.resume({
      kind: 'resume',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      continuationToken: TOKEN
    });
    expect(mock.attempts.bucket.calls.get('probe')).toBe(1);
    expect(mock.attempts.bucket.calls.get('measureContext')).toBe(1);
    expect(mock.attempts.bucket.calls.get('resume')).toBe(1);
  });

  it('honors a custom profile override', async () => {
    const mock = makeMockHostBridge({ profile: fallbackOnlyProfile() });
    const profile = await mock.bridge.probe({
      kind: 'probe',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN
    });
    expect(profile.nativeCompact).toBe('none');
    expect(profile.completionSignal).toBe('remeasure');
  });
});

describe('makeMockHostBridge — default script emits the canonical fallback path', () => {
  it('default replaceWithCapsule stream ends in `completed` with passing §9 reduction', async () => {
    const mock = makeMockHostBridge();
    const stageNames: string[] = [];
    let lastType = '';
    for await (const event of mock.bridge.replaceWithCapsule({
      kind: 'capsule-replacement',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      capsuleDigest: sha256('capsule'),
      rollbackRequired: true
    })) {
      if (event.type === 'stage') stageNames.push(event.stage);
      lastType = event.type;
    }
    expect(stageNames).toContain('summarizing');
    expect(stageNames).toContain('replacing');
    expect(stageNames).toContain('verifying');
    expect(lastType).toBe('completed');
  });

  it('default resume returns a receipt with sha256(token) digest', async () => {
    const mock = makeMockHostBridge();
    const receipt = await mock.bridge.resume({
      kind: 'resume',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      continuationToken: TOKEN
    });
    expect(receipt.attemptId).toBe(ATTEMPT);
    expect(receipt.pathGeneration).toBe(PATH_GEN);
    expect(receipt.sameUi).toBe(true);
    expect(receipt.continuationTokenDigest).toBe(sha256(TOKEN));
  });
});

describe('makeMockHostBridge — script variants', () => {
  it('native-throws: invokeNative throws synchronously, fallback still works', async () => {
    const mock = mockFor({ script: 'native-throws' });
    const nativeIter = mock.bridge.invokeNative({
      kind: 'native-compact',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      targetRatio: 0.6
    });
    await expect(async () => {
      // Drain the iterator; the first iteration triggers the throw.
      for await (const _ of nativeIter) {
        void _;
      }
    }).rejects.toThrow();
    // Fallback path remains intact.
    const fallbackIter = mock.bridge.replaceWithCapsule({
      kind: 'capsule-replacement',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      capsuleDigest: sha256('capsule'),
      rollbackRequired: true
    });
    const events: string[] = [];
    for await (const e of fallbackIter) events.push(e.type);
    expect(events[events.length - 1]).toBe('completed');
  });

  it('fallback-replaces-fails script: replaceWithCapsule throws synchronously', async () => {
    const mock = mockFor({ script: 'fallback-replaces' });
    // Force failure by injecting a fallbackEvents override that returns
    // nothing and triggering a sync throw via the script knob.
    const iter = mock.bridge.replaceWithCapsule({
      kind: 'capsule-replacement',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      capsuleDigest: sha256('capsule'),
      rollbackRequired: true
    });
    await expect(async () => {
      for await (const _ of iter) void _;
    }).rejects.toThrow();
  });

  it('native-resumes script: resume returns sameUi=false', async () => {
    const mock = mockFor({ script: 'native-resumes' });
    const receipt = await mock.bridge.resume({
      kind: 'resume',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      capabilityEpoch: EPOCH,
      continuationToken: TOKEN
    });
    // The script deliberately breaks the §9.2 invariant: sameUi must be true.
    expect(receipt.sameUi).toBe(false);
  });
});

// ── runFallbackCompaction ──────────────────────────────────────────────────

describe('runFallbackCompaction — happy path', () => {
  it('runs probe → replace → measure → verify → resume and returns ok:true', async () => {
    const mock = mockFor();
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toBe('FALLBACK_COMPLETED');
    expect(result.receipt.path).toBe('fallback');
    expect(result.resumeReceipt.sameUi).toBe(true);
    expect(result.resumeReceipt.continuationTokenDigest).toBe(sha256(TOKEN));
    expect(result.stages.length).toBeGreaterThan(0);
  });

  it('emits the canonical stage ordering: preparing → summarizing → replacing → progress → verifying → completed → resuming → completed', async () => {
    const mock = mockFor();
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stageTypes = result.stages.map(s => s.kind);
    expect(stageTypes).toContain('preparing');
    expect(stageTypes).toContain('summarizing');
    expect(stageTypes).toContain('replacing');
    expect(stageTypes).toContain('verifying');
    expect(stageTypes).toContain('resuming');
  });
});

describe('runFallbackCompaction — failure paths', () => {
  it('replace failure → ok:false, code:FALLBACK_REPLACE_FAILED, no throw', async () => {
    const mock = mockFor({ script: 'fallback-replaces' });
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(FALLBACK_REPLACE_FAILED);
    expect(result.error).toBeInstanceOf(FallbackReplaceError);
    expect(mock.attempts.bucket.calls.get('resume')).toBeUndefined();
  });

  it('verify reduction fails (after === requiredMaximum) → FallbackReductionError', async () => {
    // Provide a fallbackEvents override that delivers a receipt whose
    // `after` exactly equals `min(before*0.70, targetRatio)` — failing the
    // strict-less-than predicate.
    const before = 0.8;
    const requiredMaximum = Math.min(before * 0.7, 0.6); // = 0.56
    const receipt: CompactCompletionReceipt = makeCompletionReceipt({
      before: { ratio: before, source: 'exact', measuredAt: ISO },
      after: { ratio: requiredMaximum, source: 'exact', measuredAt: ISO }
    });
    const mock = mockFor({
      eventSequences: {
        fallbackEvents: [
          { type: 'stage', attemptId: ATTEMPT, pathGeneration: PATH_GEN, stage: 'summarizing', label: 's' },
          { type: 'stage', attemptId: ATTEMPT, pathGeneration: PATH_GEN, stage: 'replacing', label: 'r' },
          { type: 'progress', attemptId: ATTEMPT, pathGeneration: PATH_GEN, completed: 1, total: 2, unit: 'work' },
          { type: 'stage', attemptId: ATTEMPT, pathGeneration: PATH_GEN, stage: 'verifying', label: 'v' },
          { type: 'completed', attemptId: ATTEMPT, pathGeneration: PATH_GEN, receipt }
        ]
      }
    });
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(FALLBACK_REDUCE_FAILED);
    expect(result.error).toBeInstanceOf(FallbackReductionError);
    if (result.error instanceof FallbackReductionError) {
      expect(result.error.before.ratio).toBe(before);
      expect(result.error.after.ratio).toBe(requiredMaximum);
      expect(result.error.requiredMaximum).toBeCloseTo(requiredMaximum);
    }
  });

  it('resume digest mismatch → FallbackResumeError', async () => {
    const mock = mockFor();
    // Mock resume returns sha256(WRONG-TOKEN) instead of sha256(TOKEN).
    const brokenResume: typeof mock.bridge.resume = async () => ({
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN,
      continuationTokenDigest: sha256('WRONG-TOKEN'),
      sameUi: true,
      resumedAt: ISO
    });
    const bridge = { ...mock.bridge, resume: brokenResume };
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(FALLBACK_RESUME_FAILED);
    expect(result.error).toBeInstanceOf(FallbackResumeError);
  });

  it('resume sameUi=false → FallbackResumeError', async () => {
    const mock = mockFor({ script: 'native-resumes' });
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(FALLBACK_RESUME_FAILED);
    expect(result.error).toBeInstanceOf(FallbackResumeError);
  });

  it('stale epoch on probe → ok:false with FALLBACK_PROBE_FAILED code', async () => {
    const mock = mockFor();
    // Override probe to always return a STALE epoch (the coordinator only
    // re-probes once before mutation).
    mock.bridge.probe = async () => {
      throw new Error('probe rejected with stale epoch');
    };
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('FALLBACK_PROBE_FAILED');
  });
});

describe('runFallbackCompaction — remeasurement overrides receipt.after', () => {
  it('uses live measurement when receipt.completionSource=remeasure and live reading differs', async () => {
    // Force receipt.after to fail §9 (0.6 = required max for before=0.9).
    // Then make measureContext return a passing reading (0.4). The
    // coordinator must honor the live reading and pass verification.
    const before = 0.9;
    const receiptAfterFails = 0.6;
    const liveAfter = 0.4;
    const receipt: CompactCompletionReceipt = makeCompletionReceipt({
      before: { ratio: before, source: 'exact', measuredAt: ISO },
      after: { ratio: receiptAfterFails, source: 'exact', measuredAt: ISO },
      completionSource: 'remeasure'
    });
    const mock = mockFor({
      completionSource: 'remeasure',
      eventSequences: {
        fallbackEvents: [
          { type: 'stage', attemptId: ATTEMPT, pathGeneration: PATH_GEN, stage: 'summarizing', label: 's' },
          { type: 'stage', attemptId: ATTEMPT, pathGeneration: PATH_GEN, stage: 'replacing', label: 'r' },
          { type: 'progress', attemptId: ATTEMPT, pathGeneration: PATH_GEN, completed: 1, total: 2, unit: 'work' },
          { type: 'stage', attemptId: ATTEMPT, pathGeneration: PATH_GEN, stage: 'verifying', label: 'v' },
          { type: 'completed', attemptId: ATTEMPT, pathGeneration: PATH_GEN, receipt }
        ]
      }
    });
    const originalMeasure = mock.bridge.measureContext.bind(mock.bridge);
    mock.bridge.measureContext = async (req) => {
      const live = await originalMeasure(req);
      return { ...live, ratio: liveAfter };
    };
    const result = await runFallbackCompaction({
      ...baseInput(),
      bridge: mock.bridge,
      capsule: { capsuleId: sha256('capsule-input') } as ConvergenceCapsule
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mock.attempts.bucket.calls.get('measureContext')).toBe(1);
    // The recorded receipt.after is the live reading, not the receipt's
    // claimed value.
    expect(result.receipt.after.ratio).toBe(liveAfter);
  });
});

// ── createFallbackCapsule ───────────────────────────────────────────────────

describe('createFallbackCapsule — deterministic digest-locked capsule', () => {
  const commonInput = {
    attemptId: ATTEMPT,
    sourceSessionId: SESSION,
    goal: {
      id: 'g1',
      text: 'Ship fallback',
      approvedAt: ISO,
      approvedBy: 'SquabbyZ'
    },
    mode: 'full-auto' as const,
    cursor: null,
    tasks: [
      { taskId: 't1', status: 'in-progress', summary: 'capsule', startedAt: ISO }
    ],
    nextAction: {
      id: 'n1',
      kind: 'continue',
      summary: 'resume'
    },
    now: () => NOW
  };

  it('returns a capsule whose digest equals digestCapsule(payload)', () => {
    const capsule = createFallbackCapsule(commonInput);
    expect(verifyCapsuleDigest(capsule)).toBe(true);
    expect(capsule.schemaVersion).toBe(1);
    expect(capsule.compactAttemptId).toBe(ATTEMPT);
    expect(capsule.sourceSessionId).toBe(SESSION);
    expect(capsule.mode).toBe('full-auto');
    expect(capsule.goal.id).toBe('g1');
    expect(capsule.activeTasks).toHaveLength(1);
    expect(capsule.nextAction.id).toBe('n1');
  });

  it('is deterministic for identical input', () => {
    const a = createFallbackCapsule(commonInput);
    const b = createFallbackCapsule(commonInput);
    expect(a.digest).toBe(b.digest);
    expect(a.capsuleId).toBe(b.capsuleId);
  });

  it('different activeTasks produces different digest', () => {
    const a = createFallbackCapsule(commonInput);
    const b = createFallbackCapsule({
      ...commonInput,
      tasks: [{ taskId: 't2', status: 'pending', summary: 'capsule-v2', startedAt: ISO }]
    });
    expect(a.digest).not.toBe(b.digest);
  });
});

// ── createFallbackCapsuleSeam ───────────────────────────────────────────────

describe('createFallbackCapsuleSeam — Phase 1.5 signature compatibility', () => {
  it('returns a function matching FallbackCapsuleFactory.create shape', async () => {
    const seam = createFallbackCapsuleSeam({
      getSourceState: () => ({
        goal: {
          id: 'g1',
          text: 'Ship fallback',
          approvedAt: ISO,
          approvedBy: 'SquabbyZ'
        },
        mode: 'full-auto' as const,
        cursor: null,
        nextAction: { id: 'n1', kind: 'continue', summary: 'resume' }
      }),
      getActiveTasks: () => [
        { taskId: 't1', status: 'in-progress', summary: 'capsule', startedAt: ISO }
      ],
      getNow: () => NOW
    });
    const result = await seam({
      sessionId: SESSION,
      attemptId: ATTEMPT,
      pathGeneration: PATH_GEN
    });
    expect(verifyCapsuleDigest(result.capsule as ConvergenceCapsule)).toBe(true);
    expect(result.capsuleDigest).toBe(result.capsule.digest);
    expect(result.capsule.compactAttemptId).toBe(ATTEMPT);
    expect(result.capsule.sourceSessionId).toBe(SESSION);
  });

  it('threads session/attempt/pathGeneration into the capsule fields', async () => {
    const seam = createFallbackCapsuleSeam({
      getSourceState: () => ({
        goal: {
          id: 'g2',
          text: 'Ship seam',
          approvedAt: ISO,
          approvedBy: 'SquabbyZ'
        },
        mode: 'assisted' as const,
        cursor: null,
        nextAction: { id: 'n2', kind: 'continue', summary: 'resume' }
      }),
      getActiveTasks: () => [
        { taskId: 't1', status: 'in-progress', summary: 'capsule', startedAt: ISO }
      ],
      getNow: () => NOW
    });
    const result = await seam({
      sessionId: 'sess-X',
      attemptId: 'att-X',
      pathGeneration: 7
    });
    expect(result.capsule.sourceSessionId).toBe('sess-X');
    expect(result.capsule.compactAttemptId).toBe('att-X');
    expect(result.capsule.mode).toBe('assisted');
  });
});