// tests/unit/cli/job-codegraph-autorefresh.test.ts
//
// 4-dimension unit test for the Option-1 slice-complete auto-refresh
// wiring inside `peaks job checkpoint`
// (rid-2026-09-03-codegraph-autorefresh).
//
// After a successful `peaks job checkpoint --state done` the CLI action
// calls `refreshCodegraphAfterSlice(projectRoot)` BEFORE returning its ok
// envelope; for `--state failed` / `--state skipped` the refresh must NOT
// fire (no slice-complete boundary). The refresh is best-effort: its
// failure never turns the checkpoint into an error.
//
// The codegraph-autorefresh module is the ONLY mocked boundary — the real
// JobStateStore / JobOrchestrator run against a tmp workspace so the
// checkpoint path is genuinely exercised.
//
// Dimensions covered:
//   - integration: command wiring with real job state fs + a mocked
//                 codegraph-autorefresh boundary; verifies call counts
//   - a11y:        the ok envelope still resolves and carries a readable
//                 `codegraph` note when the refresh fails (non-blocking)
//   - behavior:    OMITTED — pure control-flow is asserted through the
//                 integration describe (the trigger only exists inside
//                 the CLI action, which needs fs to run)
//   - render:      OMITTED — envelope shape assertions live under a11y
//
// Run with: pnpm vitest run tests/unit/cli/job-codegraph-autorefresh.test.ts

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace,
} from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/job-codegraph-autorefresh.test.ts',
  ['integration', 'a11y'],
  [
    { dim: 'behavior', reason: 'the trigger only exists inside the CLI checkpoint action, which needs job-state fs; control flow is asserted via the integration describe' },
    { dim: 'render', reason: 'envelope shape assertions live under a11y (ok + codegraph note) rather than a separate render block' },
  ],
);

const __autorefresh = vi.hoisted(() => ({
  refreshCodegraphAfterSlice: vi.fn(),
}));

// A2 (2026-09-17): the action now also imports `codegraphRefreshNotice` from
// this module, so the mock spreads the REAL module and overrides only the
// process-spawning boundary. A hand-written replacement module would make the
// notice under test a stub, i.e. assert the mock instead of the shipped rule.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/services/codegraph/codegraph-autorefresh.js')>()),
  refreshCodegraphAfterSlice: __autorefresh.refreshCodegraphAfterSlice,
}));

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

const JOB_ID = 'cg-auto-job';
const SESSION_ID = '2026-09-03-session-job-cg';
const RID_LABEL = 'rid-cg-auto';
const COMMIT_SHA = 'deadbeef1234567';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

/**
 * Stamp the canonical session binding that `peaks job checkpoint` reads
 * via `getCurrentSessionId(project)` — this file exercises the binding
 * tier only; `--session-id` / `PEAKS_SESSION_ID` overrides are covered by
 * tests/unit/cli/job-session-addressing.test.ts (D6).
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

async function runJob(args: string[], wsPath: string): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(['job', ...args, '--project', wsPath, '--json'], { from: 'user' });
  return captured;
}

/**
 * The invocation WITHOUT `--json` — the human channel.
 *
 * It exists because the two invocations render warnings on different channels,
 * and that difference is the point of the A2 cases. Until E1
 * (rid 2026-09-17-cli-output-and-stale-refs) this helper could not produce the
 * human channel at all: `job-commands.ts` passed the whole Commander options
 * object as `printResult`'s boolean `asJson` argument, so it was always truthy,
 * the envelope branch was always taken, and the `warning: ` stderr loop in
 * `cli-helpers.ts` was unreachable from this command. The helper's callers
 * asserted stdout because that was the only channel the command had — the
 * assertion mirrored the defect. E1 routes every call site through
 * `asJson(opts)`, so the `warning: ` line now lands on stderr here, as it
 * always did for `request-commands.ts` (asserted in
 * request-codegraph-autorefresh.test.ts).
 */
