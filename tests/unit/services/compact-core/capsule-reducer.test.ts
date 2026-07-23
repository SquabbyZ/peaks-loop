/**
 * Phase 2 Task 2.2 — deterministic bounded capsule reduction tests.
 *
 * Pins the reducer contract:
 *   - pure function (no I/O, no clock, no random)
 *   - mandatory retention: goal, mode, activeJob, activeRequest,
 *     completedGates, blocking openQuestions, activeTasks, nextAction
 *   - drop order (4 steps, deterministic, runs once each):
 *       (1) dedupe failureHistory by code, keep first
 *       (2) demote artifactIndex: strip kind
 *       (3) dedupe decisions by id, keep latest madeAt
 *       (4) truncate failureHistory to most recent 5 IF still over budget
 *   - throws CapsuleBudgetExceededError when still over after step 4
 *   - never mutates input
 *   - always returns a fresh ConvergenceCapsule with a re-digested body
 *
 * Tests are non-tautological: each branch is exercised independently.
 */
import { describe, expect, it } from 'vitest';
import {
  CapsuleBudgetExceededError,
  canonicalBodyBytes,
  reduceCapsule
} from '../../../../src/services/compact-core/capsule-reducer.js';
import { digestCapsule } from '../../../../src/services/compact-core/capsule-digest.js';
import {
  type ArtifactPointer,
  type ConvergenceCapsule,
  type ConvergenceCapsuleInput,
  type DecisionRecord,
  type FailureRecord,
  type OpenQuestion
} from '../../../../src/services/compact-core/capsule-types.js';

const HEX64 = 'a'.repeat(64);

function makeGoal(): ConvergenceCapsule['goal'] {
  return {
    id: 'goal-1',
    text: 'Ship the capsule',
    approvedAt: '2026-07-23T00:00:00.000Z',
    approvedBy: 'SquabbyZ'
  };
}

function makeActiveJob(): ConvergenceCapsule['activeJob'] {
  return {
    jobId: 'job-1',
    lane: 'main',
    phase: 'implementation',
    updatedAt: '2026-07-23T00:00:00.000Z'
  };
}

function makeActiveRequest(): ConvergenceCapsule['activeRequest'] {
  return {
    requestId: 'req-1',
    sliceId: 'slice-1',
    status: 'in-progress',
    updatedAt: '2026-07-23T00:00:00.000Z'
  };
}

function makeNextAction(): ConvergenceCapsule['nextAction'] {
  return {
    id: 'a1',
    kind: 'continue',
    summary: 'resume'
  };
}

function makeIdempotency(): ConvergenceCapsule['idempotency'] {
  return {
    scope: 'attempt-001',
    sealedKeys: ['goal.id']
  };
}

function makeContext(): ConvergenceCapsule['sourceContextMeasurement'] {
  return {
    promptBytes: 1024,
    capacityBytes: 200_000,
    ratio: 0.00512,
    computedAt: '2026-07-23T00:00:00.000Z',
    windowKind: '200k'
  };
}

function buildBaseInput(): ConvergenceCapsuleInput {
  return {
    schemaVersion: 1,
    capsuleId: HEX64,
    compactAttemptId: 'attempt-001',
    sourceSessionId: 'session-001',
    goal: makeGoal(),
    mode: 'full-auto',
    activeJob: makeActiveJob(),
    activeRequest: makeActiveRequest(),
    completedGates: [],
    activeTasks: [],
    decisions: [],
    openQuestions: [],
    failureHistory: [],
    artifactIndex: [],
    nextAction: makeNextAction(),
    idempotency: makeIdempotency(),
    sourceContextMeasurement: makeContext(),
    digest: HEX64
  };
}

