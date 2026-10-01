// tests/unit/cli/commands/cron-exec-timeout.test.ts
//
// rid 2026-10-01-cron-exec-timeout-01 (bugfix, test-first) —
// `EXEC_TIMEOUT_MS` is computed as `5 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE
// * MS_PER_SECOND`, and `MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND`
// is ONE HOUR, so the value was 18,000,000 ms (5 h) while its name, its
// comment and `runTask`'s intent mean five MINUTES (300,000 ms). `runTask`
// handed that number to `execSync(…, { timeout })` — the shell shape that rid
// 2026-10-01-cron-task-tree-kill-01 later replaced with
// `spawnSync(process.execPath, [entry, …])` — so a stalled task child was left
// running for five hours instead of being reaped — the *amplifier* of the
// process population measured in
// `.peaks/docs/diagnosis-2026-10-01-worktree-list-population.md` §1.
//
// THIS FILE IS THE AMPLIFIER'S GUARD, NOT THE EMITTER'S FIX. The emitter (what
// spawns the burst in the first place) is still unidentified (§8) and is out of
// scope here.
//
// Dimensions (per `.peaks/standards/typescript/testing.md`):
//   render      — the exported numeric constant itself.
//   behavior    — RAW `execSync`'s timeout mechanism reports a killed/timed-out
//                 child. Since rid 2026-10-01-cron-task-tree-kill-01 this block
//                 measures the mechanism §2.21 shipped with, not `runTask`'s
//                 current spawn shape; the wiring guard is
//                 `cron-task-tree-kill.test.ts`.
//   integration — runTask wires a real subprocess across the timeout boundary,
//                 with a positive control so the assertion cannot be satisfied
//                 by the child simply never running.
//   a11y        — OMITTED: this slice adds no human-visible text, exit-code
//                 rendering or structured message; the RunRecord shape is
//                 unchanged.
//
// THE BOUNDING ARM AT THE BOTTOM IS FROM REPAIR CYCLE 1 OF A DIFFERENT RID
// (`2026-10-01-cron-last-run-at-01`, review F2). The scheduler's killed-run rule
// (`src/cli/commands/cron-scheduler-persist.ts`, rule 2) claims a permanently stuck
// task "costs at most one fire per exec timeout, not one per tick", and nothing in
// the committed suite measured the quantity that claim rests on: the killed arm of
// `cron-last-run-at.test.ts` replaces `runTask` with a stub that returns in
// microseconds, so the retries it counts are spaced by the fake tick it advances,
// not by anything real. The two arms below go through `runTask`'s third parameter
// (`cron-commands.ts:209-218`, the test seam that defaults to `EXEC_TIMEOUT_MS`) and
// measure the wall clock a caller loses to one killed fire, plus a positive control
// that a concluded fire returns in a small fraction of the same window.

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { EXEC_TIMEOUT_MS, runTask, type ScheduleEntry } from '~/src/cli/commands/cron-commands';

declareDimensions(
  'tests/unit/cli/commands/cron-exec-timeout.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'no human-visible text / exit-code / error-message surface changes; RunRecord shape untouched'
    }
  ]
);

const getWs = withTmpWorkspacePerTest('peaks-cron-exec-timeout-');

const FIVE_MINUTES_MS = 300_000;
const ONE_HOUR_MS = 3_600_000;

// A real subprocess that reliably takes ≫ KILL_MS but ≪ GENEROUS_MS, so the
// kill arm cannot pass by luck and the positive control cannot pass by the
// child never running. `peaks --version` boots the CLI (~1.1 s measured on this
// host) and exits 0 with no side effects in any cwd.
const KILL_MS = 50;
const GENEROUS_MS = 20_000;

function versionTask(): ScheduleEntry {
  return {
    id: 'exec-timeout-probe',
    name: 'peaks --version probe',
    command: '--version',
    args: [],
    intervalMs: ONE_HOUR_MS,
    lastRunAt: null,
    enabled: true,
    createdAt: Date.now()
  };
}

