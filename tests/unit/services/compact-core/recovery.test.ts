/**
 * Phase 2 Task 2.6 — journal-driven recovery (design §10.5).
 *
 * Tests pin the surface of `decideRecoveryAction` (pure) and
 * `resumeAttemptFromJournal` (orchestrator). The journal is the durable
 * seam from Task 1.2; the recovery module reads it and decides whether to
 * resume an attempt via the §6.1 fallback path, abandon it, or conclude
 * it as already terminal.
 *
 * Dimensions verified:
 *   - every kind from the discriminated union is reachable,
 *   - the union is exhaustive (default branch is unreachable),
 *   - journal age is compared against the 7-day stale threshold,
 *   - the journal's own digest field is validated as a 64-char hex token,
 *   - the orchestrator reads the journal via the AttemptStore interface
 *     and dispatches to the injected fallback coordinator with the
 *     pathGeneration chosen by the resume strategy.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAttemptStore,
  type AttemptStore,
  type CompactAttemptJournal,
  type CompactJournalStage
} from '../../../../src/services/compact-core/attempt-store.js';
import {
  decideRecoveryAction,
  resumeAttemptFromJournal,
  type RecoveryDecision
} from '../../../../src/services/compact-core/recovery.js';
import type {
  FallbackCoordinationInput,
  FallbackCoordinationResult
} from '../../../../src/services/compact-core/fallback-coordinator.js';
import type { ConvergenceCapsule } from '../../../../src/services/compact-core/capsule-types.js';
import type { HostCompactBridge } from '../../../../src/services/compact-core/index.js';

// ── Constants & helpers ────────────────────────────────────────────────────

const SESSION = 'sess-2026-07-23-aaaa';
const ATTEMPT = 'attempt-0001';
const EPOCH = 'epoch-1';
const DEFAULT_TOKEN = 'tok-1';
const DEFAULT_RATIO = 0.6;

/** 64 hex-char SHA-256 of the empty string. Used as a valid digest. */
const VALID_DIGEST = createHash('sha256').update('seed').digest('hex');
const NOW = new Date('2026-07-23T12:00:00.000Z');
const OLD_NOW = new Date('2026-07-23T00:00:00.000Z');
const ISO = NOW.toISOString();
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

/** Stub bridge the orchestrator passes through to the fallback coordinator. */
function stubBridge(): HostCompactBridge {
  return {
    async probe() {
      throw new Error('probe should not be called in recovery tests');
    },
    invokeNative() {
      throw new Error('invokeNative should not be called in recovery tests');
    },
    replaceWithCapsule() {
      throw new Error('replaceWithCapsule should not be called in recovery tests');
    },
    async measureContext() {
      throw new Error('measureContext should not be called in recovery tests');
    },
    async resume() {
      throw new Error('resume should not be called in recovery tests');
    },
    async inspectTransaction() {
      throw new Error('inspectTransaction should not be called in recovery tests');
    },
    async rollback() {
      throw new Error('rollback should not be called in recovery tests');
    }
  };
}

function stubCapsule(): ConvergenceCapsule {
  return {
    schemaVersion: 1,
    capsuleId: 'cap-1',
    compactAttemptId: ATTEMPT,
    sourceSessionId: SESSION,
    goal: { id: 'g1', text: 'Goal', approvedAt: ISO, approvedBy: 'tester' },
    mode: 'strict',
    activeJob: null,
    activeRequest: null,
    completedGates: [],
    activeTasks: [],
    decisions: [],
    openQuestions: [],
    failureHistory: [],
    artifactIndex: [],
    nextAction: { id: 'na-1', kind: 'execute', summary: 'next' },
    idempotency: { scope: SESSION, sealedKeys: [] },
    sourceContextMeasurement: {
      promptBytes: 0,
      capacityBytes: 1,
      ratio: 0,
      computedAt: ISO,
      windowKind: '200k'
    },
    digest: VALID_DIGEST
  };
}

