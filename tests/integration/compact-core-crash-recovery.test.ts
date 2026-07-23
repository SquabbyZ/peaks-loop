/**
 * Phase 2 Task 2.7 — crash recovery end-to-end (design §10.5).
 *
 * Simulates SIGKILL mid-path by writing a journal with a real
 * `lastPersistedStage` value (the §6.1 state at which the process
 * died), then constructs a fresh `AttemptStore` + `FallbackCoordinator`
 * from a `createFallbackCapsuleSeam` and calls `resumeAttemptFromJournal`.
 *
 * The store is an in-process fake (Map-keyed) — no real fs journal
 * writes — and must satisfy the `AttemptStore` shape so the recovery
 * orchestrator can dispatch.
 *
 * Stages pinned (one row per stage):
 *   - probing    → resume-pre-stage; mock emits a clean path → FALLBACK_COMPLETED.
 *   - replacing  → resume-replacing; non-empty sealed keys; the same
 *                  attempt id re-enters the capsule path.
 *   - verifying  → resume-verifying; the same id re-runs the
 *                  measureContext + verify step.
 *   - completed  → returns FALLBACK_COMPLETED with 0 mutating calls.
 *
 * The mock + coordinator pair is bound at construction; each test
 * asserts at least one observable side effect (return value, journal
 * state, attempt count, or event count).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  createFallbackCapsule,
  createFallbackCapsuleSeam,
  defaultFallbackEvents,
  makeMockHostBridge,
  runFallbackCompaction,
  type FallbackCoordinationInput,
  type FallbackCoordinationResult
} from '../../src/services/compact-core/fallback-coordinator.js';
import { resumeAttemptFromJournal } from '../../src/services/compact-core/recovery.js';
import type {
  AttemptStore,
  CompactAttemptJournal,
  CompactJournalStage
} from '../../src/services/compact-core/attempt-store.js';
import type {
  ConvergenceCapsule,
  HostCompactBridge
} from '../../src/services/compact-core/index.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const FIXED_NOW = new Date('2026-07-23T12:00:00.000Z');
const ISO = FIXED_NOW.toISOString();
const SESSION = 'sess-cr-1';
const ATTEMPT = 'attempt-cr-1';
const NEXT_ATTEMPT = 'attempt-cr-1-next';
// Match `strongDefaultProfile().capabilityEpoch` so probe() passes
// when the recovery dispatches runFallbackCompaction with this epoch.
const EPOCH = 'epoch-default';
const TOKEN = 'tok-cr-1';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const VALID_DIGEST = sha256('seed');

interface FakeStoreState {
  readonly journals: Map<string, CompactAttemptJournal>;
}

function makeFakeStore(state: FakeStoreState): AttemptStore {
  return {
    async writeAttempt(journal) {
      state.journals.set(journal.attemptId, { ...journal });
    },
    async readAttempt(attemptId) {
      const found = state.journals.get(attemptId);
      return found ? { ...found } : null;
    },
    async sealIdempotencyKey(attemptId, key) {
      const cur = state.journals.get(attemptId);
      if (!cur) throw new Error('no journal');
      const merged: CompactAttemptJournal = {
        ...cur,
        sealedIdempotencyKeys: cur.sealedIdempotencyKeys.includes(key)
          ? cur.sealedIdempotencyKeys
          : [...cur.sealedIdempotencyKeys, key],
        updatedAt: ISO
      };
      state.journals.set(attemptId, merged);
    },
    async readSessionCircuit() {
      return {
        schemaVersion: 1,
        sessionId: SESSION,
        consecutiveVerificationFailures: 0,
        circuit: 'closed',
        openedAt: null,
        lastAttemptId: null,
        lastFailureCode: null,
        manualPromptShown: false
      };
    },
    async writeSessionCircuit(stateIn) {
      return { ...stateIn };
    },
    async recordVerificationFailure(attemptId, code) {
      return {
        schemaVersion: 1,
        sessionId: SESSION,
        consecutiveVerificationFailures: 1,
        circuit: 'closed',
        openedAt: null,
        lastAttemptId: attemptId,
        lastFailureCode: code,
        manualPromptShown: false
      };
    },
    async markManualPromptShown() {
      void 0;
    },
    async markVerificationRecovered() {
      return {
        schemaVersion: 1,
        sessionId: SESSION,
        consecutiveVerificationFailures: 0,
        circuit: 'closed',
        openedAt: null,
        lastAttemptId: null,
        lastFailureCode: null,
        manualPromptShown: false
      };
    },
    async resetVerificationFailures() {
      void 0;
    }
  };
}

function newJournal(overrides: Partial<CompactAttemptJournal> = {}): CompactAttemptJournal {
  return {
    schemaVersion: 1,
    sessionId: SESSION,
    attemptId: ATTEMPT,
    pathGeneration: 0,
    stage: 'preparing',
    verificationFailureCount: 0,
    capabilityEpoch: EPOCH,
    sealedIdempotencyKeys: [],
    lastFailureCode: null,
    createdAt: ISO,
    updatedAt: ISO,
    digest: VALID_DIGEST,
    ...overrides
  };
}

function buildCapsule(): ConvergenceCapsule {
  return createFallbackCapsule({
    attemptId: ATTEMPT,
    sourceSessionId: SESSION,
    goal: { id: 'g-cr', text: 'CR', approvedAt: ISO, approvedBy: 'SquabbyZ' },
    mode: 'full-auto',
    cursor: null,
    tasks: [{ taskId: 't1', status: 'in-progress', summary: 'cr', startedAt: ISO }],
    nextAction: { id: 'n1', kind: 'continue', summary: 'go' },
    now: () => FIXED_NOW
  });
}

function makeCohort(): {
  state: FakeStoreState;
  store: AttemptStore;
  mock: ReturnType<typeof makeMockHostBridge>;
  bridge: HostCompactBridge;
  capsule: ConvergenceCapsule;
} {
  const state: FakeStoreState = { journals: new Map() };
  const store = makeFakeStore(state);
  const mock = makeMockHostBridge();
  return { state, store, mock, bridge: mock.bridge, capsule: buildCapsule() };
}

function recordingCoordinator(
  result: FallbackCoordinationResult
): {
  readonly fn: (input: FallbackCoordinationInput) => Promise<FallbackCoordinationResult>;
  readonly calls: FallbackCoordinationInput[];
} {
  const calls: FallbackCoordinationInput[] = [];
  const fn = async (input: FallbackCoordinationInput): Promise<FallbackCoordinationResult> => {
    calls.push(input);
    return result;
  };
  return { fn, calls };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('compact-core crash recovery (design §10.5)', () => {
  let state: FakeStoreState;
  let store: AttemptStore;
  let mock: ReturnType<typeof makeMockHostBridge>;
  let bridge: HostCompactBridge;
  let capsule: ConvergenceCapsule;

  beforeEach(() => {
    const c = makeCohort();
    state = c.state;
    store = c.store;
    mock = c.mock;
    bridge = c.bridge;
    capsule = c.capsule;
  });

  it('probing stage → resume-pre-stage; fallback returns FALLBACK_COMPLETED', async () => {
    const journal = newJournal({ stage: 'probing', pathGeneration: 0 });
    state.journals.set(ATTEMPT, journal);
    const completed: FallbackCoordinationResult = {
      ok: true,
      code: 'FALLBACK_COMPLETED',
      receipt: {
        attemptId: ATTEMPT,
        pathGeneration: 0,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
        completionSource: 'host-event',
        continuationToken: TOKEN,
        completedAt: ISO
      },
      resumeReceipt: {
        attemptId: ATTEMPT,
        pathGeneration: 0,
        continuationTokenDigest: sha256(TOKEN),
        sameUi: true,
        resumedAt: ISO
      },
      stages: [{ kind: 'completed' }]
    };
    const { fn, calls } = recordingCoordinator(completed);
    const result = await resumeAttemptFromJournal({
      projectRoot: '/tmp/proj-cr',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: FIXED_NOW,
      bridge,
      capsule,
      targetRatio: 0.6,
      continuationToken: TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'probing' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.attemptId).toBe(ATTEMPT);
    expect(calls[0]?.pathGeneration).toBe(0);
    expect(result.coordinationResult).toBeDefined();
    expect(result.coordinationResult?.ok).toBe(true);
    // Journal was NOT mutated by the recovery call itself.
    expect(state.journals.get(ATTEMPT)?.stage).toBe('probing');
  });

  it('replacing stage with non-empty sealedKeys → resume-replacing; same attempt id re-enters the capsule path', async () => {
    const journal = newJournal({
      stage: 'replacing',
      pathGeneration: 1,
      sealedIdempotencyKeys: ['txn-001', 'txn-002']
    });
    state.journals.set(ATTEMPT, journal);
    const completed: FallbackCoordinationResult = {
      ok: true,
      code: 'FALLBACK_COMPLETED',
      receipt: {
        attemptId: ATTEMPT,
        pathGeneration: 2,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
        completionSource: 'host-event',
        continuationToken: TOKEN,
        completedAt: ISO
      },
      resumeReceipt: {
        attemptId: ATTEMPT,
        pathGeneration: 2,
        continuationTokenDigest: sha256(TOKEN),
        sameUi: true,
        resumedAt: ISO
      },
      stages: [{ kind: 'completed' }]
    };
    const { fn, calls } = recordingCoordinator(completed);
    const result = await resumeAttemptFromJournal({
      projectRoot: '/tmp/proj-cr',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: FIXED_NOW,
      bridge,
      capsule,
      targetRatio: 0.6,
      continuationToken: TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-replacing', transactionId: 'txn-001' });
    expect(calls).toHaveLength(1);
    // The same attempt id (NOT nextAttemptId) is dispatched.
    expect(calls[0]?.attemptId).toBe(ATTEMPT);
    // pathGeneration incremented by 1 (previous generation failed at replacing).
    expect(calls[0]?.pathGeneration).toBe(2);
    expect(result.coordinationResult?.ok).toBe(true);
  });

  it('verifying stage → resume-verifying; same id re-entered with bumped pathGeneration', async () => {
    const journal = newJournal({ stage: 'verifying', pathGeneration: 0 });
    state.journals.set(ATTEMPT, journal);
    // Build a bridge that echoes the request's pathGeneration so the
    // bumped pathGeneration from `verifying → +1` survives filtering.
    const events = defaultFallbackEvents({
      attemptId: ATTEMPT,
      pathGeneration: 1,
      completionSource: 'remeasure',
      before: 0.9,
      after: 0.4,
      continuationToken: TOKEN
    });
    let measureCalls = 0;
    const compositeBridge: HostCompactBridge = {
      ...bridge,
      replaceWithCapsule() {
        return (async function* echo(): AsyncIterable<typeof events[number]> {
          for (const event of events) yield event;
        })();
      },
      async measureContext() {
        measureCalls += 1;
        return { ratio: 0.35, source: 'exact', measuredAt: ISO };
      }
    };
    const captured: FallbackCoordinationInput[] = [];
    const fn = async (input: FallbackCoordinationInput): Promise<FallbackCoordinationResult> => {
      captured.push(input);
      return runFallbackCompaction({ ...input, bridge: compositeBridge });
    };
    const result = await resumeAttemptFromJournal({
      projectRoot: '/tmp/proj-cr',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: FIXED_NOW,
      bridge: compositeBridge,
      capsule,
      targetRatio: 0.6,
      continuationToken: TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-verifying' });
    // The orchestrator dispatched the fallback coordinator with the
    // SAME attempt id (NOT nextAttemptId) and pathGeneration bumped
    // by 1.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.attemptId).toBe(ATTEMPT);
    expect(captured[0]?.pathGeneration).toBe(1);
    expect(result.coordinationResult?.ok).toBe(true);
    expect(measureCalls).toBeGreaterThanOrEqual(1);
  });

  it('completed stage → returns FALLBACK_COMPLETED in 0 mutating calls', async () => {
    const journal = newJournal({ stage: 'completed', pathGeneration: 1 });
    state.journals.set(ATTEMPT, journal);
    const completed: FallbackCoordinationResult = {
      ok: true,
      code: 'FALLBACK_COMPLETED',
      receipt: {
        attemptId: ATTEMPT,
        pathGeneration: 1,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
        completionSource: 'host-event',
        continuationToken: TOKEN,
        completedAt: ISO
      },
      resumeReceipt: {
        attemptId: ATTEMPT,
        pathGeneration: 1,
        continuationTokenDigest: sha256(TOKEN),
        sameUi: true,
        resumedAt: ISO
      },
      stages: [{ kind: 'completed' }]
    };
    const { fn, calls } = recordingCoordinator(completed);
    const result = await resumeAttemptFromJournal({
      projectRoot: '/tmp/proj-cr',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: FIXED_NOW,
      bridge,
      capsule,
      targetRatio: 0.6,
      continuationToken: TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'completed' });
    // No coordinator dispatch and no coordinationResult.
    expect(calls).toHaveLength(0);
    expect(result.coordinationResult).toBeUndefined();
    // The journal is unchanged.
    expect(state.journals.get(ATTEMPT)?.stage).toBe('completed');
  });

  it('abandons a journal older than 7 days (stale-abandon path)', async () => {
    const stale = new Date(FIXED_NOW.getTime() - SEVEN_DAYS_MS - 1).toISOString();
    const journal = newJournal({ stage: 'preparing', createdAt: stale, updatedAt: stale });
    state.journals.set(ATTEMPT, journal);
    const completed: FallbackCoordinationResult = {
      ok: true,
      code: 'FALLBACK_COMPLETED',
      receipt: {
        attemptId: ATTEMPT,
        pathGeneration: 0,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
        completionSource: 'host-event',
        continuationToken: TOKEN,
        completedAt: ISO
      },
      resumeReceipt: {
        attemptId: ATTEMPT,
        pathGeneration: 0,
        continuationTokenDigest: sha256(TOKEN),
        sameUi: true,
        resumedAt: ISO
      },
      stages: [{ kind: 'completed' }]
    };
    const { fn, calls } = recordingCoordinator(completed);
    const result = await resumeAttemptFromJournal({
      projectRoot: '/tmp/proj-cr',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: FIXED_NOW,
      bridge,
      capsule,
      targetRatio: 0.6,
      continuationToken: TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'abandon', code: 'JOURNAL_STALE' });
    expect(calls).toHaveLength(0);
    expect(result.nextAttemptId).toBe(NEXT_ATTEMPT);
  });
});

describe('compact-core crash recovery — fallback seam (Phase 1.5 signature)', () => {
  it('createFallbackCapsuleSeam feeds the orchestrator with the same attempt id', async () => {
    const state: FakeStoreState = { journals: new Map() };
    const store = makeFakeStore(state);
    const stage: CompactJournalStage = 'preparing';
    const journal = newJournal({ stage, pathGeneration: 0 });
    state.journals.set(ATTEMPT, journal);
    const seam = createFallbackCapsuleSeam({
      getSourceState: () => ({
        goal: { id: 'g-cr2', text: 'CR2', approvedAt: ISO, approvedBy: 'SquabbyZ' },
        mode: 'full-auto',
        cursor: null,
        nextAction: { id: 'n2', kind: 'continue', summary: 'go' }
      }),
      getActiveTasks: () => [
        { taskId: 't-cr2', status: 'in-progress', summary: 'cr2', startedAt: ISO }
      ],
      getNow: () => FIXED_NOW
    });
    let seamCapsuleId: string | null = null;
    const completed: FallbackCoordinationResult = {
      ok: true,
      code: 'FALLBACK_COMPLETED',
      receipt: {
        attemptId: ATTEMPT,
        pathGeneration: 0,
        path: 'fallback',
        sameUi: true,
        before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
        after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
        completionSource: 'host-event',
        continuationToken: TOKEN,
        completedAt: ISO
      },
      resumeReceipt: {
        attemptId: ATTEMPT,
        pathGeneration: 0,
        continuationTokenDigest: sha256(TOKEN),
        sameUi: true,
        resumedAt: ISO
      },
      stages: [{ kind: 'completed' }]
    };
    const fn = async (input: FallbackCoordinationInput): Promise<FallbackCoordinationResult> => {
      const built = await seam({
        sessionId: input.sessionId,
        attemptId: input.attemptId,
        pathGeneration: input.pathGeneration
      });
      seamCapsuleId = built.capsule.capsuleId;
      return completed;
    };
    const mock = makeMockHostBridge();
    const result = await resumeAttemptFromJournal({
      projectRoot: '/tmp/proj-cr',
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: FIXED_NOW,
      bridge: mock.bridge,
      capsule: buildCapsule(),
      targetRatio: 0.6,
      continuationToken: TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-pre-stage', targetStage: stage });
    expect(seamCapsuleId).not.toBeNull();
  });
});
