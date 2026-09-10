// tests/unit/cli/job-slice-id-resolution.test.ts
//
// D7 (findings-job-loop-defects.md): `peaks job checkpoint --slice-id S1`
// returned `{ok: true, status: "done"}`, wrote `lastCommitSha` into
// progress.json, and left the slice `"status": "pending"` — a silent failed
// write reported as success. Slices are keyed `slice-NNN`; `--slice-list "S1,…"`
// is the documented init form, so the label is the natural thing to pass back.
//
// Fix under test: `--slice-id` resolves an exact sliceId OR an exact label to
// the canonical sliceId; anything else is rejected with SLICE_NOT_FOUND listing
// the valid ids, BEFORE any write — so progress.json is never touched by a
// checkpoint that matched no slice. The same resolution guards `job block`.
//
// Dimensions covered:
//   - render:      ok-envelope + progress.json shape (canonical sliceId)
//   - behavior:    label → canonical slice, and the slice actually flips status
//   - integration: real-fs writes; a typo leaves state.json + progress.json untouched
//   - a11y:        the SLICE_NOT_FOUND envelope lists the valid ids
//
// The codegraph-autorefresh module is the ONLY mocked boundary (the same mock
// tests/unit/cli/job-codegraph-autorefresh.test.ts uses); the real JobStateStore
// / JobOrchestrator run against a tmp workspace.
//
// Run with: pnpm vitest run tests/unit/cli/job-slice-id-resolution.test.ts

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace,
} from '../_setup/tmp-workspace.js';

declareDimensions('tests/unit/cli/job-slice-id-resolution.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const __autorefresh = vi.hoisted(() => ({
  refreshCodegraphAfterSlice: vi.fn(),
}));

vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', () => __autorefresh);

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

const JOB_SID = '2026-09-10-session-d7';
const JOB_ID = 'slice-id-job';
const COMMIT_SHA = 'deadbeef1234567';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

async function runJob(args: string[], wsPath: string): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(['job', ...args, '--project', wsPath, '--json'], { from: 'user' });
  return captured;
}

function parseJson(captured: CapturedIo): { ok: boolean; code?: string; message?: string; data: any } {
  return JSON.parse(captured.stdout.join('\n')) as { ok: boolean; code?: string; message?: string; data: any };
}

function bindSession(wsPath: string): void {
  const runtimeDir = join(wsPath, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId: JOB_SID, projectRoot: wsPath }) + '\n',
    'utf8',
  );
}

function jobDir(wsPath: string): string {
  return join(wsPath, '.peaks', '_runtime', JOB_SID, 'job', JOB_ID);
}

function readSlices(wsPath: string): Array<{ sliceId: string; label: string; status: string; commitSha?: string }> {
  return (JSON.parse(readFileSync(join(jobDir(wsPath), 'state.json'), 'utf8')) as {
    slices: Array<{ sliceId: string; label: string; status: string; commitSha?: string }>;
  }).slices;
}

function readProgress(wsPath: string): any {
  return JSON.parse(readFileSync(join(jobDir(wsPath), 'progress.json'), 'utf8'));
}

describe('Scenario: behavior — --slice-id accepts the label as an alias for its sliceId', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-slice-id-');
    withEnv('PEAKS_SESSION_ID', undefined);
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when checkpoint is called with the label S1, should mark slice-001 done', async () => {
    // given: a 4-slice job seeded from the documented `--slice-list "S1,S2,S3,S4"` form
    bindSession(ws.path);
    await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'S1,S2,S3,S4'], ws.path);
    // when: checkpoint runs with the LABEL rather than the canonical slice id
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'S1', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the envelope is ok and slice-001 — not nothing — carries the done state
    expect(parseJson(captured).ok).toBe(true);
    const slices = readSlices(ws.path);
    expect(slices[0]!.status).toBe('done');
    expect(slices[0]!.commitSha).toBe(COMMIT_SHA);
    expect(slices[1]!.status).toBe('pending');
  });

  it('when block is called with the label S2, should mark slice-002 blocked', async () => {
    // given: a seeded job with all slices pending
    bindSession(ws.path);
    await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'S1,S2,S3,S4'], ws.path);
    // when: block runs with the second slice's label
    const captured = await runJob(
      ['block', '--job-id', JOB_ID, '--slice-id', 'S2', '--reason', 'waiting on review'],
      ws.path,
    );
    // then: slice-002 is the one that flipped
    expect(parseJson(captured).ok).toBe(true);
    expect(readSlices(ws.path)[1]!.status).toBe('blocked');
  });
});

