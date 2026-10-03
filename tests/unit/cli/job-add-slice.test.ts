// tests/unit/cli/job-add-slice.test.ts
//
// D1 (rid 2026-10-03-job-ledger-truthfulness): a job's slice list is frozen at
// `peaks job init --slice-list`, and no subcommand adds a slice to an existing
// job. Measured against the committed build:
//
//   peaks job add-slice …                         → error: unknown command 'add-slice'
//   peaks job checkpoint --slice-id <new slice>   → ok:false code:SLICE_NOT_FOUND
//   peaks job status|progress …                   → { done: 1, total: 1 }  (stuck)
//
// so a wave that discovers its slices one at a time can only under-report.
//
// Fix under test: `peaks job add-slice --job-id <jid> --slice-label <label>`.
// It is idempotent and honest — a label already registered is reported and
// changes nothing; an empty or whitespace-only label is refused; `total` and the
// `progress` mirror follow an accepted add; and `checkpoint` then takes the new
// label by name.
//
// Dimensions covered:
//   - render:      the add-slice envelope and the state.json it produces
//   - behavior:    append, idempotent no-op, refused empty label
//   - integration: real-fs writes, the progress mirror following, checkpoint by
//                  the newly registered name
//   - a11y:        the already-registered and empty-label texts
//
// The project is a `mkdtempSync` tmp workspace (not a git repository), so the
// commit-sha arm of `checkpoint` stays out of this file's way — see
// tests/unit/cli/job-checkpoint-commit-sha.test.ts for that boundary.
//
// Run with: pnpm vitest run tests/unit/cli/job-add-slice.test.ts

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { parseCliEnvelope, parseCliEnvelopeWith } from '../../../src/cli/cli-envelope.js';
import { JobStateSchema, type SliceState } from '../../../src/services/job/job-types.js';
import { JobProgressSchema } from '../../../src/services/job/job-progress-store.js';
import { parseJson } from '../../../src/shared/json-parse.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { registerJobAddSliceCommand } from '../../../src/cli/commands/job-add-slice-command.js';

declareDimensions('tests/unit/cli/job-add-slice.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const __autorefresh = vi.hoisted(() => ({ refreshCodegraphAfterSlice: vi.fn() }));

// The only mocked boundary: `job checkpoint` reaches for the codegraph index at
// the slice-complete edge, and the real implementation spawns processes.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/services/codegraph/codegraph-autorefresh.js')
  >()),
  refreshCodegraphAfterSlice: __autorefresh.refreshCodegraphAfterSlice
}));

const SESSION_ID = '2026-10-03-session-d1';
const JOB_ID = 'd1-add-slice';
const COMMIT_SHA = 'deadbeef1234567';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

const addSlicePayload = z.looseObject({
  sliceId: z.string(),
  label: z.string(),
  added: z.boolean(),
  total: z.number().int()
});

async function runJob(args: readonly string[], projectPath: string): Promise<CapturedIo> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerJobCommands(program, io);
    registerJobAddSliceCommand(program, io);
    await program.parseAsync(
      ['job', ...args, '--project', projectPath, '--session-id', SESSION_ID, '--json'],
      { from: 'user' }
    );
    return captured;
  } finally {
    process.exitCode = previousExitCode;
  }
}

/**
 * The same invocation, returning the exit code it set. `process.exitCode` is
 * process-global and `runJob` restores it, so an arm that asserts on it has to
 * read it where it was written (the same reason job-exit-code.test.ts has its own
 * runner).
 */
async function runJobExit(args: readonly string[], projectPath: string): Promise<number> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { io } = makeCapturedIo();
    const program = new Command();
    registerJobCommands(program, io);
    registerJobAddSliceCommand(program, io);
    await program.parseAsync(
      ['job', ...args, '--project', projectPath, '--session-id', SESSION_ID, '--json'],
      { from: 'user' }
    );
    return process.exitCode ?? 0;
  } finally {
    process.exitCode = previousExitCode;
  }
}

