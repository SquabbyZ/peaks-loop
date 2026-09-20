// tests/unit/cli/job-exit-code.test.ts
//
// F1 (rid 2026-09-17-exit-code-truth) — `peaks job <sub>` reported a failure and
// exited 0.
//
// THE DEFECT THIS PINS. `printResult` (`src/cli/cli-helpers.ts`) renders a
// failed envelope — `CODE: message` + `nextActions` on stderr — but does NOT
// set `process.exitCode`. Nine sites in `src/cli/commands/job-commands.ts`
// reported a failure through a `fail(...)` envelope; only the two `job progress`
// sites set the code, and that was the file's lone accidental precedent rather
// than a rule. Measured with the real CLI BEFORE the fix, on a temp project:
//
//   peaks job block --job-id j1 --slice-id nope --reason why
//     -> stderr `SLICE_NOT_FOUND: …`, EXIT=0
//
// so CI and every script wrapping `peaks job` read the failure as success.
//
// WHY THE CONTROL MATTERS MORE THAN THE FIX. Not every non-fatal outcome is a
// command failure. `job checkpoint` refreshes the codegraph index after a slice
// completes, and its stated design is "a refresh failure must never fail the
// checkpoint" — the checkpoint itself succeeded and the index is rebuildable.
// Likewise the two `emitJobEvent` best-effort catches. A blanket "anything that
// prints `warning:` exits 1" edit would turn an advisory rebuild into a build
// breaker for every CI that runs `peaks job checkpoint`. So this file pins BOTH
// directions, and the advisory half is the control: the same command, on the
// same state, must exit 0 when the only thing that went wrong is advisory, and
// 1 when the command itself failed.
//
// Dimension split:
//   - render:      the envelope `ok` value behind each exit code — a non-zero
//                  exit must come with `ok: false`, and the advisory 0 with
//                  `ok: true` plus a warning, never a silent 0
//   - behavior:    exit code as a function of the invocation, and the same code
//                  whatever `--json` says (the flag picks the channel, not the
//                  exit status)
//   - integration: real `registerJobCommands` + real job-state fs; only the two
//                  process-spawning / telemetry boundaries are mocked
//   - a11y:        the exit code itself — the surface a script reads — and the
//                  human text that must still accompany it
//
// Run with: pnpm vitest run tests/unit/cli/job-exit-code.test.ts

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/job-exit-code.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const __autorefresh = vi.hoisted(() => ({ refreshCodegraphAfterSlice: vi.fn() }));
const __events = vi.hoisted(() => ({ shouldThrow: false }));

// The refresh spawns a process, so that boundary is replaced. `codegraphRefreshNotice`
// is NOT replaced: the real rule decides which refresh outcomes become a warning,
// so the advisory control exercises the shipped policy rather than a stub.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/services/codegraph/codegraph-autorefresh.js')
  >()),
  refreshCodegraphAfterSlice: __autorefresh.refreshCodegraphAfterSlice
}));

// Only `job-commands.ts` imports this module, so a throwing emit reaches the two
// best-effort catches and nothing else.
vi.mock('../../../src/services/job/job-event-emitter.js', () => ({
  emitJobEvent: () => {
    if (__events.shouldThrow) throw new Error('event sink unavailable');
  }
}));

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { z } from 'zod';
import { parseCliEnvelope, type CliEnvelope } from '~/src/cli/cli-envelope';
import { parseJson } from '~/src/shared/json-parse';

const JOB_ID = 'f1-job';
const SESSION_ID = '2026-09-17-session-f1';
const COMMIT_SHA = 'deadbeef1234567';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

/**
 * Bind the session the commands resolve through `getCurrentSessionId`.
 * The env tier is cleared per test, so a stray `PEAKS_SESSION_ID` in the
 * operator's shell cannot make a "no session" case green for the wrong reason.
 */
function bindSession(wsPath: string): void {
  const runtimeDir = join(wsPath, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId: SESSION_ID, projectRoot: wsPath }, null, 2) + '\n',
    'utf8'
  );
}

/**
 * Run one `peaks job` invocation and return what a SCRIPT sees: the captured
 * channels AND `process.exitCode`.
 *
 * `process.exitCode` is process-global, so it is zeroed before the call and
 * restored after — otherwise one non-zero case would leak into the next and
 * into the test runner's own exit accounting.
 */
