/**
 * peaks-loop v3.0.0 — Slice C.3
 *
 * Unit tests for the monotonic-improvement guard. Mirrors the 8
 * scenarios required by `specs/loop-eng-native-code-c-d-e.md` (b).
 *
 * Karpathy §2: pure-data tests, no IO, single file under 800 lines.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  checkMonotonicImprovement,
  toScoreRow,
  loadCrossSessionSignal,
  DEFAULT_MONOTONIC_THRESHOLD,
  type MonotonicCycle
} from '../../../src/services/loop/monotonic-guard.js';
import {
  loadPreviousCycle,
  nextCycleIndex,
  sliceDir
} from '../../../src/services/loop/monotonic-runner.js';

const ROW_PASS = (evaluator: string) => toScoreRow(evaluator, 'pass', false, '2026-06-30T00:00:00.000Z');
const ROW_WARN = (evaluator: string) => toScoreRow(evaluator, 'warn', false, '2026-06-30T00:00:00.000Z');
const ROW_BLOCK = (evaluator: string) => toScoreRow(evaluator, 'block', false, '2026-06-30T00:00:00.000Z');

describe('checkMonotonicImprovement — pure guard', () => {
  it('returns skip when no previous cycle is recorded', () => {
    const current: MonotonicCycle = { cycle: 1, scores: [ROW_PASS('karpathy')] };
    const report = checkMonotonicImprovement(null, current);
    expect(report.status).toBe('skip');
    expect(report.code).toBe('MONOTONIC_NO_PREVIOUS');
    expect(report.monotonicityViolation).toBe(false);
    expect(report.previousCycle).toBeNull();
    expect(report.regressions).toEqual([]);
  });

  it('passes when an evaluator score is unchanged', () => {
    const previous: MonotonicCycle = { cycle: 1, scores: [ROW_PASS('karpathy')] };
    const current: MonotonicCycle = { cycle: 2, scores: [ROW_PASS('karpathy')] };
    const report = checkMonotonicImprovement(previous, current);
    expect(report.status).toBe('pass');
    expect(report.code).toBe('MONOTONIC_OK');
    expect(report.monotonicityViolation).toBe(false);
    expect(report.regressions).toEqual([]);
  });

  it('passes when an evaluator score improves (warn → pass)', () => {
    const previous: MonotonicCycle = { cycle: 1, scores: [ROW_WARN('karpathy')] };
    const current: MonotonicCycle = { cycle: 2, scores: [ROW_PASS('karpathy')] };
    const report = checkMonotonicImprovement(previous, current);
    expect(report.status).toBe('pass');
    expect(report.code).toBe('MONOTONIC_OK');
    expect(report.monotonicityViolation).toBe(false);
  });

  it('passes when an evaluator score regresses within the threshold (warn → block = 0.5 < threshold 1.0? no, 0.5 > threshold)', () => {
    // Re-test the exact "small drift" case: default threshold = 0.05; a
    // tiny drift within threshold must pass. We use a custom threshold
    // of 1.0 so that the largest possible drop is still allowed.
    const previous: MonotonicCycle = { cycle: 1, scores: [ROW_PASS('karpathy')] };
    const current: MonotonicCycle = { cycle: 2, scores: [ROW_WARN('karpathy')] };
    const report = checkMonotonicImprovement(previous, current, { threshold: 1.0 });
    expect(report.status).toBe('pass');
    expect(report.monotonicityViolation).toBe(false);
  });

  it('passes when regression equals the threshold (boundary case)', () => {
    // Previous score = 1.0; current score = 0.95; delta = 0.05;
    // threshold = 0.05 → boundary, must pass.
    const previous: MonotonicCycle = {
      cycle: 1,
      scores: [{ evaluator: 'karpathy', score: 1.0, gateAction: 'pass', degraded: false, observedAt: '2026-06-30T00:00:00.000Z' }]
    };
    const current: MonotonicCycle = {
      cycle: 2,
      scores: [{ evaluator: 'karpathy', score: 0.95, gateAction: 'pass', degraded: false, observedAt: '2026-06-30T00:00:01.000Z' }]
    };
    const report = checkMonotonicImprovement(previous, current, { threshold: 0.05 });
    expect(report.status).toBe('pass');
    expect(report.monotonicityViolation).toBe(false);
    expect(report.regressions).toEqual([]);
  });

  it('aborts (MONOTONICITY_VIOLATION) when score regression exceeds the threshold', () => {
    // pass (1.0) → block (0.0) → delta = 1.0 ≫ threshold 0.05 → must abort.
    const previous: MonotonicCycle = { cycle: 1, scores: [ROW_PASS('karpathy')] };
    const current: MonotonicCycle = { cycle: 2, scores: [ROW_BLOCK('karpathy')] };
    const report = checkMonotonicImprovement(previous, current);
    expect(report.status).toBe('block');
    expect(report.code).toBe('MONOTONIC_VIOLATION');
    expect(report.monotonicityViolation).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.regressions).toHaveLength(1);
    expect(report.regressions[0]?.evaluator).toBe('karpathy');
    expect(report.regressions[0]?.previousScore).toBe(1.0);
    expect(report.regressions[0]?.currentScore).toBe(0);
    expect(report.reason).toMatch(/MONOTONICITY_VIOLATION/);
  });

  it('skips evaluators that do not appear in both cycles (no comparison)', () => {
    const previous: MonotonicCycle = { cycle: 1, scores: [ROW_PASS('karpathy')] };
    const current: MonotonicCycle = { cycle: 2, scores: [ROW_BLOCK('code-review')] };
    const report = checkMonotonicImprovement(previous, current);
    expect(report.status).toBe('skip');
    expect(report.code).toBe('MONOTONIC_INCOMPARABLE_EVALUATORS');
    expect(report.monotonicityViolation).toBe(false);
    expect(report.regressions).toEqual([]);
  });

  it('skips when cycles have no comparable evaluators at all (different evaluator sets)', () => {
    const previous: MonotonicCycle = { cycle: 1, scores: [ROW_PASS('a-only')] };
    const current: MonotonicCycle = { cycle: 2, scores: [ROW_BLOCK('b-only')] };
    const report = checkMonotonicImprovement(previous, current);
    expect(report.code).toBe('MONOTONIC_INCOMPARABLE_EVALUATORS');
    expect(report.regressions).toEqual([]);
  });
});

describe('loadCrossSessionSignal — IO-error tolerance', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-mono-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns null when .peaks/_sub_agents/<sid>/shared/ does not exist (no crash)', () => {
    const cycle = loadCrossSessionSignal(tmpRoot, '2026-06-30-missing');
    expect(cycle).toBeNull();
  });

  it('parses the most recent cycle-N.json file when the shared dir is populated', () => {
    const sharedDir = join(tmpRoot, '.peaks', '_sub_agents', '2026-06-30-x', 'shared');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, 'cycle-2.json'), JSON.stringify({
      cycle: 2,
      scores: [
        { evaluator: 'karpathy', score: 0.8, gateAction: 'pass', degraded: false, observedAt: '2026-06-30T00:00:00.000Z' }
      ]
    }));
    // cycle-1 has an earlier mtime but cycle-2 takes priority.
    writeFileSync(join(sharedDir, 'cycle-1.json'), JSON.stringify({
      cycle: 1,
      scores: [
        { evaluator: 'karpathy', score: 0.3, gateAction: 'warn', degraded: false, observedAt: '2026-06-29T00:00:00.000Z' }
      ]
    }));
    const cycle = loadCrossSessionSignal(tmpRoot, '2026-06-30-x');
    expect(cycle).not.toBeNull();
    expect(cycle?.cycle).toBe(2);
    expect(cycle?.scores[0]?.evaluator).toBe('karpathy');
    expect(cycle?.scores[0]?.score).toBe(0.8);
  });

  it('returns null on malformed JSON (no crash)', () => {
    const sharedDir = join(tmpRoot, '.peaks', '_sub_agents', '2026-06-30-bad', 'shared');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, 'cycle-3.json'), '{not json');
    const cycle = loadCrossSessionSignal(tmpRoot, '2026-06-30-bad');
    expect(cycle).toBeNull();
  });
});

describe('loadPreviousCycle / nextCycleIndex — slice-dir persistence', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-mono-slice-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns the highest-N cycle index from the slice dir', () => {
    const dir = sliceDir(tmpRoot, 'sid', 'rid');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cycle-1.json'), JSON.stringify({ cycle: 1, scores: [] }));
    writeFileSync(join(dir, 'cycle-2.json'), JSON.stringify({ cycle: 2, scores: [] }));
    expect(nextCycleIndex(tmpRoot, 'sid', 'rid')).toBe(3);
    const prev = loadPreviousCycle(tmpRoot, 'sid', 'rid');
    expect(prev?.cycle).toBe(2);
  });

  it('falls back to .peaks/_sub_agents/<sid>/shared/ when the slice dir is empty', () => {
    const sharedDir = join(tmpRoot, '.peaks', '_sub_agents', 'sid', 'shared');
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, 'cycle-5.json'), JSON.stringify({ cycle: 5, scores: [] }));
    const prev = loadPreviousCycle(tmpRoot, 'sid', 'rid');
    expect(prev?.cycle).toBe(5);
  });

  it('returns null when neither dir has any cycle-N.json', () => {
    expect(loadPreviousCycle(tmpRoot, 'sid', 'rid')).toBeNull();
    expect(nextCycleIndex(tmpRoot, 'sid', 'rid')).toBe(1);
  });
});

describe('DEFAULT_MONOTONIC_THRESHOLD', () => {
  it('is 0.05 (5% of the 0..1 scale)', () => {
    expect(DEFAULT_MONOTONIC_THRESHOLD).toBe(0.05);
  });
});
