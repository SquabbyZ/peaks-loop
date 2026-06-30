/**
 * peaks-loop v3.0.0 — Slice F (P0) tests
 *
 * Closed-loop driver tests for `peaks loop run <rid>`. The 8 cases
 * below mirror the dispatch prompt's required coverage:
 *  1. SPEC_NOT_FOUND (no spec.yaml)
 *  2. SPEC_INVALID (lint failure)
 *  3. UNKNOWN_TERMINATION_STRATEGY (garbage strategy)
 *  4. 1 cycle, no previous → skip → exit 0
 *  5. 2 cycles, regression > threshold → MONOTONICITY_VIOLATION
 *  6. 5 cycles, all held → reached maxCycles 5
 *  7. evaluator throws → still completes cycle, no infinite retry
 *  8. concurrent run → second call LOCKED
 *
 * Karpathy §2: tests are pure-data + a small in-process dispatch
 * override. No shell-out, no network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  runLoop,
  _clearRunLocks,
  cyclesDir,
  type RunDriverResult
} from '../../../src/services/loop/run-driver.js';
import {
  persistSpec,
  buildSpec,
  specPath
} from '../../../src/services/loop/spec-service.js';
import type { EvaluatorVerdictEnvelope } from '../../../src/services/loop/evaluator-dispatcher.js';

const TMP_SESSION = '2026-07-01-run-driver-test';

const FAKE_ENVELOPE = (
  kind: string,
  gate: 'pass' | 'warn' | 'block' = 'pass',
  degraded = false
): EvaluatorVerdictEnvelope => ({
  kind: kind as EvaluatorVerdictEnvelope['kind'],
  passed: gate === 'pass',
  gateAction: gate,
  violations: [],
  summary: `${kind}: ${gate}`,
  wallSeconds: 0,
  degraded
});

/** Build a synthetic spec with the given evaluators + strategy. */
function writeSpec(
  tmpRoot: string,
  rid: string,
  evaluators: string[],
  strategy: 'monotonic-violation' | 'max-cycles' | 'manual',
  maxCycles?: number
): void {
  const spec = buildSpec({
    rid,
    evaluators: evaluators.map((k) => ({ kind: k })),
    sla: evaluators.map((k) => ({ evaluator: k, maxScore: 0.7 })),
    termination: { strategy, ...(maxCycles !== undefined ? { maxCycles } : {}) }
  }, rid);
  persistSpec(tmpRoot, TMP_SESSION, spec);
}

describe('runLoop — error boundaries', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-rundriver-'));
    _clearRunLocks();
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    _clearRunLocks();
  });

  it('1. returns SPEC_NOT_FOUND when no spec.yaml exists', () => {
    const result = runLoop({ projectRoot: tmpRoot, sid: TMP_SESSION, rid: 'no-such-rid' });
    expect(result.code).toBe('SPEC_NOT_FOUND');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no spec\.yaml/);
    expect(result.cycles).toEqual([]);
  });

  it('2. returns SPEC_INVALID when spec.yaml fails lint', () => {
    // Write a spec that references an unknown SLA — direct lint fail.
    const badPath = specPath(tmpRoot, TMP_SESSION, 'bad-rid');
    const yaml = [
      '---',
      'schemaVersion: 1',
      'rid: bad-rid',
      'evaluators:',
      '  - kind: karpathy',
      'sla:',
      '  - evaluator: not-declared, maxScore: 0.5',
      'termination:',
      `  strategy: monotonic-violation`
    ].join('\n');
    // Persist via the spec service so the dir is created; we then
    // overwrite with a syntactically-valid-but-semantically-broken file.
    const tmp = buildSpec({
      rid: 'bad-rid',
      evaluators: [{ kind: 'karpathy' }],
      sla: [],
      termination: { strategy: 'monotonic-violation' }
    }, 'bad-rid');
    persistSpec(tmpRoot, TMP_SESSION, tmp);
    writeFileSync(badPath, yaml, 'utf8');
    const result = runLoop({ projectRoot: tmpRoot, sid: TMP_SESSION, rid: 'bad-rid' });
    expect(result.code).toBe('SPEC_INVALID');
    expect(result.ok).toBe(false);
  });

  it('3. returns UNKNOWN_TERMINATION_STRATEGY for a bogus strategy', () => {
    writeSpec(tmpRoot, 'bogus-rid', ['karpathy'], 'monotonic-violation');
    const result = runLoop({
      projectRoot: tmpRoot,
      sid: TMP_SESSION,
      rid: 'bogus-rid',
      strategyOverride: 'no-such-strategy' as unknown as 'monotonic-violation'
    });
    expect(result.code).toBe('UNKNOWN_TERMINATION_STRATEGY');
    expect(result.strategy).toBe('unknown');
  });
});

