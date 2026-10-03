// tests/unit/cli/job-progress-current-slice.test.ts
//
// D3 (rid 2026-10-03-job-ledger-truthfulness, recorded by §2.38): the on-disk
// progress mirror carried `currentSlice: "slice-2"` on a job whose only
// registered slice was `slice-001` and was already done — a label describing no
// slice that exists.
//
// MEASURED BEFORE FIXING, against the committed build (`node bin/peaks.js`, one
// slice labelled `only-slice`, checkpointed done):
//
//   progress.json                → { done: 1, total: 1, currentSlice: "slice-2" }
//   peaks job progress --json    → nextActions: ["Next: slice #2 of 1 (slice-2)"]
//
// So the symptom reproduces. The cause is NOT the index arithmetic in
// `src/services/job/job-orchestrator.ts:141` (that returns a registered slice's
// label, or `undefined` when nothing is pending): it is the CLI's own fallback at
// `src/cli/commands/job-commands.ts:536`,
//
//   currentSlice: state.currentSlice ?? `slice-${state.done + 1}`
//
// which fabricates a label out of a counter the moment the ledger has no pending
// slice. The shape gives it away too: real slice ids are zero-padded
// (`slice-002`), so `slice-2` cannot even be a registered id.
//
// Fix under test, kept deliberately narrow (no progress-store refactor): the
// mirror carries the orchestrator's answer, and when there is no answer the store
// writes its own honest sentinel instead of the CLI inventing an identity.
//
// Dimensions covered:
//   - render:      progress.json's own bytes and the `job progress` line
//   - behavior:    a job with work left still reports a registered label
//   - integration: real ledger + real mirror over a scratch git repo
//   - a11y:        the text a resumed LLM reads
//
// Run with: pnpm vitest run tests/unit/cli/job-progress-current-slice.test.ts

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCliEnvelope } from '../../../src/cli/cli-envelope.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { JobStateSchema } from '../../../src/services/job/job-types.js';
import {
  JOB_PROGRESS_SCHEMA_VERSION,
  JobProgressSchema,
  NO_PENDING_SLICE_LABEL
} from '../../../src/services/job/job-progress-store.js';
import { parseJson } from '../../../src/shared/json-parse.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import { createScratchGitRepo, type ScratchGitRepo } from '../_setup/scratch-git-repo.js';

declareDimensions('tests/unit/cli/job-progress-current-slice.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-03-session-d3';

async function runJob(args: readonly string[], projectPath: string) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerJobCommands(program, io);
    await program.parseAsync(
      ['job', ...args, '--project', projectPath, '--session-id', SESSION_ID, '--json'],
      { from: 'user' }
    );
    return captured;
  } finally {
    process.exitCode = previousExitCode;
  }
}

function jobDir(projectPath: string, jobId: string): string {
  return join(projectPath, '.peaks', '_runtime', SESSION_ID, 'job', jobId);
}

/** The mirror as the shipped reader reads it: the store's own schema. */
function readMirror(projectPath: string, jobId: string) {
  return parseJson(
    readFileSync(join(jobDir(projectPath, jobId), 'progress.json'), 'utf8'),
    JobProgressSchema
  );
}

/** Every slice name the ledger actually knows: canonical ids and labels. */
function registeredSliceNames(projectPath: string, jobId: string): string[] {
  const state = parseJson(
    readFileSync(join(jobDir(projectPath, jobId), 'state.json'), 'utf8'),
    JobStateSchema
  );
  return [...state.slices.map((sl) => sl.sliceId), ...state.slices.map((sl) => sl.label)];
}

async function seedAndFinishOneSlice(
  projectPath: string,
  jobId: string,
  sha: string
): Promise<void> {
  await runJob(['init', '--job-id', jobId, '--slice-list', 'only-slice'], projectPath);
  await runJob(
    [
      'checkpoint',
      '--job-id',
      jobId,
      '--slice-id',
      'only-slice',
      '--state',
      'done',
      '--commit-sha',
      sha
    ],
    projectPath
  );
}

