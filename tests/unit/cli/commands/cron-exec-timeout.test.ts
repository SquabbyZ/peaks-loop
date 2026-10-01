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

import { execSync } from 'node:child_process';
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