async function runJobExit(
  args: readonly string[],
  projectPath: string,
  json = false
): Promise<{ captured: CapturedIo; exitCode: number }> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerJobCommands(program, io);
    const argv = ['job', ...args, '--project', projectPath];
    await program.parseAsync(json ? [...argv, '--json'] : argv, { from: 'user' });
    return { captured, exitCode: process.exitCode ?? 0 };
  } finally {
    process.exitCode = previousExitCode;
  }
}

/** Seed the job through the CLI itself, so the state under test is real. */
async function seedJob(ws: TmpWorkspace): Promise<void> {
  bindSession(ws.path);
  const { exitCode } = await runJobExit(
    ['init', '--job-id', JOB_ID, '--slice-list', 's1,s2'],
    ws.path
  );
  expect(exitCode).toBe(0);
}

function asEnvelope(captured: CapturedIo): CliEnvelope {
  return parseCliEnvelope(captured.stdout.join('\n'));
}

// The `job checkpoint` / `job status` stdout WITHOUT `--json` is the bare
// payload (`printResult` writes `result.data` when `asJson` is false), so
// these sites validate the payload itself, not an envelope. (S12.)
const checkpointPayload = z.looseObject({ status: z.string() });
const codegraphRefreshPayload = z.looseObject({
  codegraph: z.looseObject({ refreshed: z.boolean(), note: z.string() })
});
const jobStatusPayload = z.looseObject({ total: z.number() });

/**
 * The nine failure-reporting sites in `job-commands.ts`, one row per site.
 *
 * `bind` is false for the two paths whose failure IS "no session resolvable",
 * so they must run against an unbound project. Every other row needs a seeded
 * job — `resolveJobStateRoot` rejects an unknown job id with a throw before the
 * site under test is reached, which would be a different (already non-zero)
 * path.
 */
const GENUINE_FAILURES: ReadonlyArray<{
  readonly site: string;
  readonly args: readonly string[];
  readonly bind: boolean;
  readonly job: boolean;
  readonly expectStderr: string;
}> = [
  {
    site: 'init/NO_ACTIVE_SESSION',
    args: ['init', '--job-id', 'j-bare', '--slice-list', 's1'],
    bind: false,
    job: false,
    expectStderr: 'NO_ACTIVE_SESSION: peaks job init requires --session-id'
  },
  {
    site: 'init/INVALID_INIT',
    // The session check runs BEFORE the schema check, so this path needs a
    // resolvable session — but no job, since it fails before the job root is
    // resolved.
    args: ['init', '--job-id', 'j-bad', '--slice-list', ','],
    bind: true,
    job: false,
    expectStderr: 'INVALID_INIT:'
  },
  {
    site: 'checkpoint/INVALID_CHECKPOINT',
    args: ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done'],
    bind: true,
    job: true,
    expectStderr: 'INVALID_CHECKPOINT:'
  },
  {
    site: 'checkpoint/SLICE_NOT_FOUND',
    args: [
      'checkpoint',
      '--job-id',
      JOB_ID,
      '--slice-id',
      'no-such-slice',
      '--state',
      'failed',
      '--reason',
      'why'
    ],
    bind: true,
    job: true,
    expectStderr: 'SLICE_NOT_FOUND: no slice "no-such-slice"'
  },
  {
    site: 'block/INVALID_BLOCK',
    args: ['block', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--reason', 'ab'],
    bind: true,
    job: true,
    expectStderr: 'INVALID_BLOCK:'
  },
  {
    site: 'block/SLICE_NOT_FOUND',
    args: ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'],
    bind: true,
    job: true,
    expectStderr: 'SLICE_NOT_FOUND: no slice "no-such-slice"'
  },
  {
    site: 'progress/PROGRESS_READ_FAILED',
    args: ['progress', '--job-id', JOB_ID],
    bind: true,
    job: true,
    expectStderr: 'PROGRESS_READ_FAILED:'
  },
  {
    site: 'progress/NO_PROGRESS',
    args: ['progress', '--job-id', JOB_ID, '--allow-missing'],
    bind: true,
    job: true,
    expectStderr: 'NO_PROGRESS:'
  },
  {
    site: 'karpathy-cost-check/NO_ACTIVE_SESSION',
    args: ['karpathy-cost-check', '--review-file', 'rd/karpathy-review.md'],
    bind: false,
    job: false,
    expectStderr: 'NO_ACTIVE_SESSION: karpathy-cost-check requires --session-id'
  }
];

let ws: TmpWorkspace;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-job-exit-code-');
  withEnv('PEAKS_SESSION_ID', undefined);
  __events.shouldThrow = false;
  __autorefresh.refreshCodegraphAfterSlice.mockReset();
  // A green refresh by default: the real boundary never returns `undefined`,
  // so a case that is not about the refresh must not hand the command one.
  __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
});