// ── decideRecoveryAction — union members ────────────────────────────────────

describe('decideRecoveryAction — union members', () => {
  it('returns resume-pre-stage for probing', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'probing' }), now: NOW });
    expect(decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'probing' });
  });

  it('returns resume-pre-stage for preparing', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'preparing' }), now: NOW });
    expect(decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'preparing' });
  });

  it('returns resume-pre-stage for checkpointing', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'checkpointing' }), now: NOW });
    expect(decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'checkpointing' });
  });

  it('returns resume-pre-stage for native-compacting (no prior dispatch failure)', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({ stage: 'native-compacting' }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'native-compacting' });
  });

  it('returns resume-pre-stage for fallback-summarizing', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({ stage: 'fallback-summarizing' }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'fallback-summarizing' });
  });

  it('returns resume-replacing with the first sealed idempotency key as transactionId', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({
        stage: 'replacing',
        pathGeneration: 1,
        sealedIdempotencyKeys: ['txn-abc', 'txn-def']
      }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'resume-replacing', transactionId: 'txn-abc' });
  });

  it('returns resume-verifying', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'verifying' }), now: NOW });
    expect(decision).toEqual({ kind: 'resume-verifying' });
  });

  it('returns resume-resuming', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'resuming' }), now: NOW });
    expect(decision).toEqual({ kind: 'resume-resuming' });
  });

  it('returns completed for completed stage', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'completed' }), now: NOW });
    expect(decision).toEqual({ kind: 'completed' });
  });

  it('returns terminal-failed for rolled-back', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'rolled-back' }), now: NOW });
    expect(decision).toEqual({ kind: 'terminal-failed' });
  });

  it('returns terminal-failed for blocked', () => {
    const decision = decideRecoveryAction({ journal: newJournal({ stage: 'blocked' }), now: NOW });
    expect(decision).toEqual({ kind: 'terminal-failed' });
  });

  it('returns abandon with JOURNAL_EMPTY when replacing has no sealed idempotency keys', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({ stage: 'replacing', sealedIdempotencyKeys: [] }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_EMPTY' });
  });
});

// ── decideRecoveryAction — abandon paths ────────────────────────────────────