describe('Scenario: render — the checkpoint envelope and progress.json carry the canonical sliceId', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-slice-id-render-');
    withEnv('PEAKS_SESSION_ID', undefined);
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when checkpoint is called with the label S1, should mirror canonical progress into progress.json', async () => {
    // given: a 4-slice job read via the label form
    bindSession(ws.path);
    await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'S1,S2,S3,S4'], ws.path);
    // when: the first slice is checkpointed as done by label
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'S1', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the envelope reports the canonical id and the progress mirror advances
    const envelope = parseJson(captured);
    expect(envelope.data.sliceId).toBe('slice-001');
    expect(envelope.data.status).toBe('done');
    const progress = readProgress(ws.path);
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(4);
    expect(progress.currentSlice).toBe('S2');
    expect(progress.lastCommitSha).toBe(COMMIT_SHA);
  });
});

describe('Scenario: integration — an unmatched --slice-id must not write anything', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-slice-id-integr-');
    withEnv('PEAKS_SESSION_ID', undefined);
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when --slice-id is a typo (slice-01), should fail loudly and leave state.json and progress.json untouched', async () => {
    // given: a seeded job and no progress.json yet
    bindSession(ws.path);
    await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'S1,S2,S3,S4'], ws.path);
    expect(existsSync(join(jobDir(ws.path), 'progress.json'))).toBe(false);
    // when: checkpoint runs with a mistyped id
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-01', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the envelope is a failure and no slice/progress write happened
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SLICE_NOT_FOUND');
    expect(readSlices(ws.path).every((sl) => sl.status === 'pending')).toBe(true);
    expect(existsSync(join(jobDir(ws.path), 'progress.json'))).toBe(false);
  });

  it('when --state done matches no slice, should not call the codegraph refresh', async () => {
    // given: a seeded job
    bindSession(ws.path);
    await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'S1,S2'], ws.path);
    // when: checkpoint runs with an unmatched id
    await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-09', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the slice-complete boundary never fired
    expect(__autorefresh.refreshCodegraphAfterSlice).not.toHaveBeenCalled();
  });
});

describe('Scenario: a11y — an unmatched --slice-id names the valid ids', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-slice-id-a11y-');
    withEnv('PEAKS_SESSION_ID', undefined);
    __autorefresh.refreshCodegraphAfterSlice.mockReset();
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
  });
  afterEach(() => { cleanupTmpWorkspace(); });

  it('when the requested slice does not exist, should list every valid sliceId and label', async () => {
    // given: a seeded 4-slice job
    bindSession(ws.path);
    await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'S1,S2,S3,S4'], ws.path);
    // when: checkpoint runs with an id that matches nothing
    const captured = await runJob(
      ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'S9', '--state', 'done', '--commit-sha', COMMIT_SHA],
      ws.path,
    );
    // then: the message names the offending id and every valid pair
    const envelope = parseJson(captured);
    expect(envelope.message).toContain('"S9"');
    expect(envelope.message).toContain('slice-001 (S1)');
    expect(envelope.message).toContain('slice-004 (S4)');
    expect(envelope.data.validSliceIds).toEqual(['slice-001', 'slice-002', 'slice-003', 'slice-004']);
  });
});