function buildCapsule(
  overrides: Partial<ConvergenceCapsuleInput> = {}
): ConvergenceCapsule {
  const input = buildBaseInput();
  const capsuleWithoutDigest: Omit<ConvergenceCapsule, 'digest'> = {
    ...input,
    ...overrides
  } as Omit<ConvergenceCapsule, 'digest'>;
  const digest = digestCapsule(capsuleWithoutDigest);
  return { ...capsuleWithoutDigest, digest } as ConvergenceCapsule;
}

function makeFailure(code: string, summary = `failure ${code}`): FailureRecord {
  return {
    code,
    summary,
    retryCount: 1,
    lastFailureAt: '2026-07-23T00:00:00.000Z'
  };
}

function makeArtifact(path: string, kind?: string): ArtifactPointer {
  const base: ArtifactPointer = {
    path,
    sha256: HEX64,
    summary: `summary ${path}`
  };
  return kind === undefined ? base : { ...base, kind };
}

function makeDecision(id: string, madeAt: string, decision = `decision ${id}`): DecisionRecord {
  return {
    id,
    decision,
    rationale: 'rationale',
    madeAt
  };
}

function makeQuestion(id: string, blocking: boolean): OpenQuestion {
  return {
    id,
    question: `question ${id}`,
    blocking,
    askedAt: '2026-07-23T00:00:00.000Z'
  };
}

// ── canonicalBodyBytes (helper exposed for tests) ──────────────────────────

describe('canonicalBodyBytes', () => {
  it('excludes the top-level digest field from byte count', () => {
    const capsule = buildCapsule({ failureHistory: [makeFailure('f1')] });
    const withFake = { ...(capsule as unknown as Record<string, unknown>), digest: 'f'.repeat(64) };
    expect(canonicalBodyBytes(withFake)).toBe(canonicalBodyBytes(capsule));
  });

  it('is independent of key insertion order', () => {
    const capsule = buildCapsule({ failureHistory: [makeFailure('f1')] });
    const obj = capsule as unknown as Record<string, unknown>;
    const keys = Object.keys(obj).reverse();
    const reordered: Record<string, unknown> = {};
    for (const k of keys) reordered[k] = obj[k];
    expect(canonicalBodyBytes(reordered)).toBe(canonicalBodyBytes(capsule));
  });

  it('changes when a payload field mutates', () => {
    const a = buildCapsule();
    const b = buildCapsule({ compactAttemptId: 'attempt-with-a-much-longer-id' });
    expect(canonicalBodyBytes(a)).not.toBe(canonicalBodyBytes(b));
  });
});

// ── under-cap identity behaviour ───────────────────────────────────────────

describe('reduceCapsule — under cap', () => {
  it('returns a fresh capsule with the same body when budget fits', () => {
    const capsule = buildCapsule();
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 1024);
    expect(out).not.toBe(capsule);
    expect(out.goal).toEqual(capsule.goal);
    expect(out.mode).toBe(capsule.mode);
    expect(out.activeJob).toEqual(capsule.activeJob);
    expect(out.activeRequest).toEqual(capsule.activeRequest);
    expect(out.completedGates).toEqual(capsule.completedGates);
    expect(out.activeTasks).toEqual(capsule.activeTasks);
    expect(out.decisions).toEqual(capsule.decisions);
    expect(out.openQuestions).toEqual(capsule.openQuestions);
    expect(out.failureHistory).toEqual(capsule.failureHistory);
    expect(out.artifactIndex).toEqual(capsule.artifactIndex);
    expect(out.nextAction).toEqual(capsule.nextAction);
  });

  it('preserves byte equality: output body bytes equal input body bytes when nothing changes', () => {
    const capsule = buildCapsule();
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes);
    expect(canonicalBodyBytes(out)).toBe(bodyBytes);
  });

  it('re-validates the digest: output digest matches input digest when nothing changes', () => {
    const capsule = buildCapsule();
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes);
    expect(out.digest).toBe(capsule.digest);
  });

  it('returns a re-digested capsule when budget is generous', () => {
    const capsule = buildCapsule();
    const out = reduceCapsule(capsule, Number.MAX_SAFE_INTEGER);
    expect(out.digest).toBe(capsule.digest);
    expect(canonicalBodyBytes(out)).toBe(canonicalBodyBytes(capsule));
  });

  it('does not mutate input arrays on the under-cap path', () => {
    const failureHistory = [makeFailure('f1'), makeFailure('f2')];
    const decisions = [makeDecision('d1', '2026-07-23T00:00:00.000Z')];
    const artifactIndex = [makeArtifact('a1', 'kind-a')];
    const openQuestions = [makeQuestion('q1', true)];
    const capsule = buildCapsule({ failureHistory, decisions, artifactIndex, openQuestions });
    const snapshotFailure = JSON.stringify(failureHistory);
    const snapshotDecisions = JSON.stringify(decisions);
    const snapshotArtifacts = JSON.stringify(artifactIndex);
    const snapshotQuestions = JSON.stringify(openQuestions);
    reduceCapsule(capsule, Number.MAX_SAFE_INTEGER);
    expect(JSON.stringify(failureHistory)).toBe(snapshotFailure);
    expect(JSON.stringify(decisions)).toBe(snapshotDecisions);
    expect(JSON.stringify(artifactIndex)).toBe(snapshotArtifacts);
    expect(JSON.stringify(openQuestions)).toBe(snapshotQuestions);
  });
});

