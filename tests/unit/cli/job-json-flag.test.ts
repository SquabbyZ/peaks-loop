// tests/unit/cli/job-json-flag.test.ts
//
// E1 (rid 2026-09-17-cli-output-and-stale-refs) — `peaks job <sub>` honours
// `--json`.
//
// THE DEFECT THIS PINS. `printResult(io, envelope, asJson)` takes a BOOLEAN
// third parameter (`src/cli/cli-helpers.ts`). `job-commands.ts` passed the
// whole Commander options object there at 15 call sites — `asJson = opts` —
// and Commander types an action's `opts` as `any`, so it type-checked. An
// object is always truthy, so the envelope branch was always taken and the
// `warning: ` / `next: ` / `CODE: message` rendering below it was unreachable
// from those commands. `job progress` was the one sibling that passed
// `opts.json`; measured with the real CLI, `peaks job block` (no --json) and
// `peaks job block --json` printed byte-identical envelopes, while
// `peaks job progress` (no --json) put its failure on stderr. One file
// rendered two ways for the same invocation shape.
//
// WHAT THESE CASES MEASURE. The flag is the only input that differs, so the
// two channels are asserted against each other: with `--json` the envelope
// (and only the envelope) reaches stdout; without it stdout carries `data`
// alone and the human text reaches stderr. A re-paste of the object form at
// any of the fixed sites turns the without-`--json` cases red.
//
// Dimension split:
//   - render:      stdout's SHAPE — envelope keys present vs absent
//   - behavior:    the flag decides which branch runs; the same command on the
//                  same state must render two ways
//   - integration: real `registerJobCommands` + real job-state fs; only the
//                  codegraph refresh (a process-spawning boundary) is mocked
//   - a11y:        the human text — `warning: `, `next: `, `CODE: message` —
//                  and the channel it lands on
//
// Run with: pnpm vitest run tests/unit/cli/job-json-flag.test.ts

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { withEnv } from '../_setup/io.js';
import { cleanupTmpWorkspace, useTmpWorkspace, type TmpWorkspace } from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/job-json-flag.test.ts', ['render', 'behavior', 'integration', 'a11y']);

const __autorefresh = vi.hoisted(() => ({ refreshCodegraphAfterSlice: vi.fn() }));

// Only the process-spawning boundary is replaced; the real `codegraphRefreshNotice`
// decides which refresh outcomes become a warning, so the warning under test is
// the shipped rule rather than a stub.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/codegraph/codegraph-autorefresh.js')>()),
  refreshCodegraphAfterSlice: __autorefresh.refreshCodegraphAfterSlice,
}));

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { writeJobProgress } from '../../../src/services/job/job-progress-store.js';

const JOB_ID = 'e1-job';
const SESSION_ID = '2026-09-17-session-e1';
const COMMIT_SHA = 'deadbeef1234567';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

/** A refresh that did not happen against a store that IS in use — a warning. */
const REFRESH_NOTE =
  'auto codegraph refresh failed (exit 2): schema lock conflict. Run `peaks codegraph index --project <root>` to refresh the codegraph index.';

/**
 * The session binding the commands resolve through `getCurrentSessionId`.
 * The env tier is cleared per test: a stray `PEAKS_SESSION_ID` in the
 * operator's shell would otherwise resolve a session for the "no session"
 * controls and turn them green for the wrong reason.
 */
function bindSession(wsPath: string): void {
  const runtimeDir = join(wsPath, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId: SESSION_ID, projectRoot: wsPath }, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Run one `peaks job` invocation. `--json` is the ONLY axis these cases vary —
 * everything else about the invocation is held fixed.
 */
async function runJob(args: readonly string[], projectPath: string, json: boolean): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  const argv = ['job', ...args, '--project', projectPath];
  await program.parseAsync(json ? [...argv, '--json'] : argv, { from: 'user' });
  return captured;
}

/** Seed the job via the CLI itself, so the state under test is real. */
async function seedJob(ws: TmpWorkspace): Promise<void> {
  bindSession(ws.path);
  await runJob(['init', '--job-id', JOB_ID, '--slice-list', 's1,s2'], ws.path, true);
}

