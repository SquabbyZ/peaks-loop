// tests/unit/services/loop/loop-observability-emission.test.ts
//
// `rid-dashboard-emit-contract` §5/§6 AC-1 and AC-3, as OBSERVED BEHAVIOUR.
//
// Why this file exists. The `cycle` and `monotonic-trigger` categories were
// declared in `OBSERVABILITY_CATEGORIES` and COUNTED by
// `aggregateDashboardMetrics` from the day they were added, but nothing ever
// emitted them: `emitCycleEvent` and `emitMonotonicTriggerEvent` had zero call
// sites, so `cycleCount` and `monotonicTriggerCount` could only ever be 0. A
// gate that asks "does `observability-service.ts` export a helper?" passed on
// exactly that state (rid-030's `AC-F1`). The assertions below therefore read
// the number the operator reads — the `peaks dashboard summary` payload for
// this session — and compare it against the run's OWN `summary.totalCycles`,
// never against a symbol.
//
// AC-2 is the mutation control and is NOT encoded as a test: it is the
// observation that with the `emitMonotonicReport`/`emitCycleOutcome` calls
// removed from `run-driver.ts`, the `cycleCount` assertions below go red
// (recorded in the RD handoff). The `totalCycles` control assertions are what
// make that true: without them `0 === 0` would pass.
//
// Dimensions:
//   - behavior:    the cycle/monotonic counts the emit produces for a given run
//   - integration: a real spec.yaml, the real driver, the real JSONL store
//   - render:      the `peaks dashboard summary` JSON payload an operator reads
//   - a11y:        the same payload's `ok` flag and exit code

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { runLoop, type RunDriverResult } from '../../../../src/services/loop/run-driver.js';
import { buildSpec, persistSpec } from '../../../../src/services/loop/spec-service.js';
import type { EvaluatorVerdictEnvelope } from '../../../../src/services/loop/evaluator-dispatcher.js';
import { readMetricLines } from '../../../../src/services/observability/jsonl-store.js';
import { registerDashboardSummaryCommand } from '../../../../src/cli/commands/dashboard-summary.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/loop/loop-observability-emission.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/** Matches the spec lint's `rid` rule (`/^[a-z][a-z0-9-]*$/`). */
const RID = 'emit-contract-cycle';

const roots: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-loop-emit-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
});

function verdict(gateAction: 'pass' | 'block'): EvaluatorVerdictEnvelope {
  return {
    kind: 'karpathy',
    passed: gateAction === 'pass',
    gateAction,
    violations: [],
    summary: `emit-contract fixture verdict: ${gateAction}`,
    wallSeconds: 0,
    degraded: false
  };
}

/** A one-evaluator spec, so one dispatch per cycle and one score row per cycle. */
function writeSpec(projectRoot: string, sid: string, maxCycles: number): void {
  persistSpec(
    projectRoot,
    sid,
    buildSpec(
      {
        rid: RID,
        evaluators: [{ kind: 'karpathy' }],
        sla: [{ evaluator: 'karpathy', maxScore: 0.7 }],
        termination: { strategy: 'max-cycles', maxCycles }
      },
      RID
    )
  );
}

/** Drive the loop; `statuses[i]` is the verdict cycle i+1's evaluator returns. */
function runCycles(
  projectRoot: string,
  sid: string,
  statuses: readonly ('pass' | 'block')[]
): RunDriverResult {
  let call = 0;
  return runLoop({
    projectRoot,
    sid,
    rid: RID,
    dispatchOverride: () => {
      const at = Math.min(call, statuses.length - 1);
      call += 1;
      return verdict(statuses[at] ?? 'pass');
    }
  });
}

type RawEvent = { category?: unknown; detail?: Record<string, unknown> };

/** The event lines as written, parsed here rather than through the aggregator. */
function rawEvents(projectRoot: string, sid: string): RawEvent[] {
  return readMetricLines(projectRoot, sid).map((line) => JSON.parse(line) as RawEvent);
}

type Metrics = {
  cycleCount: number;
  tokenCount: number;
  dispatchCount: number;
  compactCount: number;
  monotonicTriggerCount: number;
};

/** The number the operator reads: the real `peaks dashboard summary` payload. */
async function dashboardSummary(
  projectRoot: string,
  sid: string
): Promise<{ ok: boolean; metrics: Metrics }> {
  const out: string[] = [];
  const io: ProgramIO = { stdout: (s) => out.push(s), stderr: (s) => out.push(s) };
  const program = new Command();
  registerDashboardSummaryCommand(program, io);
  await program.parseAsync(
    ['summary', '--project', projectRoot, '--session-id', sid, '--since', '24h', '--json'],
    { from: 'user' }
  );
  const payload = JSON.parse(out.join('')) as { ok: boolean; data: { metrics: Metrics } };
  return { ok: payload.ok, metrics: payload.data.metrics };
}