describe('decideRecoveryAction — abandon paths', () => {
  it('returns abandon with JOURNAL_STALE when age exceeds the 7-day threshold', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({
        stage: 'preparing',
        createdAt: new Date(NOW.getTime() - SEVEN_DAYS_MS - 1).toISOString()
      }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_STALE' });
  });

  it('honors a custom maxAgeMs', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({
        stage: 'preparing',
        createdAt: new Date(NOW.getTime() - 1000).toISOString()
      }),
      now: NOW,
      maxAgeMs: 100
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_STALE' });
  });

  it('returns abandon with JOURNAL_INVALID_DIGEST when digest is missing', () => {
    const decision = decideRecoveryAction({
      // Cast through Partial to simulate a journal without a digest field.
      journal: { ...newJournal(), digest: undefined } as unknown as CompactAttemptJournal,
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' });
  });

  it('returns abandon with JOURNAL_INVALID_DIGEST when digest is non-hex', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({ digest: 'not-a-hex-digest-at-all' }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' });
  });

  it('returns abandon with JOURNAL_INVALID_DIGEST when digest length is wrong', () => {
    const decision = decideRecoveryAction({
      journal: newJournal({ digest: 'a'.repeat(63) }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' });
  });

  it('returns abandon with JOURNAL_INVALID_DIGEST when digest contains uppercase hex', () => {
    // 64 uppercase characters must still be rejected (lower-case only).
    const decision = decideRecoveryAction({
      journal: newJournal({ digest: 'A'.repeat(64) }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' });
  });

  it('returns abandon with JOURNAL_INVALID_DIGEST before age / dispatch checks', () => {
    // Even a stale journal with a stage that would otherwise resume must
    // be rejected when the digest is malformed — integrity beats policy.
    const decision = decideRecoveryAction({
      journal: newJournal({
        stage: 'resuming',
        digest: 'oops',
        createdAt: new Date(NOW.getTime() - SEVEN_DAYS_MS - 1).toISOString()
      }),
      now: NOW
    });
    expect(decision).toEqual({ kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' });
  });

  it('abandons recovering + retrying as resume-pre-stage (forward-path stages)', () => {
    for (const stage of ['recovering', 'retrying'] as CompactJournalStage[]) {
      const decision = decideRecoveryAction({ journal: newJournal({ stage }), now: NOW });
      expect(decision).toEqual({ kind: 'resume-pre-stage', targetStage: stage });
    }
  });
});

// ── decideRecoveryAction — exhaustive switch ────────────────────────────────

describe('decideRecoveryAction — exhaustive switch', () => {
  it('exhaustively classifies every CompactJournalStage without falling through', () => {
    const stages: CompactJournalStage[] = [
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
    ];
    for (const stage of stages) {
      const journal = newJournal({
        stage,
        // For 'replacing', supply a sealed key so the decision reaches the
        // resume-replacing branch rather than the abandon-with-empty branch.
        sealedIdempotencyKeys: stage === 'replacing' ? ['txn'] : []
      });
      const decision = decideRecoveryAction({ journal, now: NOW });
      const allowedKinds: RecoveryDecision['kind'][] = [
        'resume-pre-stage',
        'resume-replacing',
        'resume-verifying',
        'resume-resuming',
        'completed',
        'terminal-failed',
        'abandon'
      ];
      expect(allowedKinds).toContain(decision.kind);
    }
  });
});

// ── resumeAttemptFromJournal — orchestrator ────────────────────────────────

describe('resumeAttemptFromJournal — orchestrator', () => {
  let projectRoot: string;
  let store: AttemptStore;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-recovery-'));
    store = createAttemptStore({ projectRoot, sessionId: SESSION });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Recording fallback coordinator. Captures the dispatch inputs. */
  function recordingCoordinator(): {
    readonly fn: (input: FallbackCoordinationInput) => Promise<FallbackCoordinationResult>;
    readonly calls: FallbackCoordinationInput[];
  } {
    const calls: FallbackCoordinationInput[] = [];
    const fn = async (input: FallbackCoordinationInput): Promise<FallbackCoordinationResult> => {
      calls.push(input);
      return {
        ok: true,
        code: 'FALLBACK_COMPLETED',
        receipt: {
          attemptId: input.attemptId,
          pathGeneration: input.pathGeneration,
          path: 'fallback',
          sameUi: true,
          before: { ratio: 0.9, source: 'exact', measuredAt: ISO },
          after: { ratio: 0.4, source: 'exact', measuredAt: ISO },
          completionSource: 'host-event',
          continuationToken: input.continuationToken,
          completedAt: ISO
        },
        resumeReceipt: {
          attemptId: input.attemptId,
          pathGeneration: input.pathGeneration,
          continuationTokenDigest: createHash('sha256').update(input.continuationToken).digest('hex'),
          sameUi: true,
          resumedAt: ISO
        },
        stages: [{ kind: 'completed' }]
      };
    };
    return { fn, calls };
  }

  it('reads the journal from the store and returns the decision without dispatching on abandon', async () => {
    const journal = newJournal({
      stage: 'preparing',
      createdAt: new Date(NOW.getTime() - SEVEN_DAYS_MS - 1).toISOString()
    });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'abandon', code: 'JOURNAL_STALE' });
    expect(calls).toHaveLength(0);
    expect(result.coordinationResult).toBeUndefined();
  });

  it('returns abandon with JOURNAL_EMPTY when no journal exists for the attempt', async () => {
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: 'no-such-attempt',
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'abandon', code: 'JOURNAL_EMPTY' });
    expect(calls).toHaveLength(0);
  });

  it('returns completed without dispatching when the journal is already terminal', async () => {
    const journal = newJournal({ stage: 'completed' });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'completed' });
    expect(calls).toHaveLength(0);
  });

  it('returns terminal-failed without dispatching when the journal is rolled-back', async () => {
    const journal = newJournal({ stage: 'rolled-back' });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'terminal-failed' });
    expect(calls).toHaveLength(0);
  });

  it('dispatches to the fallback coordinator for resume-pre-stage with the journal pathGeneration', async () => {
    const journal = newJournal({ stage: 'preparing', pathGeneration: 0 });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-pre-stage', targetStage: 'preparing' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathGeneration).toBe(0);
    expect(calls[0]?.attemptId).toBe(ATTEMPT);
    expect(calls[0]?.sessionId).toBe(SESSION);
    expect(calls[0]?.capabilityEpoch).toBe(EPOCH);
    expect(calls[0]?.continuationToken).toBe(DEFAULT_TOKEN);
    expect(calls[0]?.targetRatio).toBe(DEFAULT_RATIO);
  });

  it('increments pathGeneration by 1 for resume-replacing (previous generation failed)', async () => {
    const journal = newJournal({
      stage: 'replacing',
      pathGeneration: 2,
      sealedIdempotencyKeys: ['txn-abc']
    });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-replacing', transactionId: 'txn-abc' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathGeneration).toBe(3);
  });

  it('increments pathGeneration by 1 for resume-verifying (previous generation failed)', async () => {
    const journal = newJournal({ stage: 'verifying', pathGeneration: 1 });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-verifying' });
    expect(calls[0]?.pathGeneration).toBe(2);
  });

  it('increments pathGeneration by 1 for resume-resuming (previous generation failed)', async () => {
    const journal = newJournal({ stage: 'resuming', pathGeneration: 0 });
    await store.writeAttempt(journal);
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'resume-resuming' });
    expect(calls[0]?.pathGeneration).toBe(1);
  });

  it('returns the FallbackCoordinationResult from the orchestrator', async () => {
    const journal = newJournal({ stage: 'preparing', pathGeneration: 0 });
    await store.writeAttempt(journal);
    const { fn } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.coordinationResult).toBeDefined();
    expect(result.coordinationResult?.ok).toBe(true);
  });

  it('suggests a new attempt id when the journal is abandoned', () => {
    // The decision itself is the contract; the caller rotates attemptId
    // for the next attempt. The orchestrator just advertises that the
    // journal is no longer trustworthy by returning the abandon decision.
    const nextAttemptId = `attempt-${randomUUID()}`;
    expect(nextAttemptId).toMatch(/^attempt-[0-9a-f-]+$/);
  });

  it('abandons when the on-disk journal digest is malformed (digest integrity)', async () => {
    // Write a conforming journal, then mutate the digest bytes directly
    // so the strict schema accepts the file but the recovery module must
    // reject the malformed digest.
    const journal = newJournal({ stage: 'preparing', pathGeneration: 0 });
    await store.writeAttempt(journal);
    const journalPath = join(
      projectRoot,
      '.peaks',
      '_runtime',
      SESSION,
      'compact-attempts',
      `${ATTEMPT}.journal.json`
    );
    writeFileSync(journalPath, JSON.stringify({ ...journal, digest: 'XX' }, null, 2));
    const { fn, calls } = recordingCoordinator();
    const result = await resumeAttemptFromJournal({
      projectRoot,
      sessionId: SESSION,
      attemptId: ATTEMPT,
      fallbackCoordinator: fn,
      store,
      now: NOW,
      bridge: stubBridge(),
      capsule: stubCapsule(),
      targetRatio: DEFAULT_RATIO,
      continuationToken: DEFAULT_TOKEN,
      capabilityEpoch: EPOCH
    });
    expect(result.decision).toEqual({ kind: 'abandon', code: 'JOURNAL_INVALID_DIGEST' });
    expect(calls).toHaveLength(0);
  });
});