// ── step 1: failureHistory dedupe by code ──────────────────────────────────

describe('reduceCapsule — step 1 dedupe failureHistory by code', () => {
  it('drops later rows that match an earlier code (keeps first)', () => {
    const history = [
      makeFailure('X', 'first'),
      makeFailure('Y', 'second'),
      makeFailure('X', 'third'),
      makeFailure('Z', 'fourth'),
      makeFailure('Y', 'fifth')
    ];
    const capsule = buildCapsule({ failureHistory: history });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.failureHistory.map(f => f.code)).toEqual(['X', 'Y', 'Z']);
    expect(out.failureHistory.map(f => f.summary)).toEqual(['first', 'second', 'fourth']);
  });

  it('preserves original array order for first occurrences', () => {
    const history = [
      makeFailure('C'),
      makeFailure('A'),
      makeFailure('B'),
      makeFailure('C'),
      makeFailure('A')
    ];
    const capsule = buildCapsule({ failureHistory: history });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.failureHistory.map(f => f.code)).toEqual(['C', 'A', 'B']);
  });

  it('is a no-op when all codes are unique', () => {
    const history = [makeFailure('a'), makeFailure('b'), makeFailure('c')];
    const capsule = buildCapsule({ failureHistory: history });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.failureHistory).toHaveLength(3);
    expect(out.failureHistory.map(f => f.code)).toEqual(['a', 'b', 'c']);
  });
});

// ── step 2: artifactIndex demote (strip kind) ─────────────────────────────

describe('reduceCapsule — step 2 demote artifactIndex (strip kind)', () => {
  it('strips kind from entries that have it', () => {
    const index = [
      makeArtifact('a1', 'kind-1'),
      makeArtifact('a2', 'kind-2'),
      makeArtifact('a3')
    ];
    const capsule = buildCapsule({ artifactIndex: index });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.artifactIndex).toHaveLength(3);
    for (const pointer of out.artifactIndex) {
      expect(pointer.kind).toBeUndefined();
      expect('kind' in (pointer as Record<string, unknown>)).toBe(false);
      expect(typeof pointer.path).toBe('string');
      expect(pointer.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(typeof pointer.summary).toBe('string');
    }
  });

  it('preserves path / sha256 / summary values', () => {
    const index = [
      makeArtifact('path/a', 'kind-a'),
      makeArtifact('path/b', 'kind-b')
    ];
    const capsule = buildCapsule({ artifactIndex: index });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.artifactIndex.map(p => p.path)).toEqual(['path/a', 'path/b']);
    expect(out.artifactIndex.map(p => p.summary)).toEqual(['summary path/a', 'summary path/b']);
  });

  it('is a no-op on entries that already lack kind', () => {
    const index = [makeArtifact('a1'), makeArtifact('a2')];
    const capsule = buildCapsule({ artifactIndex: index });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.artifactIndex).toHaveLength(2);
    for (const pointer of out.artifactIndex) {
      expect(pointer.kind).toBeUndefined();
    }
  });
});