/** Parse stdout as an envelope. Throws (fails the case) if it is not one. */
function asEnvelope(captured: CapturedIo): { ok: boolean; command: string; warnings: string[]; nextActions: string[] } {
  return JSON.parse(captured.stdout.join('\n')) as { ok: boolean; command: string; warnings: string[]; nextActions: string[] };
}

/** Parse stdout as the `data` payload the non-JSON branch prints. */
function asData(captured: CapturedIo): Record<string, unknown> {
  return JSON.parse(captured.stdout.join('\n')) as Record<string, unknown>;
}

/**
 * True when an envelope reached stdout, whatever its `ok` value.
 *
 * The test parses rather than greps: a `data` payload can legitimately carry
 * an `ok`-shaped field (a decision record, a nested result), and a substring
 * rule would read that as an envelope. The envelope is identified by the two
 * keys `printResult` always writes at the top level.
 */
function stdoutIsEnvelope(captured: CapturedIo): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.stdout.join('\n'));
  } catch {
    return false;
  }
  return typeof parsed === 'object' && parsed !== null && 'ok' in parsed && 'warnings' in parsed;
}

let ws: TmpWorkspace;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-job-json-flag-');
  withEnv('PEAKS_SESSION_ID', undefined);
  // A green refresh by default: the real boundary never returns `undefined`,
  // so a case that is not about the refresh must not hand the command one.
  __autorefresh.refreshCodegraphAfterSlice.mockReset();
  __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
});

afterEach(() => {
  cleanupTmpWorkspace();
});

describe('Scenario: render — stdout carries the envelope only when --json is passed', () => {
  it('when --json is passed, should print the full envelope with ok/command/warnings', async () => {
    // given: a seeded job
    await seedJob(ws);
    // when: job status runs with --json
    const captured = await runJob(['status', '--job-id', JOB_ID], ws.path, true);
    // then: stdout is the envelope, keys and all
    const envelope = asEnvelope(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('status');
    expect(envelope.warnings).toEqual([]);
    expect(envelope).toHaveProperty('nextActions');
  });

  it('when --json is NOT passed, should print data alone with no envelope keys', async () => {
    // given: a seeded job
    await seedJob(ws);
    // when: job status runs without --json
    const captured = await runJob(['status', '--job-id', JOB_ID], ws.path, false);
    // then: stdout is the payload, and the envelope wrapper is gone
    const data = asData(captured);
    expect(data.done).toBe(0);
    expect(data.total).toBe(2);
    expect(data).not.toHaveProperty('ok');
    expect(data).not.toHaveProperty('command');
    expect(data).not.toHaveProperty('warnings');
  });
});

describe('Scenario: behavior — the two channels are decided by the flag, not by the command', () => {
  it('when the same successful command is run both ways, should render two different shapes', async () => {
    // given: one seeded job and one invocation, varied only by the flag
    await seedJob(ws);
    const args = ['resume', '--job-id', JOB_ID];
    // when: the same command runs both ways
    const withFlag = await runJob(args, ws.path, true);
    const withoutFlag = await runJob(args, ws.path, false);
    // then: the flag — and nothing else — picks the branch
    expect(stdoutIsEnvelope(withFlag)).toBe(true);
    expect(stdoutIsEnvelope(withoutFlag)).toBe(false);
  });

  it('when a FAILED command is run both ways, should keep the envelope only under --json', async () => {
    // given: a seeded job and a slice id that matches no slice
    await seedJob(ws);
    const args = ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'];
    // when: the failing command runs both ways
    const withFlag = await runJob(args, ws.path, true);
    const withoutFlag = await runJob(args, ws.path, false);
    // then: --json reports the failure as an envelope …
    expect(asEnvelope(withFlag).ok).toBe(false);
    // … and the human invocation reports it as text on stderr, with NO
    //     machine-readable envelope left behind on stdout
    expect(withoutFlag.stdout.join('\n').trim()).toBe('');
    expect(withoutFlag.stderrText()).toContain('SLICE_NOT_FOUND: no slice "no-such-slice"');
  });
});

describe('Scenario: a11y — the human channel a truthy asJson made unreachable', () => {
  it('when a checkpoint refresh fails against a live store, should print `warning: ` on stderr and not in the envelope', async () => {
    // given: a seeded job and a refresh that failed while a store IS in use
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note: REFRESH_NOTE,
    });
    const args = ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA];
    // when: the slice-complete checkpoint runs both ways
    const withoutFlag = await runJob(args, ws.path, false);
    const withFlag = await runJob(args, ws.path, true);
    // then: without --json the operator gets the documented `warning: ` line …
    expect(withoutFlag.stderrText()).toContain(`warning: ${REFRESH_NOTE}`);
    // … with the reason and the remedy readable there …
    expect(withoutFlag.stderrText()).toContain('schema lock conflict');
    expect(withoutFlag.stderrText()).toContain('peaks codegraph index');
    // … while stdout is the checkpoint payload alone, with no envelope
    expect(asData(withoutFlag).status).toBe('done');
    expect(stdoutIsEnvelope(withoutFlag)).toBe(false);
    // and under --json the warning is an envelope field, with no stderr line
    expect(asEnvelope(withFlag).warnings).toEqual([REFRESH_NOTE]);
    expect(withFlag.stderrText()).not.toContain('warning: ');
  });

  it('when the refresh succeeds, should print no warning on either channel', async () => {
    // given: the ordinary green case (clean control for the case above)
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: the slice-complete checkpoint runs without --json
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
      false,
    );
    // then: nothing is reported — a warning on every healthy boundary would
    //       train the reader to skip the line that matters
    expect(captured.stderrText()).not.toContain('warning: ');
    expect(captured.stdout.join('\n')).not.toContain('auto codegraph refresh');
  });

  it('when a failure carries nextActions, should render them as human lines without --json', async () => {
    // given: a seeded job and a block that matches no slice
    await seedJob(ws);
    // when: the failing command runs without --json
    const captured = await runJob(
      ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'],
      ws.path,
      false,
    );
    // then: the code and the remedy are on stderr, and stdout stays empty
    expect(captured.stderrText()).toContain('SLICE_NOT_FOUND: ');
    expect(captured.stderrText()).toContain('- Re-run with one of the valid slice ids');
    expect(captured.stdout.join('\n').trim()).toBe('');
  });
});