describe('Scenario: render — progress.json itself no longer carries the counter-derived label', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-d3-repo-');
  });
  afterEach(() => repo.dispose());

  it('when the only registered slice is done, should not carry the counter-derived label', async () => {
    // given/when: a one-slice job whose only slice is checkpointed done against
    //             a commit that really exists
    const jobId = 'd3-one-slice';
    await seedAndFinishOneSlice(repo.path, jobId, repo.headSha);
    // then: §2.38's symptom is gone from the file's own bytes, and the ledger
    //       never held a slice by that name
    const mirror = readFileSync(join(jobDir(repo.path, jobId), 'progress.json'), 'utf8');
    expect(mirror).not.toContain('"currentSlice": "slice-2"');
    expect(registeredSliceNames(repo.path, jobId)).not.toContain('slice-2');
  });
});

describe('Scenario: integration — the mirror the hooks read is still schema-valid', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-d3-sentinel-');
  });
  afterEach(() => repo.dispose());

  it('when the only registered slice is done, should carry the store sentinel', async () => {
    // given/when: the same job, finished
    const jobId = 'd3-sentinel';
    await seedAndFinishOneSlice(repo.path, jobId, repo.headSha);
    // then: the mirror is still schema-valid, and its currentSlice says plainly
    //       that nothing is pending rather than naming an identity
    const mirror = readMirror(repo.path, jobId);
    expect(mirror.schemaVersion).toBe(JOB_PROGRESS_SCHEMA_VERSION);
    expect(mirror.done).toBe(1);
    expect(mirror.total).toBe(1);
    expect(mirror.currentSlice).toBe(NO_PENDING_SLICE_LABEL);
    expect(registeredSliceNames(repo.path, jobId)).not.toContain(NO_PENDING_SLICE_LABEL);
  });
});

describe('Scenario: behavior — a job with work left still names the real next slice', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-d3-mid-');
  });
  afterEach(() => repo.dispose());

  it('when a later slice is still pending, should mirror that slice registered label', async () => {
    // given: a three-slice job
    const jobId = 'd3-three-slices';
    await runJob(['init', '--job-id', jobId, '--slice-list', 'alpha,beta,gamma'], repo.path);
    // when: the first slice is checkpointed done
    await runJob(
      [
        'checkpoint',
        '--job-id',
        jobId,
        '--slice-id',
        'alpha',
        '--state',
        'done',
        '--commit-sha',
        repo.headSha
      ],
      repo.path
    );
    // then: the mirror points at the second registered slice, by its label
    const mirror = readMirror(repo.path, jobId);
    expect(mirror.done).toBe(1);
    expect(mirror.total).toBe(3);
    expect(mirror.currentSlice).toBe('beta');
    expect(registeredSliceNames(repo.path, jobId)).toContain('beta');
  });
});

describe('Scenario: a11y — the resumed reader is not told to do a slice that does not exist', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-d3-a11y-');
  });
  afterEach(() => repo.dispose());

  it('when every slice is done, should print a progress line that names no phantom slice', async () => {
    // given: a one-slice job, finished
    const jobId = 'd3-next-line';
    await seedAndFinishOneSlice(repo.path, jobId, repo.headSha);
    // when: the mirror is read the way a resumed turn reads it
    const captured = await runJob(['progress', '--job-id', jobId], repo.path);
    // then: the envelope is ok, and its next line no longer claims `slice-2`
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    expect(envelope.ok).toBe(true);
    const line = (envelope.nextActions ?? []).join(' ');
    expect(line).not.toContain('slice-2');
    // criterion (c) (rid 2026-10-03-job-ledger-repair1): this arm used to assert
    // that the sentinel string appeared inside the sentence, which pinned the old
    // `slice #2 of 1 (no slice pending)` shape — an index the ledger cannot
    // support. The sentence now says the same fact in its own words and names the
    // command that would make a next slice real; see describeNextSlice.
    expect(line).not.toMatch(/slice #\d+ of/);
    expect(line).toContain('no further slice is registered');
    expect(line).toContain('peaks job add-slice');
  });
});