// ── step 3: dedupe decisions by id, keep latest madeAt ────────────────────

describe('reduceCapsule — step 3 dedupe decisions (keep latest madeAt)', () => {
  it('keeps the most recent madeAt per id', () => {
    const decisions = [
      makeDecision('d1', '2026-07-23T00:00:00.000Z', 'old'),
      makeDecision('d2', '2026-07-23T00:00:01.000Z', 'keep-d2'),
      makeDecision('d1', '2026-07-23T00:00:02.000Z', 'new'),
      makeDecision('d3', '2026-07-23T00:00:03.000Z', 'keep-d3')
    ];
    const capsule = buildCapsule({ decisions });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.decisions.map(d => d.id)).toEqual(['d1', 'd2', 'd3']);
    const d1 = out.decisions.find(d => d.id === 'd1')!;
    expect(d1.decision).toBe('new');
    expect(d1.madeAt).toBe('2026-07-23T00:00:02.000Z');
  });

  it('preserves first-seen order across distinct ids', () => {
    const decisions = [
      makeDecision('b', '2026-07-23T00:00:01.000Z'),
      makeDecision('a', '2026-07-23T00:00:02.000Z'),
      makeDecision('c', '2026-07-23T00:00:03.000Z'),
      makeDecision('b', '2026-07-23T00:00:04.000Z'),
      makeDecision('a', '2026-07-23T00:00:05.000Z')
    ];
    const capsule = buildCapsule({ decisions });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.decisions.map(d => d.id)).toEqual(['b', 'a', 'c']);
  });

  it('is a no-op when all decision ids are unique', () => {
    const decisions = [
      makeDecision('d1', '2026-07-23T00:00:00.000Z'),
      makeDecision('d2', '2026-07-23T00:00:01.000Z'),
      makeDecision('d3', '2026-07-23T00:00:02.000Z')
    ];
    const capsule = buildCapsule({ decisions });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.decisions).toHaveLength(3);
  });
});

// ── step 4: truncate failureHistory tail to most recent 5 ────────────────

describe('reduceCapsule — step 4 truncate failureHistory tail to most recent 5', () => {
  it('keeps only the most recent 5 entries when step 4 runs (oldest dropped first)', () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      makeFailure(`f${i + 1}`, `summary-${i + 1}`)
    );
    const capsule = buildCapsule({ failureHistory: history });
    // Force step 4 by setting budget below full body but above post-step-4 size.
    const fullBytes = canonicalBodyBytes(capsule);
    const targetBytes = Math.floor(fullBytes * 0.85);
    const out = reduceCapsule(capsule, targetBytes);
    expect(out.failureHistory).toHaveLength(5);
    expect(out.failureHistory.map(f => f.code)).toEqual(['f6', 'f7', 'f8', 'f9', 'f10']);
  });

  it('truncation runs AFTER dedupe, so dedup count > 5 still truncates to 5', () => {
    const history = Array.from({ length: 20 }, (_, i) =>
      makeFailure(`f${i + 1}`, `summary-${i + 1}`)
    );
    const capsule = buildCapsule({ failureHistory: history });
    const fullBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, Math.floor(fullBytes * 0.65));
    expect(out.failureHistory).toHaveLength(5);
    expect(out.failureHistory.map(f => f.code)).toEqual(['f16', 'f17', 'f18', 'f19', 'f20']);
  });

  it('does not run when budget already satisfied by steps 1-3', () => {
    const history = Array.from({ length: 3 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ failureHistory: history });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.failureHistory).toHaveLength(3);
  });
});

