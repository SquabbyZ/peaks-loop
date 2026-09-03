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

vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', () => __autorefresh);

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

const JOB_ID = 'cg-auto-job';
const SESSION_ID = '2026-09-03-session-job-cg';
const RID_LABEL = 'rid-cg-auto';
const COMMIT_SHA = 'deadbeef1234567';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

/**
 * Stamp the canonical session binding that `peaks job checkpoint` reads
 * via `getCurrentSessionId(project)` — the checkpoint subcommand has no
 * `--session-id` option; it resolves the active session from
 * `.peaks/_runtime/session.json`.
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

function parseJson(captured: CapturedIo): { ok: boolean; command: string; data: { codegraph?: unknown; sliceId?: string; status?: string } } {
  const out = captured.stdout.join('\n');
  const parsed = JSON.parse(out) as { ok: boolean; command: string; data: { codegraph?: unknown; sliceId?: string; status?: string } };
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