describe('Scenario: integration — every fixed call site routes through the flag', () => {
  // ONE CASE PER CALL SITE, because the defect was one expression repeated at
  // 15 sites: a test that covers `status` says nothing about `handoff`. The
  // list was produced by mutating each site back to the object form and
  // keeping every invocation whose case went red; a site with no case here is
  // a site a re-paste can regress unnoticed.
  //
  // The assertion is the same for all of them — envelope on stdout under
  // `--json`, never without it — because that is the whole of what the
  // parameter controls. It holds for a success and for a failure alike: the
  // point is the channel, not the verdict.
  const callSites: ReadonlyArray<{
    site: string;
    label: string;
    args: readonly string[];
    /** Use a workspace with no session binding, so the command refuses. */
    bare?: true;
    /** Seed the progress mirror so `job progress` reaches its ok call site. */
    needsProgress?: true;
  }> = [
    // init: NO_ACTIVE_SESSION, INVALID_INIT, ok
    { site: 'init/NO_ACTIVE_SESSION', label: 'init — no session', args: ['init', '--job-id', 'j-bare', '--slice-list', 's1'], bare: true },
    { site: 'init/INVALID_INIT', label: 'init — empty slice list', args: ['init', '--job-id', 'j-bad', '--slice-list', ','] },
    { site: 'init/ok', label: 'init — ok', args: ['init', '--job-id', 'j-fresh', '--slice-list', 's1'] },
    { site: 'status/ok', label: 'status', args: ['status', '--job-id', JOB_ID] },
    { site: 'rotate-now/ok', label: 'rotate-now', args: ['rotate-now', '--job-id', JOB_ID] },
    { site: 'subagent-cleanup/ok', label: 'subagent-cleanup', args: ['subagent-cleanup', '--job-id', JOB_ID, '--batch-id', 'b1', '--force'] },
    // checkpoint: INVALID_CHECKPOINT, SLICE_NOT_FOUND, ok
    { site: 'checkpoint/INVALID_CHECKPOINT', label: 'checkpoint — done without a commit sha', args: ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done'] },
    { site: 'checkpoint/SLICE_NOT_FOUND', label: 'checkpoint — unknown slice', args: ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--state', 'failed', '--reason', 'why'] },
    { site: 'checkpoint/ok', label: 'checkpoint — done', args: ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA] },
    // block: INVALID_BLOCK, SLICE_NOT_FOUND, ok
    { site: 'block/INVALID_BLOCK', label: 'block — reason too short', args: ['block', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--reason', 'ab'] },
    { site: 'block/SLICE_NOT_FOUND', label: 'block — unknown slice', args: ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'] },
    { site: 'block/ok', label: 'block — ok', args: ['block', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--reason', 'because'] },
    { site: 'continue/ok', label: 'continue', args: ['continue', '--job-id', JOB_ID] },
    { site: 'resume/ok', label: 'resume', args: ['resume', '--job-id', JOB_ID] },
    // progress: NO_PROGRESS, ok, PROGRESS_READ_FAILED
    { site: 'progress/NO_PROGRESS', label: 'progress — allow-missing with no mirror', args: ['progress', '--job-id', JOB_ID, '--allow-missing'] },
    { site: 'progress/ok', label: 'progress — seeded mirror', args: ['progress', '--job-id', JOB_ID], needsProgress: true },
    { site: 'progress/PROGRESS_READ_FAILED', label: 'progress — no mirror, no allow-missing', args: ['progress', '--job-id', JOB_ID] },
    { site: 'handoff/ok', label: 'handoff', args: ['handoff', '--job-id', JOB_ID] },
    // karpathy-cost-check: NO_ACTIVE_SESSION, ok
    { site: 'karpathy-cost-check/NO_ACTIVE_SESSION', label: 'karpathy-cost-check — no session', args: ['karpathy-cost-check', '--review-file', 'rd/karpathy-review.md'], bare: true },
    { site: 'karpathy-cost-check/ok', label: 'karpathy-cost-check — missing review file', args: ['karpathy-cost-check', '--review-file', 'rd/karpathy-review.md'] },
  ];

  for (const { site, label, args, bare, needsProgress } of callSites) {
    it(`when \`${label}\` runs without --json, should not leave an envelope on stdout (${site})`, async () => {
      // given: a seeded job — or, for the no-session controls, a workspace
      //        without a session binding; plus the progress mirror when the
      //        case needs one to reach its call site
      await seedJob(ws);
      const projectDir = bare === true ? bareWorkspace() : ws.path;
      if (needsProgress === true) {
        writeProgressMirror(projectDir);
      }
      // when: the call site's invocation runs both ways, flag the only difference
      const withoutFlag = await runJob(args, projectDir, false);
      const withFlag = await runJob(args, projectDir, true);
      // then: the envelope is the --json rendering, and only that one
      expect(stdoutIsEnvelope(withFlag)).toBe(true);
      expect(stdoutIsEnvelope(withoutFlag)).toBe(false);
    });
  }

  it('when a no-session command is refused, should name the refusal on stderr without --json', async () => {
    // given: a workspace with NO session binding
    const bare = bareWorkspace();
    // when: init runs both ways
    const withoutFlag = await runJob(['init', '--job-id', JOB_ID, '--slice-list', 's1'], bare, false);
    const withFlag = await runJob(['init', '--job-id', JOB_ID, '--slice-list', 's1'], bare, true);
    // then: --json keeps the envelope and its command name …
    expect(asEnvelope(withFlag).ok).toBe(false);
    expect(asEnvelope(withFlag).command).toBe('init');
    // … while without it the refusal is human text on stderr
    expect(withoutFlag.stderrText()).toContain('NO_ACTIVE_SESSION: peaks job init requires --session-id');
  });
});

/**
 * A directory inside the tmp workspace that holds no
 * `.peaks/_runtime/session.json`, so `getCurrentSessionId` resolves nothing
 * and the commands that require a session refuse. Returned as a path only —
 * the caller passes it through `--project`.
 */
function bareWorkspace(): string {
  const bare = join(ws.path, 'no-session-subdir');
  mkdirSync(bare, { recursive: true });
  return bare;
}

/**
 * Seed the on-disk slice-progress mirror so `job progress` reaches its ok
 * call site. Written by the store's own writer, so the record shape is the
 * canonical one rather than a hand-rolled fixture.
 */
function writeProgressMirror(projectDir: string): void {
  writeJobProgress(projectDir, SESSION_ID, {
    jobId: JOB_ID,
    done: 1,
    total: 2,
    currentSlice: 'slice-002',
    lastCommitSha: null,
  });
}