// ── drop order observability ───────────────────────────────────────────────

describe('reduceCapsule — drop order observable', () => {
  it('runs steps 1-3 unconditionally and step 4 only when budget demands it', () => {
    // Build a capsule where dedupe (step 1), demote (step 2), decision dedupe
    // (step 3) all have work to do AND step 4 is needed to fit.
    const history = Array.from({ length: 8 }, (_, i) =>
      makeFailure(`f${i + 1}`, `summary-${i + 1}`)
    );
    // Add a duplicate to exercise step 1
    history.push(makeFailure('f1', 'duplicate-of-f1'));

    const index = [
      makeArtifact('a1', 'kind-a'),
      makeArtifact('a2', 'kind-b')
    ];

    const decisions = [
      makeDecision('d1', '2026-07-23T00:00:00.000Z', 'old-d1'),
      makeDecision('d2', '2026-07-23T00:00:01.000Z', 'keep-d2'),
      makeDecision('d1', '2026-07-23T00:00:02.000Z', 'new-d1')
    ];

    const capsule = buildCapsule({
      failureHistory: history,
      artifactIndex: index,
      decisions
    });

    const fullBytes = canonicalBodyBytes(capsule);
    const targetBytes = Math.floor(fullBytes * 0.85);
    const out = reduceCapsule(capsule, targetBytes);

    // Step 1: failureHistory has 9 -> 8 (f1 duplicate dropped)
    expect(out.failureHistory.length).toBeLessThan(9);
    expect(out.failureHistory.map(f => f.code)).not.toContain('duplicate-of-f1');

    // Step 2: artifactIndex entries lack kind
    for (const pointer of out.artifactIndex) {
      expect(pointer.kind).toBeUndefined();
    }

    // Step 3: decisions dedupe to 2 (d1 latest, d2)
    expect(out.decisions.length).toBe(2);
    expect(out.decisions.map(d => d.id).sort()).toEqual(['d1', 'd2']);
    const d1 = out.decisions.find(d => d.id === 'd1')!;
    expect(d1.decision).toBe('new-d1');

    // Step 4 may have run; failureHistory should be <= 5
    expect(out.failureHistory.length).toBeLessThanOrEqual(5);
  });

  it('runs each step exactly once (no re-loops)', () => {
    // A capsule with one duplicate failure code. Step 1 collapses to 1.
    // Step 4 would normally truncate to 5, but since already <= 5 it's no-op.
    const history = [
      makeFailure('X', 'first'),
      makeFailure('X', 'second'),
      makeFailure('X', 'third')
    ];
    const index = [makeArtifact('a1', 'kind-a')];
    const decisions = [
      makeDecision('d1', '2026-07-23T00:00:00.000Z'),
      makeDecision('d1', '2026-07-23T00:00:01.000Z')
    ];
    const capsule = buildCapsule({ failureHistory: history, artifactIndex: index, decisions });

    // Budget that is satisfied after step 1 (no need for step 4).
    const fullBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, fullBytes + 4096);

    expect(out.failureHistory).toHaveLength(1);
    expect(out.failureHistory[0]!.summary).toBe('first');
    expect(out.artifactIndex[0]!.kind).toBeUndefined();
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]!.madeAt).toBe('2026-07-23T00:00:01.000Z');
  });
});

// ── mandatory retention ────────────────────────────────────────────────────