describe('render — EXEC_TIMEOUT_MS means five minutes, not five hours', () => {
  it('equals 300000 ms (5 * 60 * 1000)', () => {
    // Red before the fix: the expression `5 * MINUTES_PER_HOUR *
    // SECONDS_PER_MINUTE * MS_PER_SECOND` evaluates to 18000000.
    expect(EXEC_TIMEOUT_MS).toBe(FIVE_MINUTES_MS);
  });

  it('is NOT five hours (the value one hour times five would give)', () => {
    expect(EXEC_TIMEOUT_MS).not.toBe(5 * ONE_HOUR_MS);
  });
});

// Measures RAW `execSync`, i.e. the mechanism §2.21 shipped with — `runTask` has
// used `spawnSync(process.execPath, [entry, …])` since rid
// 2026-10-01-cron-task-tree-kill-01. Kept because the constant's unit test is
// about the number this call site hands to a timeout; the CURRENT wiring is
// guarded by `cron-task-tree-kill.test.ts` and by the integration block below.
describe('behavior — execSync honors an injected short timeout on a real stalled child', () => {
  it('reports a command that outlives its timeout as ETIMEDOUT / killed', () => {
    let caught: unknown;
    try {
      // Sleeps 5 s but is killed at KILL_MS — the suite never waits for it.
      execSync('node -e "setTimeout(() => {}, 5000)"', {
        timeout: KILL_MS,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        windowsHide: true
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { code?: string; killed?: boolean };
    // On win32 a timed-out execSync throws with code ETIMEDOUT (killed is the
    // POSIX shape); assert either so the guard is platform-honest.
    expect(e.code === 'ETIMEDOUT' || e.killed === true).toBe(true);
  });

  it('positive control: the same mechanism with a generous timeout does not throw', () => {
    expect(() =>
      execSync('node -e "process.exit(0)"', { timeout: GENEROUS_MS, windowsHide: true })
    ).not.toThrow();
  });
});

describe('integration — runTask reaps a task child that exceeds its timeout', () => {
  it('records a non-zero exit (does not return success) when the child outlives the injected timeout', () => {
    const ws = getWs();
    const record = runTask(ws.path, versionTask(), KILL_MS);
    expect(record.exitCode).not.toBe(0);
  });

  it('positive control: the same task with a generous timeout succeeds (the child really ran)', () => {
    const ws = getWs();
    const record = runTask(ws.path, versionTask(), GENEROUS_MS);
    expect(record.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The bounding arms (repair cycle 1 of rid `2026-10-01-cron-last-run-at-01`, F2).
// `persistLastRunAt`'s rule 2 says a killed run stays due and that the retry is
// therefore "at most one fire per exec timeout, not one per tick". The quantity that
// bound is made of is the WALL CLOCK one killed fire costs its caller, because the
// daemon's tick is a synchronous callback on one `setInterval`
// (`cron-scheduler-commands.ts:378`) and cannot overlap itself. Nothing in the
// committed suite measured it before this pair of arms: `cron-last-run-at.test.ts`
// replaces `runTask` with a stub that returns in microseconds, so its 3 fires are
// spaced by the fake tick it advances, not by any timeout. What the arms assert is a
// lower bound (>= `BOUND_TIMEOUT_MS`) and an upper bound on the positive control
// (< `BOUND_CONCLUDES_WITHIN_MS`); the values this host actually produced, read off
// the same shape twice more against `dist/` by hand, were 3,019 ms and 3,020 ms of
// block for the killed fire and 67 ms and 71 ms for the concluding one — i.e. the
// block IS the injected timeout, and a concluded fire is ~45x cheaper, so at
// `EXEC_TIMEOUT_MS` = 300,000 ms a permanently stuck entry costs at most
// 3,600,000 / 300,000 = 12 fires per hour rather than 3,600,000 / 60,000 = 60.
// ---------------------------------------------------------------------------

/** Injected exec timeout for the bounding arms — the value whose block they measure. */
const BOUND_TIMEOUT_MS = 3_000;
/** How long the fixture child holds for: ≫ `BOUND_TIMEOUT_MS`, so the timeout branch always runs. */
const BOUND_HOLD_MS = 30_000;
/** Ceiling on a killed fire's block: the timeout plus this slack, so the 30 s hold can never leak through. */
const BOUND_SLACK_MS = 20_000;
/** A concluded fire must return inside this window — an 8x margin over a bare node boot. */
const BOUND_CONCLUDES_WITHIN_MS = 1_500;
/** argv that makes the fixture hold, and a marker that keeps its process findable in a sweep. */
const BOUND_HOLD_FLAG = '--hold';
const BOUND_MARKER = 'exec-timeout-bounding-probe';

/**
 * A project-local task entry that either holds for `BOUND_HOLD_MS` or exits 0 —
 * the two shapes the pair of arms needs from one fixture.
 */
function installBoundingTaskEntry(root: string): void {
  mkdirSync(join(root, 'bin'), { recursive: true });
  // `resolveTaskEntry` accepts a project `bin/peaks.js` only when its package is
  // BUILT (`isBootableTaskEntry`, `cron-commands.ts:109-111`) — the same marker
  // `cron-task-tree-kill.test.ts` writes for its fake CLI.
  mkdirSync(join(root, 'dist', 'cli'), { recursive: true });
  writeFileSync(join(root, 'dist', 'cli', 'index.js'), '', 'utf8');
  writeFileSync(
    join(root, 'bin', 'peaks.js'),
    [
      '// Fixture for the bounding arms of this file — holds or exits 0 on argv.',
      `const holdAt = process.argv.indexOf(${JSON.stringify(BOUND_HOLD_FLAG)});`,
      'if (holdAt === -1) process.exit(0);',
      'setTimeout(() => {}, Number(process.argv[holdAt + 1]));',
      ''
    ].join('\n'),
    'utf8'
  );
}

function boundingTask(hold: boolean): ScheduleEntry {
  return {
    id: BOUND_MARKER,
    name: 'exec-timeout bounding fixture',
    command: BOUND_MARKER,
    args: hold ? [BOUND_HOLD_FLAG, String(BOUND_HOLD_MS)] : [],
    intervalMs: ONE_HOUR_MS,
    lastRunAt: null,
    enabled: true,
    createdAt: Date.now()
  };
}

describe('behavior — a killed fire is spaced by the injected timeout, not by the tick', () => {
  it('costs its caller at least the injected exec timeout when the child cannot finish', () => {
    // given: a task entry that holds for 30 s and an injected 3 s exec timeout
    // when: runTask fires it through spawnSync with the production option shape
    // then: the record is a KILLED one and the caller lost at least the injected timeout
    //   of wall clock (never the 30 s hold) — the quantity rule 2's bound is built from
    const ws = getWs();
    installBoundingTaskEntry(ws.path);
    const startedAt = Date.now();
    const record = runTask(ws.path, boundingTask(true), BOUND_TIMEOUT_MS);
    const blockedMs = Date.now() - startedAt;

    expect(record.killed).toBe(true);
    expect(blockedMs).toBeGreaterThanOrEqual(BOUND_TIMEOUT_MS);
    expect(blockedMs).toBeLessThan(BOUND_TIMEOUT_MS + BOUND_SLACK_MS);
  });

  it('positive control: the same wiring returns inside a fraction of that window once the child concludes', () => {
    // given: the same fixture, told to exit 0 instead of holding, and the SAME injected
    //   timeout
    // when: runTask fires it
    // then: no `killed` key and a block well under the timeout — so the figure above
    //   comes from the timeout branch, not from spawn or fixture overhead
    const ws = getWs();
    installBoundingTaskEntry(ws.path);
    const startedAt = Date.now();
    const record = runTask(ws.path, boundingTask(false), BOUND_TIMEOUT_MS);
    const blockedMs = Date.now() - startedAt;

    expect(record.exitCode).toBe(0);
    expect(record.killed).toBeUndefined();
    expect(blockedMs).toBeLessThan(BOUND_CONCLUDES_WITHIN_MS);
  });
});