describe('loop observability emission — behavior', () => {
  it('when the driver runs 3 cycles, should report a cycleCount equal to the run’s own totalCycles', async () => {
    // given: a 3-cycle spec in a fresh session, every evaluator passing
    const projectRoot = newRoot();
    const sid = 'ac1-session';
    writeSpec(projectRoot, sid, 3);

    // when: the loop runtime runs
    const result = runCycles(projectRoot, sid, ['pass']);

    // then: the run really did 3 cycles (the control — without it the equality
    // below could be satisfied by 0 === 0, which is the rid-030 shape)
    expect(result.summary.totalCycles).toBe(3);

    // then: the dashboard the operator reads agrees with the run
    const { metrics } = await dashboardSummary(projectRoot, sid);
    expect(metrics.cycleCount).toBeGreaterThan(0);
    expect(metrics.cycleCount).toBe(result.summary.totalCycles);
  });

  it('when the first cycle has no predecessor, should not count its skip as a monotonic trigger', async () => {
    // given: a 3-cycle run whose cycles 2 and 3 hold or improve
    const projectRoot = newRoot();
    const sid = 'ac3-session';
    writeSpec(projectRoot, sid, 3);

    // when: the loop runtime runs
    const result = runCycles(projectRoot, sid, ['pass']);

    // then: the guard really did return `skip` for cycle 1 — the case that must
    // NOT be counted, asserted present rather than assumed absent
    expect(result.cycles.map((c) => c.monotonicReport.status)).toEqual(['skip', 'pass', 'pass']);

    // then: only the pass/block cycles are counted (2 of 3)
    const { metrics } = await dashboardSummary(projectRoot, sid);
    expect(metrics.monotonicTriggerCount).toBe(2);
  });

  it('when a cycle regresses past the threshold, should count it once and label that cycle failed', async () => {
    // given: cycle 1 passes, cycle 2 regresses to the block floor
    const projectRoot = newRoot();
    const sid = 'ac3-block-session';
    writeSpec(projectRoot, sid, 3);

    // when: the driver runs (and aborts on the violation)
    const result = runCycles(projectRoot, sid, ['pass', 'block']);

    // then: two cycles ran, the second being the violating one
    expect(result.summary.totalCycles).toBe(2);
    expect(result.cycles[1]?.monotonicReport.status).toBe('block');

    // then: `block` counts exactly once, and the skipped cycle is still not counted
    const { metrics } = await dashboardSummary(projectRoot, sid);
    expect(metrics.cycleCount).toBe(2);
    expect(metrics.monotonicTriggerCount).toBe(1);
  });
});

describe('loop observability emission — integration', () => {
  it('when the run finishes, should write one cycle event per cycle and one trigger event per verdict', async () => {
    // given: a 3-cycle run
    const projectRoot = newRoot();
    const sid = 'ac1-raw-session';
    writeSpec(projectRoot, sid, 3);

    // when: the loop runtime runs
    const result = runCycles(projectRoot, sid, ['pass']);
    const events = rawEvents(projectRoot, sid);

    // then: the count is in the session's own event lines, read directly rather
    // than through `aggregateDashboardMetrics`
    const cycleEvents = events.filter((e) => e.category === 'cycle');
    const triggerEvents = events.filter((e) => e.category === 'monotonic-trigger');
    expect(cycleEvents).toHaveLength(result.summary.totalCycles);
    expect(triggerEvents).toHaveLength(2);

    // then: ONE event per cycle, `completed` unless the cycle violated — never
    // `started` as well, which would double the count `aggregation.ts:212` makes
    expect(cycleEvents.map((e) => e.detail?.['status'])).toEqual([
      'completed',
      'completed',
      'completed'
    ]);
    expect(cycleEvents.every((e) => typeof e.detail?.['cycle'] === 'number')).toBe(true);

    // then: the trigger events carry the guard's own code, not a new vocabulary
    expect(triggerEvents.map((e) => e.detail?.['action'])).toEqual([
      'MONOTONIC_OK',
      'MONOTONIC_OK'
    ]);
    expect(triggerEvents.every((e) => e.detail?.['report'] === 'pass')).toBe(true);
  });

  it('when a cycle violates, should write that cycle’s event with status failed', async () => {
    // given: a run that regresses on its second cycle
    const projectRoot = newRoot();
    const sid = 'ac2-raw-session';
    writeSpec(projectRoot, sid, 3);

    // when: the loop runtime runs
    runCycles(projectRoot, sid, ['pass', 'block']);

    // then: the outcome is recorded on the cycle it belongs to
    const cycleEvents = rawEvents(projectRoot, sid).filter((e) => e.category === 'cycle');
    expect(cycleEvents.map((e) => e.detail?.['status'])).toEqual(['completed', 'failed']);
  });
});

describe('loop observability emission — render', () => {
  it('when the session has no loop run, should still report the metrics block with zeros', async () => {
    // given: a session whose loop has never run
    const projectRoot = newRoot();
    const sid = 'ac1-idle-session';
    writeSpec(projectRoot, sid, 3);

    // when: the dashboard is read
    const { metrics } = await dashboardSummary(projectRoot, sid);

    // then: the three loop-side categories read 0 as a reading ("nothing ran"),
    // and the payload keeps the shape the reader expects
    expect(metrics).toEqual({
      cycleCount: 0,
      tokenCount: 0,
      dispatchCount: 0,
      compactCount: 0,
      monotonicTriggerCount: 0
    });
  });
});

describe('loop observability emission — a11y', () => {
  it('when the dashboard is read in JSON mode, should answer with a successful envelope', async () => {
    // given: a session with one completed loop run
    const projectRoot = newRoot();
    const sid = 'ac1-envelope-session';
    writeSpec(projectRoot, sid, 2);
    runCycles(projectRoot, sid, ['pass']);

    // when: the operator reads the dashboard
    const { ok } = await dashboardSummary(projectRoot, sid);

    // then: the envelope succeeded, and the process did not set a failure code
    expect(ok).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });
});