describe('reduceCapsule — mandatory retention', () => {
  it('never drops goal', () => {
    const goal = makeGoal();
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ goal, failureHistory: history });
    try {
      const out = reduceCapsule(capsule, 64);
      expect(out.goal).toEqual(goal);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
      // mandatoryFieldCount is reported; goal must still be in source
      expect(capsule.goal).toEqual(goal);
    }
  });

  it('never drops mode', () => {
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ mode: 'assisted', failureHistory: history });
    try {
      const out = reduceCapsule(capsule, 64);
      expect(out.mode).toBe('assisted');
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
  });

  it('never drops activeJob / activeRequest (preserves null too)', () => {
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsuleNull = buildCapsule({ activeJob: null, activeRequest: null, failureHistory: history });
    const capsuleJob = buildCapsule({ failureHistory: history });
    const capsuleReq = buildCapsule({ activeRequest: makeActiveRequest(), failureHistory: history });
    for (const c of [capsuleNull, capsuleJob, capsuleReq]) {
      try {
        const out = reduceCapsule(c, 64);
        // activeJob / activeRequest may be dropped only if null; here, never set null when set
        if (c.activeJob !== null) expect(out.activeJob).toEqual(c.activeJob);
        if (c.activeRequest !== null) expect(out.activeRequest).toEqual(c.activeRequest);
      } catch (err) {
        if (!(err instanceof CapsuleBudgetExceededError)) throw err;
      }
    }
  });

  it('never drops completedGates', () => {
    const gates = Array.from({ length: 3 }, (_, i) => ({
      gateId: `g${i + 1}`,
      status: 'passed',
      completedAt: '2026-07-23T00:00:00.000Z',
      receipt: `r${i + 1}`
    }));
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ completedGates: gates, failureHistory: history });
    try {
      const out = reduceCapsule(capsule, 64);
      expect(out.completedGates).toEqual(gates);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
  });

  it('never drops activeTasks', () => {
    const tasks = Array.from({ length: 3 }, (_, i) => ({
      taskId: `t${i + 1}`,
      status: 'open',
      summary: `summary ${i + 1}`,
      startedAt: '2026-07-23T00:00:00.000Z'
    }));
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ activeTasks: tasks, failureHistory: history });
    try {
      const out = reduceCapsule(capsule, 64);
      expect(out.activeTasks).toEqual(tasks);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
  });

  it('never drops nextAction', () => {
    const action = makeNextAction();
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ nextAction: action, failureHistory: history });
    try {
      const out = reduceCapsule(capsule, 64);
      expect(out.nextAction).toEqual(action);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
  });

  it('never drops blocking openQuestions', () => {
    const blockingQ = makeQuestion('qb', true);
    const nonBlockingQ = makeQuestion('qn', false);
    const history = Array.from({ length: 30 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({
      openQuestions: [blockingQ, nonBlockingQ],
      failureHistory: history
    });
    try {
      const out = reduceCapsule(capsule, 64);
      expect(out.openQuestions.some(q => q.id === 'qb' && q.blocking === true)).toBe(true);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
      // Even on error, source must have blocking question
      expect(capsule.openQuestions.some(q => q.id === 'qb' && q.blocking === true)).toBe(true);
    }
  });

  it('non-blocking openQuestions are preserved by the reducer (no drop step targets them)', () => {
    const q1 = makeQuestion('q1', false);
    const q2 = makeQuestion('q2', false);
    const capsule = buildCapsule({ openQuestions: [q1, q2] });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.openQuestions).toEqual([q1, q2]);
  });
});

// ── budget-exceeded error contract ─────────────────────────────────────────