describe('runLoop — strategy semantics', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-rundriver-'));
    _clearRunLocks();
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    _clearRunLocks();
  });

  it('4. 1 cycle, no previous cycle → skip → RUN_OK exit 0', () => {
    writeSpec(tmpRoot, 'happy-1', ['karpathy', 'code-review'], 'monotonic-violation');
    const calls: string[] = [];
    const result = runLoop({
      projectRoot: tmpRoot,
      sid: TMP_SESSION,
      rid: 'happy-1',
      dispatchOverride: (kind) => {
        calls.push(kind);
        return FAKE_ENVELOPE(kind, 'pass');
      },
      maxCyclesOverride: 1
    });
    expect(result.code).toBe('RUN_OK');
    expect(result.ok).toBe(true);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.monotonicReport.code).toBe('MONOTONIC_NO_PREVIOUS');
    expect(result.summary.totalCycles).toBe(1);
    expect(result.summary.regressionCount).toBe(0);
    expect(calls).toEqual(['karpathy', 'code-review']);
  });

  it('5. 2 cycles, regression > threshold → MONOTONICITY_VIOLATION', () => {
    writeSpec(tmpRoot, 'regr', ['karpathy'], 'monotonic-violation');
    let n = 0;
    const result = runLoop({
      projectRoot: tmpRoot,
      sid: TMP_SESSION,
      rid: 'regr',
      dispatchOverride: (kind) => {
        n++;
        // First call: pass (score 1.0). Second call: block (score 0.0).
        const gate = n === 1 ? 'pass' : 'block';
        return FAKE_ENVELOPE(kind, gate);
      },
      maxCyclesOverride: 2
    });
    expect(result.code).toBe('MONOTONICITY_VIOLATION');
    expect(result.ok).toBe(false);
    expect(result.cycles.length).toBe(2);
    expect(result.cycles[1]?.monotonicReport.code).toBe('MONOTONIC_VIOLATION');
    expect(result.cycles[1]?.monotonicReport.regressions.length).toBeGreaterThan(0);
    expect(result.summary.regressionCount).toBeGreaterThan(0);
  });

  it('6. 5 cycles all held → reached maxCycles 5 with 0 regressions', () => {
    writeSpec(tmpRoot, 'five', ['karpathy'], 'monotonic-violation');
    const result = runLoop({
      projectRoot: tmpRoot,
      sid: TMP_SESSION,
      rid: 'five',
      dispatchOverride: (kind) => FAKE_ENVELOPE(kind, 'pass'),
      maxCyclesOverride: 5
    });
    // Default strategy is monotonic-violation; with all-pass synthetic
    // data, the driver runs all 5 cycles to completion.
    expect(result.code).toBe('RUN_OK');
    expect(result.cycles).toHaveLength(5);
    expect(result.summary.reachedMaxCycles).toBe(true);
    expect(result.summary.regressionCount).toBe(0);
    expect(result.summary.totalCycles).toBe(5);
  });

  it('7. evaluator throws on 3 dispatches → cycle still completes, no retry storm', () => {
    writeSpec(tmpRoot, 'flaky', ['karpathy', 'code-review', 'security-review'], 'monotonic-violation');
    let calls = 0;
    const result = runLoop({
      projectRoot: tmpRoot,
      sid: TMP_SESSION,
      rid: 'flaky',
      dispatchOverride: (kind) => {
        calls++;
        if (calls <= 3) throw new Error('boom');
        return FAKE_ENVELOPE(kind, 'pass');
      },
      maxCyclesOverride: 1
    });
    expect(result.code).toBe('RUN_OK');
    expect(result.cycles).toHaveLength(1);
    // 3 of 3 evaluators threw → all 3 rows are degraded (the loop
    // never retries a single evaluator; "3 calls, 3 results" is the
    // contract).
    const rows = result.cycles[0]?.rows ?? [];
    const degraded = rows.filter((r) => r.degraded).length;
    expect(degraded).toBe(3);
    // Total call count = exactly 3, NOT a retry storm.
    expect(calls).toBe(3);
  });

  it('8. concurrent run on the same rid → second call returns LOCKED', () => {
    writeSpec(tmpRoot, 'concur', ['karpathy'], 'monotonic-violation');
    // Acquire the in-process lock manually to simulate an in-flight run.
    const key = `${TMP_SESSION}::concur`;
    // Use the registry via runLoop's own path: the first call will
    // release the lock when it returns, so we keep a fake lock open
    // by reading the globals map directly. We re-use the test seam
    // _clearRunLocks has been called in beforeEach; we now set it
    // before the test body runs.
    const lockMap = (globalThis as unknown as { __PEAKS_RUN_LOCKS__: Map<string, true> }).__PEAKS_RUN_LOCKS__;
    lockMap.set(key, true);
    try {
      const second = runLoop({
        projectRoot: tmpRoot,
        sid: TMP_SESSION,
        rid: 'concur',
        dispatchOverride: (kind) => FAKE_ENVELOPE(kind, 'pass')
      });
      expect(second.code).toBe('LOCKED');
      expect(second.ok).toBe(false);
    } finally {
      lockMap.delete(key);
    }
  });
});

describe('runLoop — cycle persistence', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-rundriver-'));
    _clearRunLocks();
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    _clearRunLocks();
  });

  it('persists cycle-N.json under .peaks/_runtime/<sid>/loop/<rid>/cycles/', () => {
    writeSpec(tmpRoot, 'persist', ['karpathy'], 'monotonic-violation');
    const result: RunDriverResult = runLoop({
      projectRoot: tmpRoot,
      sid: TMP_SESSION,
      rid: 'persist',
      dispatchOverride: (kind) => FAKE_ENVELOPE(kind, 'pass'),
      maxCyclesOverride: 1
    });
    expect(result.code).toBe('RUN_OK');
    const dir = cyclesDir(tmpRoot, TMP_SESSION, 'persist');
    expect(existsSync(join(dir, 'cycle-1.json'))).toBe(true);
    const raw = readFileSync(join(dir, 'cycle-1.json'), 'utf8');
    const parsed = JSON.parse(raw) as { scores: Array<{ evaluator: string; score: number }> };
    expect(parsed.scores[0]?.evaluator).toBe('karpathy');
    expect(parsed.scores[0]?.score).toBe(1.0);
  });
});