function jobDir(wsPath: string): string {
  return join(wsPath, '.peaks', '_runtime', SESSION_ID, 'job', JOB_ID);
}

function readSlices(wsPath: string): SliceState[] {
  return parseJson(readFileSync(join(jobDir(wsPath), 'state.json'), 'utf8'), JobStateSchema).slices;
}

function readProgress(wsPath: string) {
  return parseJson(readFileSync(join(jobDir(wsPath), 'progress.json'), 'utf8'), JobProgressSchema);
}

function readBytes(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function seedOneSliceJob(wsPath: string): Promise<void> {
  const seeded = parseCliEnvelope(
    (await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'first-slice'], wsPath)).stdout.join(
      '\n'
    )
  );
  expect(seeded.ok).toBe(true);
}

function freshWorkspace(prefix: string): TmpWorkspace {
  withEnv('PEAKS_SESSION_ID', undefined);
  __autorefresh.refreshCodegraphAfterSlice.mockReset();
  __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
  return useTmpWorkspace(prefix);
}

describe('Scenario: render — the add-slice envelope reports what it registered', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = freshWorkspace('peaks-d1-render-');
  });
  afterEach(() => cleanupTmpWorkspace());

  it('when a new label is added, should report the canonical sliceId and the new total', async () => {
    // given: a job that was initialised with one slice
    await seedOneSliceJob(ws.path);
    // when: the wave discovers a second slice and registers it
    const captured = await runJob(
      ['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'],
      ws.path
    );
    // then: the envelope names the slice it appended, in the CLI's own id shape
    const envelope = parseCliEnvelopeWith(captured.stdout.join('\n'), addSlicePayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('add-slice');
    expect(envelope.data.added).toBe(true);
    expect(envelope.data.sliceId).toBe('slice-002');
    expect(envelope.data.label).toBe('second-slice');
    expect(envelope.data.total).toBe(2);
  });

  it('when a new label is added, should append a pending slice to state.json', async () => {
    // given: a one-slice job
    await seedOneSliceJob(ws.path);
    // when: a second slice is registered
    await runJob(['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'], ws.path);
    // then: the ledger carries two slices and the new one is pending
    const slices = readSlices(ws.path);
    expect(slices.map((sl) => sl.sliceId)).toEqual(['slice-001', 'slice-002']);
    expect(slices[1]!.label).toBe('second-slice');
    expect(slices[1]!.status).toBe('pending');
  });
});

describe('Scenario: behavior — idempotent, and honest about being idempotent', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = freshWorkspace('peaks-d1-idem-');
  });
  afterEach(() => cleanupTmpWorkspace());

  it('when the same label is added twice, should change nothing and say so', async () => {
    // given: a job whose second slice is already registered
    await seedOneSliceJob(ws.path);
    await runJob(['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'], ws.path);
    const before = readBytes(join(jobDir(ws.path), 'state.json'));
    // when: the same label is offered again
    const captured = await runJob(
      ['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'],
      ws.path
    );
    // then: it reports the existing slice rather than appending a copy
    const envelope = parseCliEnvelopeWith(captured.stdout.join('\n'), addSlicePayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.added).toBe(false);
    expect(envelope.data.sliceId).toBe('slice-002');
    expect(envelope.data.total).toBe(2);
    expect(readBytes(join(jobDir(ws.path), 'state.json'))).toBe(before);
    expect(readSlices(ws.path).length).toBe(2);
  });

  it('when --slice-label is blank, should refuse and change nothing', async () => {
    // given: a one-slice job
    await seedOneSliceJob(ws.path);
    const before = readBytes(join(jobDir(ws.path), 'state.json'));
    // when: a whitespace-only label is offered
    const captured = await runJob(
      ['add-slice', '--job-id', JOB_ID, '--slice-label', '   '],
      ws.path
    );
    // then: it is a structured refusal, not an appended empty slice
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_SLICE_LABEL');
    expect(readBytes(join(jobDir(ws.path), 'state.json'))).toBe(before);
    expect(readSlices(ws.path).length).toBe(1);
  });

  it('when --slice-label is blank, should exit non-zero', async () => {
    // given: a one-slice job
    await seedOneSliceJob(ws.path);
    // when: the refusal path runs and the exit code is read where it was set
    const exitCode = await runJobExit(
      ['add-slice', '--job-id', JOB_ID, '--slice-label', ''],
      ws.path
    );
    // then: the process exit code follows the envelope
    expect(exitCode).toBe(1);
  });
});