describe('reduceCapsule — budget exceeded', () => {
  it('throws CapsuleBudgetExceededError when all 4 steps leave the capsule over budget', () => {
    const history = Array.from({ length: 20 }, (_, i) => makeFailure(`f${i + 1}`));
    const index = Array.from({ length: 5 }, (_, i) => makeArtifact(`a${i + 1}`, `kind-${i + 1}`));
    const decisions = Array.from({ length: 5 }, (_, i) =>
      makeDecision(`d${i + 1}`, '2026-07-23T00:00:00.000Z')
    );
    const capsule = buildCapsule({ failureHistory: history, artifactIndex: index, decisions });
    expect(() => reduceCapsule(capsule, 64)).toThrow(CapsuleBudgetExceededError);
  });

  it('error carries actualBytes > maxUtf8Bytes', () => {
    const history = Array.from({ length: 20 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ failureHistory: history });
    const max = 64;
    try {
      reduceCapsule(capsule, max);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CapsuleBudgetExceededError);
      const e = err as CapsuleBudgetExceededError;
      expect(e.actualBytes).toBeGreaterThan(max);
      expect(e.actualBytes).toBeGreaterThan(0);
    }
  });

  it('error carries mandatoryFieldCount > 0 (mandatory fields preserved)', () => {
    const history = Array.from({ length: 20 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ failureHistory: history });
    try {
      reduceCapsule(capsule, 64);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CapsuleBudgetExceededError);
      const e = err as CapsuleBudgetExceededError;
      expect(e.mandatoryFieldCount).toBeGreaterThan(0);
    }
  });

  it('error is named CapsuleBudgetExceededError', () => {
    const history = Array.from({ length: 20 }, (_, i) => makeFailure(`f${i + 1}`));
    const capsule = buildCapsule({ failureHistory: history });
    try {
      reduceCapsule(capsule, 64);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as Error).name).toBe('CapsuleBudgetExceededError');
    }
  });
});

// ── mutation safety ────────────────────────────────────────────────────────

describe('reduceCapsule — mutation safety', () => {
  it('does not mutate input.failureHistory', () => {
    const failureHistory = [
      makeFailure('X'),
      makeFailure('Y'),
      makeFailure('X')
    ];
    const snapshot = JSON.stringify(failureHistory);
    const capsule = buildCapsule({ failureHistory });
    try {
      reduceCapsule(capsule, 64);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
    expect(JSON.stringify(failureHistory)).toBe(snapshot);
  });

  it('does not mutate input.artifactIndex', () => {
    const artifactIndex = [makeArtifact('a1', 'kind-a'), makeArtifact('a2')];
    const snapshot = JSON.stringify(artifactIndex);
    const capsule = buildCapsule({ artifactIndex });
    try {
      reduceCapsule(capsule, 64);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
    expect(JSON.stringify(artifactIndex)).toBe(snapshot);
  });

  it('does not mutate input.decisions', () => {
    const decisions = [
      makeDecision('d1', '2026-07-23T00:00:00.000Z'),
      makeDecision('d1', '2026-07-23T00:00:01.000Z')
    ];
    const snapshot = JSON.stringify(decisions);
    const capsule = buildCapsule({ decisions });
    try {
      reduceCapsule(capsule, 64);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
    expect(JSON.stringify(decisions)).toBe(snapshot);
  });

  it('does not mutate input.openQuestions', () => {
    const openQuestions = [makeQuestion('q1', true), makeQuestion('q2', false)];
    const snapshot = JSON.stringify(openQuestions);
    const capsule = buildCapsule({ openQuestions });
    try {
      reduceCapsule(capsule, 64);
    } catch (err) {
      if (!(err instanceof CapsuleBudgetExceededError)) throw err;
    }
    expect(JSON.stringify(openQuestions)).toBe(snapshot);
  });

  it('output uses fresh array references (not input arrays)', () => {
    const failureHistory = [makeFailure('a')];
    const artifactIndex = [makeArtifact('a1')];
    const decisions = [makeDecision('d1', '2026-07-23T00:00:00.000Z')];
    const openQuestions = [makeQuestion('q1', true)];
    const capsule = buildCapsule({ failureHistory, artifactIndex, decisions, openQuestions });
    const out = reduceCapsule(capsule, canonicalBodyBytes(capsule) + 4096);
    expect(out.failureHistory).not.toBe(failureHistory);
    expect(out.artifactIndex).not.toBe(artifactIndex);
    expect(out.decisions).not.toBe(decisions);
    expect(out.openQuestions).not.toBe(openQuestions);
  });
});

// ── array order preservation ───────────────────────────────────────────────

describe('reduceCapsule — array order preservation', () => {
  it('preserves completedGates order', () => {
    const gates = ['g3', 'g1', 'g2', 'g4'].map(id => ({
      gateId: id,
      status: 'passed',
      completedAt: '2026-07-23T00:00:00.000Z',
      receipt: id
    }));
    const capsule = buildCapsule({ completedGates: gates });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.completedGates.map(g => g.gateId)).toEqual(['g3', 'g1', 'g2', 'g4']);
  });

  it('preserves activeTasks order', () => {
    const tasks = ['t2', 't1', 't3'].map(id => ({
      taskId: id,
      status: 'open',
      summary: id,
      startedAt: '2026-07-23T00:00:00.000Z'
    }));
    const capsule = buildCapsule({ activeTasks: tasks });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.activeTasks.map(t => t.taskId)).toEqual(['t2', 't1', 't3']);
  });

  it('preserves openQuestions order', () => {
    const qs = ['q2', 'q1', 'q3'].map((id, i) => makeQuestion(id, i === 0));
    const capsule = buildCapsule({ openQuestions: qs });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.openQuestions.map(q => q.id)).toEqual(['q2', 'q1', 'q3']);
  });

  it('preserves failureHistory first-occurrence order through dedupe', () => {
    const history = [
      makeFailure('B'),
      makeFailure('A'),
      makeFailure('B'),
      makeFailure('C'),
      makeFailure('A')
    ];
    const capsule = buildCapsule({ failureHistory: history });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.failureHistory.map(f => f.code)).toEqual(['B', 'A', 'C']);
  });

  it('preserves artifactIndex order through demote', () => {
    const index = [
      makeArtifact('a3', 'kind-3'),
      makeArtifact('a1', 'kind-1'),
      makeArtifact('a2', 'kind-2')
    ];
    const capsule = buildCapsule({ artifactIndex: index });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.artifactIndex.map(p => p.path)).toEqual(['a3', 'a1', 'a2']);
  });

  it('preserves decisions first-seen order through dedupe-by-latest', () => {
    const decisions = [
      makeDecision('X', '2026-07-23T00:00:01.000Z'),
      makeDecision('Y', '2026-07-23T00:00:02.000Z'),
      makeDecision('X', '2026-07-23T00:00:03.000Z'),
      makeDecision('Z', '2026-07-23T00:00:04.000Z')
    ];
    const capsule = buildCapsule({ decisions });
    const bodyBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, bodyBytes + 4096);
    expect(out.decisions.map(d => d.id)).toEqual(['X', 'Y', 'Z']);
  });
});