afterEach(() => {
  cleanupTmpWorkspace();
});

describe('Scenario: a11y — a genuine failure exits non-zero', () => {
  for (const row of GENUINE_FAILURES) {
    it(`when ${row.site} fails, should exit 1 and still name the failure on stderr`, async () => {
      // given: a session binding when the path needs one, and a seeded job when
      //        the path has to get past `resolveJobStateRoot` first
      if (row.bind) bindSession(ws.path);
      if (row.job) await seedJob(ws);
      // when: the failing invocation runs the way a human runs it
      const { captured, exitCode } = await runJobExit(row.args, ws.path, false);
      // then: a script sees the failure …
      expect(exitCode).toBe(1);
      // … and the human still gets the text this path always printed
      expect(captured.stderrText()).toContain(row.expectStderr);
    });
  }

  it('when the same failing command runs with and without --json, should exit 1 both ways', async () => {
    // given: one failing invocation, varied only by the render flag
    await seedJob(ws);
    const args = ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'];
    // when: both renderings run
    const withoutFlag = await runJobExit(args, ws.path, false);
    const withFlag = await runJobExit(args, ws.path, true);
    // then: the flag picks the CHANNEL, not the exit status — a caller that
    //       drops --json must not thereby buy itself a success exit code
    expect(withoutFlag.exitCode).toBe(1);
    expect(withFlag.exitCode).toBe(1);
    expect(withFlag.captured.stdout.join('\n')).toContain('"ok": false');
  });
});

describe('Scenario: render — a non-zero exit always comes with ok: false', () => {
  it('when a failure exits 1, should not leave an ok:true envelope behind on either channel', async () => {
    // given: a failure path
    await seedJob(ws);
    // when: it runs both ways
    const withoutFlag = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'no-such-slice',
        '--state',
        'failed',
        '--reason',
        'why'
      ],
      ws.path,
      false
    );
    const withFlag = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'no-such-slice',
        '--state',
        'failed',
        '--reason',
        'why'
      ],
      ws.path,
      true
    );
    // then: no envelope at all without the flag, and ok:false with it
    expect(withoutFlag.exitCode).toBe(1);
    expect(withoutFlag.captured.stdout.join('\n').trim()).toBe('');
    expect(withFlag.exitCode).toBe(1);
    expect(asEnvelope(withFlag.captured).ok).toBe(false);
  });
});