describe('Scenario: integration — total and the progress mirror follow, and checkpoint takes the new name', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = freshWorkspace('peaks-d1-integr-');
  });
  afterEach(() => cleanupTmpWorkspace());

  it('when a slice is added after the first checkpoint, should raise status and progress totals', async () => {
    // given: a one-slice job whose only slice is already done (mirror written)
    await seedOneSliceJob(ws.path);
    await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'first-slice',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path
    );
    expect(readProgress(ws.path).total).toBe(1);
    // when: the wave registers the slice it has now discovered
    await runJob(['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'], ws.path);
    // then: both counters move — the ledger and its mirror, not just the ledger
    const status = parseCliEnvelope(
      (await runJob(['status', '--job-id', JOB_ID], ws.path)).stdout.join('\n')
    );
    expect((status.data as Record<string, unknown>).total).toBe(2);
    const progress = readProgress(ws.path);
    expect(progress.total).toBe(2);
    expect(progress.done).toBe(1);
    expect(progress.currentSlice).toBe('second-slice');
  });

  it('when the added slice is checkpointed by its label, should record it done', async () => {
    // given: a job whose second slice was registered after init, and whose first
    //        slice is already done
    await seedOneSliceJob(ws.path);
    await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'first-slice',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path
    );
    await runJob(['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'], ws.path);
    // when: the checkpoint names the added slice the way the wave knows it — by label
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'second-slice',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path
    );
    // then: no SLICE_NOT_FOUND, and the ledger shows a complete job
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    expect(envelope.ok).toBe(true);
    expect(envelope.code ?? '').not.toBe('SLICE_NOT_FOUND');
    const progress = readProgress(ws.path);
    expect(progress.done).toBe(2);
    expect(progress.total).toBe(2);
  });

  it('when a slice is added to a job with no progress mirror yet, should not invent one', async () => {
    // given: a one-slice job that has never been checkpointed
    await seedOneSliceJob(ws.path);
    expect(readBytes(join(jobDir(ws.path), 'progress.json'))).toBeNull();
    // when: a second slice is registered
    await runJob(['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'], ws.path);
    // then: no mirror appears out of a command that knows nothing about progress
    expect(readBytes(join(jobDir(ws.path), 'progress.json'))).toBeNull();
  });
});

describe('Scenario: a11y — the refusal and the no-op say what they did', () => {
  let ws: TmpWorkspace;
  beforeEach(() => {
    ws = freshWorkspace('peaks-d1-a11y-');
  });
  afterEach(() => cleanupTmpWorkspace());

  it('when the label is already registered, should name the existing sliceId in the warning', async () => {
    // given: a job with the label already registered
    await seedOneSliceJob(ws.path);
    await runJob(['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'], ws.path);
    // when: the same label is offered again
    const captured = await runJob(
      ['add-slice', '--job-id', JOB_ID, '--slice-label', 'second-slice'],
      ws.path
    );
    // then: the reader is told which slice already carries it, and that nothing
    //       changed
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    const text = JSON.stringify(envelope);
    expect(text).toContain('slice-002');
    expect(text).toMatch(/already|nothing changed/);
  });

  it('when --slice-label is blank, should name the option that was empty', async () => {
    // given: a seeded job
    await seedOneSliceJob(ws.path);
    // when: the empty-label refusal runs
    const captured = await runJob(
      ['add-slice', '--job-id', JOB_ID, '--slice-label', '  '],
      ws.path
    );
    // then: the message is about --slice-label, not about the job
    expect(parseCliEnvelope(captured.stdout.join('\n')).message ?? '').toContain('--slice-label');
  });
});