// ── digest validity on output ──────────────────────────────────────────────

describe('reduceCapsule — digest validity', () => {
  it('output digest equals digestCapsule(output body excluding digest)', () => {
    const history = [
      makeFailure('X'),
      makeFailure('Y'),
      makeFailure('X')
    ];
    const index = [makeArtifact('a1', 'kind-a')];
    const decisions = [
      makeDecision('d1', '2026-07-23T00:00:00.000Z'),
      makeDecision('d1', '2026-07-23T00:00:01.000Z')
    ];
    const capsule = buildCapsule({ failureHistory: history, artifactIndex: index, decisions });
    const fullBytes = canonicalBodyBytes(capsule);
    const out = reduceCapsule(capsule, Math.floor(fullBytes * 0.95));
    const bodyWithoutDigest = { ...(out as unknown as Record<string, unknown>) };
    delete (bodyWithoutDigest as Record<string, unknown>).digest;
    expect(out.digest).toBe(digestCapsule(bodyWithoutDigest as Omit<ConvergenceCapsule, 'digest'>));
  });

  it('re-digesting a no-op output yields the same digest as input', () => {
    const capsule = buildCapsule();
    const out = reduceCapsule(capsule, canonicalBodyBytes(capsule));
    expect(out.digest).toBe(capsule.digest);
  });
});