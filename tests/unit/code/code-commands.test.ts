/**
 * Slice 2 — peaks-code fast mode.
 *
 * `peaks code [--fast] <change-id>` runs the LLM-side code workflow.
 * With `--fast`, three steps are skipped:
 *   1. project memory full load (use --tag filter / last-touched subset)
 *   2. standards preflight (5-axis rule fan-out)
 *   3. QA repair loop (single QA round, accept GO on test+tsc+lint pass)
 *
 * Round-trip KPI: ≤ 30s from invocation to peaks-txt completion.
 */

import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import {
  buildCodePlan,
  runCodeFast,
  type CodePlan,
  type CodeRunResult
} from '../../../src/cli/commands/code-commands.js';

const SAMPLE_PLAN: CodePlan = {
  sessionId: '014-full-dogfood',
  steps: [
    { id: 'load-memory', kind: 'memory', skipped: false },
    { id: 'standards-preflight', kind: 'preflight', skipped: false },
    { id: 'rd-cycle', kind: 'rd', skipped: false },
    { id: 'qa-cycle', kind: 'qa', skipped: false, repairLoop: true },
    { id: 'emit-txt', kind: 'emit', skipped: false }
  ]
};

/**
 * Fast-mode plan is what `peaks code plan --fast` produces — passed
 * into `runCodeFast` to drive the skip behavior.
 */
const FAST_PLAN: CodePlan = {
  sessionId: '014-full-dogfood',
  steps: [
    { id: 'load-memory', kind: 'memory', skipped: true },
    { id: 'standards-preflight', kind: 'preflight', skipped: true },
    { id: 'rd-cycle', kind: 'rd', skipped: false },
    { id: 'qa-cycle', kind: 'qa', skipped: false, repairLoop: false },
    { id: 'emit-txt', kind: 'emit', skipped: false }
  ]
};

describe('code-commands: buildCodePlan', () => {
  test('default plan includes all 5 steps with memory + preflight + repair', () => {
    const plan = buildCodePlan({ sessionId: '014-full-dogfood', fast: false });
    expect(plan.sessionId).toBe('014-full-dogfood');
    expect(plan.steps.map((s) => s.id)).toEqual([
      'load-memory',
      'standards-preflight',
      'rd-cycle',
      'qa-cycle',
      'emit-txt'
    ]);
    expect(plan.steps.find((s) => s.id === 'load-memory')?.skipped).toBe(false);
    expect(plan.steps.find((s) => s.id === 'standards-preflight')?.skipped).toBe(false);
    const qa = plan.steps.find((s) => s.id === 'qa-cycle');
    expect(qa?.repairLoop).toBe(true);
  });

  test('--fast plan marks memory + preflight as skipped and qa without repairLoop', () => {
    const plan = buildCodePlan({ sessionId: '014-full-dogfood', fast: true });
    expect(plan.steps.find((s) => s.id === 'load-memory')?.skipped).toBe(true);
    expect(plan.steps.find((s) => s.id === 'standards-preflight')?.skipped).toBe(true);
    const qa = plan.steps.find((s) => s.id === 'qa-cycle');
    expect(qa?.skipped).toBe(false);
    expect(qa?.repairLoop).toBe(false);
    const rd = plan.steps.find((s) => s.id === 'rd-cycle');
    expect(rd?.skipped).toBe(false);
    const emit = plan.steps.find((s) => s.id === 'emit-txt');
    expect(emit?.skipped).toBe(false);
  });

  test('plan preserves order and emits last', () => {
    const plan = buildCodePlan({ sessionId: 'abc', fast: false });
    expect(plan.steps.at(-1)?.id).toBe('emit-txt');
  });
});

describe('code-commands: runCodeFast', () => {
  let memSpy: Mock<(ctx: { sessionId: string }) => Promise<unknown>>;
  let prefSpy: Mock<(ctx: { sessionId: string }) => Promise<unknown>>;
  let rdSpy: Mock<(ctx: { sessionId: string }) => Promise<unknown>>;
  let qaSpy: Mock<(ctx: { sessionId: string; repairLoop: boolean }) => Promise<unknown>>;
  let emitSpy: Mock<(ctx: { sessionId: string }) => Promise<unknown>>;

  beforeEach(() => {
    memSpy = vi.fn().mockResolvedValue({ loaded: 4 });
    prefSpy = vi.fn().mockResolvedValue({ ok: true });
    rdSpy = vi.fn().mockResolvedValue({ ok: true });
    qaSpy = vi.fn().mockResolvedValue({ ok: true, repairRounds: 0 });
    emitSpy = vi.fn().mockResolvedValue({ path: 'tmp/x.txt' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('fast run skips memory + preflight and calls qa once without repair', async () => {
    const result = await runCodeFast({
      sessionId: '014-full-dogfood',
      plan: FAST_PLAN,
      hooks: { memory: memSpy, preflight: prefSpy, rd: rdSpy, qa: qaSpy, emit: emitSpy }
    });

    expect(memSpy).not.toHaveBeenCalled();
    expect(prefSpy).not.toHaveBeenCalled();
    expect(rdSpy).toHaveBeenCalledTimes(1);
    expect(qaSpy).toHaveBeenCalledTimes(1);
    // fast mode passes repairLoop:false into qa hook
    expect(qaSpy.mock.calls[0]?.[0]).toMatchObject({ repairLoop: false });
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.skipped).toEqual(
      expect.arrayContaining(['load-memory', 'standards-preflight'])
    );
  });

  test('non-fast run invokes all hooks including qa with repairLoop=true', async () => {
    const nonFastPlan = buildCodePlan({ sessionId: 'abc', fast: false });
    const result = await runCodeFast({
      sessionId: 'abc',
      plan: nonFastPlan,
      hooks: { memory: memSpy, preflight: prefSpy, rd: rdSpy, qa: qaSpy, emit: emitSpy }
    });

    expect(memSpy).toHaveBeenCalledTimes(1);
    expect(prefSpy).toHaveBeenCalledTimes(1);
    expect(rdSpy).toHaveBeenCalledTimes(1);
    expect(qaSpy).toHaveBeenCalledTimes(1);
    expect(qaSpy.mock.calls[0]?.[0]).toMatchObject({ repairLoop: true });
    expect(result.skipped).toEqual([]);
  });

  test('skipped steps do not contribute to elapsed time', async () => {
    memSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { loaded: 1 };
    });
    prefSpy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return { ok: true };
    });
    const result = await runCodeFast({
      sessionId: 'x',
      plan: FAST_PLAN,
      hooks: { memory: memSpy, preflight: prefSpy, rd: rdSpy, qa: qaSpy, emit: emitSpy }
    });

    // fast mode should NOT pay the 100ms memory + 100ms preflight cost
    // (small CI jitter allowance: elapsedMs < 150ms means both skipped)
    expect(result.elapsedMs).toBeLessThan(150);
  });

  test('returns CodeRunResult shape with skipped ids', async () => {
    const plan = buildCodePlan({ sessionId: 'fast-mode', fast: true });
    const result: CodeRunResult = await runCodeFast({
      sessionId: 'fast-mode',
      plan,
      hooks: { memory: memSpy, preflight: prefSpy, rd: rdSpy, qa: qaSpy, emit: emitSpy }
    });

    expect(result).toMatchObject({
      sessionId: 'fast-mode',
      ok: true,
      steps: expect.arrayContaining([
        expect.objectContaining({ id: 'load-memory', skipped: true })
      ]),
      skipped: expect.arrayContaining(['load-memory', 'standards-preflight'])
    });
  });
});