async function runJobHuman(args: string[], wsPath: string): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(['job', ...args, '--project', wsPath], { from: 'user' });
  return captured;
}

function parseJson(captured: CapturedIo): { ok: boolean; command: string; warnings: string[]; data: { codegraph?: unknown; sliceId?: string; status?: string } } {
  const out = captured.stdout.join('\n');
  const parsed = JSON.parse(out) as { ok: boolean; command: string; warnings: string[]; data: { codegraph?: unknown; sliceId?: string; status?: string } };
  return parsed;
}

async function seedJob(wsPath: string): Promise<void> {
  bindSession(wsPath);
  await runJob(['init', '--job-id', JOB_ID, '--slice-list', RID_LABEL], wsPath);
}

describe('Scenario: integration — peaks job checkpoint triggers auto codegraph refresh only on slice-done', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-cg-');
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when checkpoint --state done succeeds, should invoke refreshCodegraphAfterSlice once with the project root', async () => {
    // given: a seeded job + a green refresh mock
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: job checkpoint --state done runs
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: refresh is invoked exactly once with the project root and the ok envelope carries codegraph
    expect(__autorefresh.refreshCodegraphAfterSlice).toHaveBeenCalledTimes(1);
    expect(__autorefresh.refreshCodegraphAfterSlice).toHaveBeenCalledWith(ws.path);
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('checkpoint');
    expect(envelope.data.sliceId).toBe('slice-001');
    expect(envelope.data.status).toBe('done');
    expect(envelope.data.codegraph).toEqual({ refreshed: true });
  });

  it('when checkpoint --state failed runs, should NOT invoke the refresh (no slice-complete boundary)', async () => {
    // given: a seeded job (slice still pending)
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: job checkpoint --state failed runs
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'failed', '--reason', 'blocked by plan'],
      ws.path,
    );
    // then: the refresh is never invoked and the envelope carries codegraph: null
    expect(__autorefresh.refreshCodegraphAfterSlice).not.toHaveBeenCalled();
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.codegraph).toBeNull();
  });

  it('when checkpoint --state skipped runs, should NOT invoke the refresh (no slice-complete boundary)', async () => {
    // given: a seeded job (slice still pending)
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: job checkpoint --state skipped runs
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'skipped', '--reason', 'out of scope'],
      ws.path,
    );
    // then: the refresh is never invoked and the envelope still returns ok
    expect(__autorefresh.refreshCodegraphAfterSlice).not.toHaveBeenCalled();
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.codegraph).toBeNull();
  });
});