describe('Scenario: behavior — the advisory paths still exit 0 (the control)', () => {
  it('when a checkpoint succeeds but the codegraph refresh FAILS, should exit 0 with a warning', async () => {
    // given: a slice-complete checkpoint whose refresh did not happen while a
    //        codegraph store IS in use — the documented advisory case
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note: 'auto codegraph refresh failed (exit 2): schema lock conflict. Run `peaks codegraph index --project <root>` to refresh the codegraph index.'
    });
    // when: the checkpoint runs the way a human runs it
    const { captured, exitCode } = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path,
      false
    );
    // then: the checkpoint DID succeed, so the exit code stays 0 …
    expect(exitCode).toBe(0);
    // … the operator is told anyway, on stderr …
    expect(captured.stderrText()).toContain('warning: auto codegraph refresh failed');
    expect(captured.stderrText()).toContain('schema lock conflict');
    // … and the payload confirms the checkpoint itself landed
    expect(parseJson(captured.stdout.join('\n'), checkpointPayload).status).toBe('done');
  });

  it('when the codegraph refresh THROWS, should still exit 0 — a rebuildable index is not a failed checkpoint', async () => {
    // given: the refresh boundary raising rather than returning
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockRejectedValue(new Error('spawn EACCES'));
    // when: the checkpoint runs
    const { captured, exitCode } = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path,
      false
    );
    // then: exit 0, with the throw surfaced as an advisory note — never swallowed
    //       into silence, and never promoted into a checkpoint failure
    expect(exitCode).toBe(0);
    expect(parseJson(captured.stdout.join('\n'), codegraphRefreshPayload).codegraph.refreshed).toBe(
      false
    );
    expect(parseJson(captured.stdout.join('\n'), codegraphRefreshPayload).codegraph.note).toContain(
      'spawn EACCES'
    );
  });

  it('when the telemetry emit throws on job init, should still exit 0', async () => {
    // given: an event sink that throws — the catch that must not abort init
    bindSession(ws.path);
    __events.shouldThrow = true;
    // when: a job is initialised successfully
    const { exitCode } = await runJobExit(
      ['init', '--job-id', 'j-advisory', '--slice-list', 's1'],
      ws.path,
      false
    );
    // then: init succeeded, so the failed emit is invisible to the exit code
    expect(exitCode).toBe(0);
  });

  it('when the telemetry emit throws on job status, should still exit 0', async () => {
    // given: a seeded job and a throwing event sink
    await seedJob(ws);
    __events.shouldThrow = true;
    // when: status reads the job successfully
    const { captured, exitCode } = await runJobExit(['status', '--job-id', JOB_ID], ws.path, false);
    // then: the read succeeded; the emit did not, and that is not a CLI failure
    expect(exitCode).toBe(0);
    expect(parseJson(captured.stdout.join('\n'), jobStatusPayload).total).toBe(2);
  });

  it('when an advisory outcome and a genuine failure share a command, should split them by exit code', async () => {
    // given: `job checkpoint` — the command that owns BOTH kinds of outcome
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note: 'refresh did not run'
    });
    // when: one advisory-only run and one genuinely unrunnable invocation
    const advisory = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path,
      false
    );
    const genuine = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'no-such-slice',
        '--state',
        'failed',
        '--reason',
        'why'
      ],
      ws.path,
      false
    );
    // then: the warning stays 0 and the failure is 1 — the fix did not turn
    //       every warning into a build breaker
    expect(advisory.exitCode).toBe(0);
    expect(genuine.exitCode).toBe(1);
  });

  it('when a command succeeds with nothing wrong, should exit 0', async () => {
    // given: a clean project
    bindSession(ws.path);
    // when: init, status and a green-refresh checkpoint all run
    const init = await runJobExit(
      ['init', '--job-id', JOB_ID, '--slice-list', 's1,s2'],
      ws.path,
      false
    );
    const status = await runJobExit(['status', '--job-id', JOB_ID], ws.path, false);
    const checkpoint = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path,
      false
    );
    // then: the fix did not make successful commands exit non-zero
    expect(init.exitCode).toBe(0);
    expect(status.exitCode).toBe(0);
    expect(checkpoint.exitCode).toBe(0);
  });
});

describe('Scenario: integration — the exit code survives the real command wiring', () => {
  it('when a failure is followed by a success in the same process, should not carry the code over', async () => {
    // given: a seeded job
    await seedJob(ws);
    // when: a failure runs, then a success
    const failure = await runJobExit(
      ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'],
      ws.path,
      false
    );
    const success = await runJobExit(['status', '--job-id', JOB_ID], ws.path, false);
    // then: each invocation gets its own verdict — the failure set the code for
    //       its own process, and the success does not inherit it
    expect(failure.exitCode).toBe(1);
    expect(success.exitCode).toBe(0);
  });

  it('when the advisory checkpoint exits 0, should have actually run the whole command', async () => {
    // given: a seeded job and a failing refresh
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note: 'refresh did not run'
    });
    // when: the advisory checkpoint runs
    const { captured, exitCode } = await runJobExit(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path,
      false
    );
    // then: the 0 is not vacuous — the boundary really was reached, the slice
    //       really flipped, and the progress mirror really was written. A
    //       control that passed because the command bailed early would be
    //       indistinguishable from a working one.
    expect(__autorefresh.refreshCodegraphAfterSlice).toHaveBeenCalledTimes(1);
    const state = JSON.parse(
      readFileSync(
        join(ws.path, '.peaks', '_runtime', SESSION_ID, 'job', JOB_ID, 'state.json'),
        'utf8'
      )
    ) as { slices: Array<{ sliceId: string; status: string }> };
    expect(state.slices.find((s) => s.sliceId === 'slice-001')?.status).toBe('done');
    expect(
      existsSync(join(ws.path, '.peaks', '_runtime', SESSION_ID, 'job', JOB_ID, 'progress.json'))
    ).toBe(true);
    expect(exitCode).toBe(0);
    expect(captured.stderrText()).toContain('warning: refresh did not run');
  });

  it('when a failure runs in-process, should restore the runner own exit accounting', async () => {
    // given: a seeded job and the runner's exit code before the invocation
    await seedJob(ws);
    const before = process.exitCode;
    // when: a failing invocation runs in this very process
    const failure = await runJobExit(
      ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'],
      ws.path,
      false
    );
    // then: the CLI verdict was 1 …
    expect(failure.exitCode).toBe(1);
    // … and it did NOT leak into this process, which is what stops one
    //     non-zero case from turning the whole suite's exit code red
    expect(process.exitCode).toBe(before);
  });
});