// A2 (`2026-09-17-codegraph-msg-and-refresh`). The refresh was fail-SILENT:
// both call sites discarded the result's `note`, so a slice boundary whose
// refresh did not happen printed exactly what a successful one printed. The
// defect is in what a HUMAN READS, so these cases assert the operator-visible
// line (`warning: ` on stderr, via printResult) and the envelope's warnings —
// not just the `codegraph` payload, which the cases above already covered and
// which was never the missing half.
describe('Scenario: a11y — A2 a non-refresh is visible to the operator', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-cg-a2-');
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when a codegraph store is in use and the index fails, should print the reason and the remedy on stderr', async () => {
    // given: a refresh that failed against a store that DOES exist
    await seedJob(ws.path);
    const note = 'auto codegraph refresh failed (exit 2): schema lock conflict. Run `peaks codegraph index --project <root>` to refresh the codegraph index.';
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: false, reason: 'index-failed', note });
    // when: the slice-complete checkpoint runs, both ways
    const json = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    const human = await runJobHuman(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the checkpoint is still ok (non-blocking is KEPT) …
    expect(parseJson(json).ok).toBe(true);
    // … the envelope carries the failure as a warning …
    expect(parseJson(json).warnings).toEqual([note]);
    // … and it reaches the operator's terminal on BOTH invocations, with the
    //     reason and the remedy. The channel follows the flag (E1): the JSON
    //     invocation carries it as an envelope field on stdout, the human one
    //     as a `warning: ` line on stderr — which is the channel the A2 design
    //     note on the action names, and the one a truthy `asJson` had made
    //     unreachable.
    expect(json.stdout.join('\n')).toContain(note);
    expect(human.stderrText()).toContain(`warning: ${note}`);
    for (const text of [json.stdout.join('\n'), human.stderrText()]) {
      expect(text).toContain('schema lock conflict');
      expect(text).toContain('peaks codegraph index');
    }
  });

  it('when the refresh succeeds, should print no warning at all', async () => {
    // given: the ordinary green case (clean control for the case above)
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: the slice-complete checkpoint runs without --json
    const captured = await runJobHuman(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: nothing is reported — a warning on every healthy boundary would
    //       train the reader to skip the line that matters
    expect(captured.stderrText()).toBe('');
    expect(captured.stdout.join('\n')).not.toContain('auto codegraph refresh');
    // The human invocation prints `data` alone (E1), so there is no `warnings`
    // key to inspect: the note's absence is asserted on the text, which is
    // what the operator reads on this channel.
    expect(parseJson(captured)).not.toHaveProperty('warnings');
  });

  it('when no codegraph store was ever set up, should stay silent (opt-out, not a failure)', async () => {
    // given: the project never opted in — the refresh has nothing to report
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'no-codegraph-dir',
      note: 'auto codegraph refresh skipped: no .codegraph directory. Run `peaks codegraph init` once to enable post-slice auto-refresh.',
    });
    // when: the slice-complete checkpoint runs
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: no warning line — a boundary every non-codegraph project crosses
    //       must not warn on every slice
    expect(parseJson(captured).warnings).toEqual([]);
    expect(captured.stderrText()).toBe('');
    expect(captured.stdout.join('\n')).toContain('no .codegraph directory');
    // … and the note is still in the payload for a JSON consumer
    const codegraph = parseJson(captured).data.codegraph as { note?: string };
    expect(codegraph.note).toContain('.codegraph');
  });

  it('when the refresh throws unexpectedly, should still surface it', async () => {
    // given: the refresh rejects (the action's own catch builds the note)
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockRejectedValue(new Error('boom'));
    // when: the slice-complete checkpoint runs without --json
    const captured = await runJobHuman(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the caller's synthetic `unavailable` result is visible too, and on
    //       this invocation it reaches the operator as a `warning: ` line
    expect(captured.stderrText()).toContain('warning: auto codegraph refresh failed: boom');
    expect(captured.stdout.join('\n')).toContain('auto codegraph refresh failed: boom');
  });
});

describe('Scenario: a11y — a failing auto-refresh never fails the checkpoint', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-cg-a11y-');
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when the refresh reports index-failed, should still return an ok checkpoint envelope with a readable codegraph note', async () => {
    // given: a seeded job + a refresh mock that reports a non-blocking failure
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note: 'auto codegraph refresh failed (exit 2): schema lock conflict',
    });
    // when: job checkpoint --state done runs despite the refresh failure
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the checkpoint is still ok and the note is surfaced, not an error
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('done');
    expect(envelope.data.codegraph).toEqual({
      refreshed: false,
      reason: 'index-failed',
      note: 'auto codegraph refresh failed (exit 2): schema lock conflict',
    });
  });

  it('when the refresh throws unexpectedly, should still return an ok checkpoint envelope (fail-silent catch)', async () => {
    // given: a seeded job + a refresh mock that rejects
    await seedJob(ws.path);
    __autorefresh.refreshCodegraphAfterSlice.mockRejectedValue(new Error('boom'));
    // when: job checkpoint --state done runs and the refresh blows up
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the checkpoint is still ok and codegraph records the non-blocking failure
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('done');
    const codegraph = envelope.data.codegraph as { refreshed: boolean; reason?: string; note?: string };
    expect(codegraph.refreshed).toBe(false);
    expect(codegraph.reason).toBe('unavailable');
    expect(codegraph.note).toContain('boom');
  });
});
