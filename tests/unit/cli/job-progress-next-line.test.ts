// tests/unit/cli/job-progress-next-line.test.ts
//
// criterion (c) (rid 2026-10-03-job-ledger-repair1): `peaks job progress` reports
// the honest FIELD (`currentSlice: "no slice pending"`) and still prints the old
// arithmetic in the one line a human reads.
//
// MEASURED before this file was written, against the built tree at `1c0f51aa` plus
// the uncommitted job-ledger slice, in a `mkdtempSync` scratch repo that ran its own
// `git init` (`node bin/peaks.js`, job `probe`, both registered slices done):
//
//   peaks job progress --job-id probe
//     → next: Next: slice #3 of 2 (no slice pending)
//
// `slice #3 of 2` is exactly the misreport the parent slice exists to kill — a
// number the ledger cannot support — and it survives in the line a resumed reader
// acts on. Criterion (c) asks the line to say what is true and to name the command
// that changes the ledger, and the audit extends to every branch that builds that
// `#N of M` arithmetic (src/cli/commands/job-commands.ts, src/services/code/
// step-08-gate.ts, src/services/context/post-compact-reinjection.ts — all three read
// the same builder now, which is why the coupling arm below is one test: the advice
// and the command it points at cannot drift apart again).
//
// Dimensions covered:
//   - render:      the `next:` line itself, in both output modes
//   - behavior:    which ledger state entitles which claim
//   - integration: real ledger + real mirror + real git commit, and the advised
//                  command executed rather than described
//   - a11y:        the line checked against `state.json`'s own slice list
//
// Run with: pnpm vitest run tests/unit/cli/job-progress-next-line.test.ts

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCliEnvelope } from '../../../src/cli/cli-envelope.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { registerJobAddSliceCommand } from '../../../src/cli/commands/job-add-slice-command.js';
import { NO_PENDING_SLICE_LABEL } from '../../../src/services/job/job-progress-store.js';
import { JobStateSchema, type JobState } from '../../../src/services/job/job-types.js';
import { parseJson } from '../../../src/shared/json-parse.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv, type CapturedIo } from '../_setup/io.js';
import { createScratchGitRepo, type ScratchGitRepo } from '../_setup/scratch-git-repo.js';

declareDimensions('tests/unit/cli/job-progress-next-line.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-03-session-repair1';

async function runJob(
  args: readonly string[],
  projectPath: string,
  json = true
): Promise<CapturedIo> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerJobCommands(program, io);
    registerJobAddSliceCommand(program, io);
    const tail = json ? ['--json'] : [];
    await program.parseAsync(
      ['job', ...args, '--project', projectPath, '--session-id', SESSION_ID, ...tail],
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

/** The ledger as the file on disk has it — never as a constant in this file. */
function ledger(projectPath: string, jobId: string): JobState {
  return parseJson(
    readFileSync(join(jobDir(projectPath, jobId), 'state.json'), 'utf8'),
    JobStateSchema
  );
}

/** The progress mirror's own words for the next slice, as the CLI prints them. */
function nextLineOf(captured: CapturedIo): string {
  const envelope = parseCliEnvelope(captured.stdout.join('\n'));
  expect(envelope.ok).toBe(true);
  const lines = (envelope.nextActions ?? []).filter((line) => line.startsWith('Next:'));
  expect(lines).toHaveLength(1);
  return lines[0] ?? '';
}

async function progressLine(projectPath: string, jobId: string): Promise<string> {
  return nextLineOf(await runJob(['progress', '--job-id', jobId], projectPath));
}

async function checkpointDone(
  projectPath: string,
  jobId: string,
  sliceId: string,
  sha: string
): Promise<CapturedIo> {
  return runJob(
    [
      'checkpoint',
      '--job-id',
      jobId,
      '--slice-id',
      sliceId,
      '--state',
      'done',
      '--commit-sha',
      sha
    ],
    projectPath
  );
}

/**
 * The command the line advises, as argv — the placeholder label supplied by the
 * caller, everything else taken verbatim from the tool's own sentence.
 */
function advisedAddSlice(line: string, label: string): string[] {
  const start = line.indexOf('peaks job add-slice');
  expect(start).toBeGreaterThanOrEqual(0);
  return line
    .slice(start)
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .slice(2) // `peaks job` — runJob re-prepends `job`
    .map((token) => {
      const unquoted = token.replace(/^"(.*)"$/, '$1');
      return unquoted === '<label>' ? label : unquoted;
    });
}

describe('Scenario: render — the all-done line makes no index claim', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-repair1-render-');
  });
  afterEach(() => repo.dispose());

  it('when every registered slice is done, should print no `slice #N` and name add-slice', async () => {
    // given: a two-slice job, both checkpointed done against a real commit
    const jobId = 'repair1-all-done';
    await runJob(
      ['init', '--job-id', jobId, '--slice-list', 'first slice,second slice'],
      repo.path
    );
    await checkpointDone(repo.path, jobId, 'slice-001', repo.headSha);
    await checkpointDone(repo.path, jobId, 'slice-002', repo.headSha);
    // when: the mirror is read the way a resumed turn reads it
    const line = await progressLine(repo.path, jobId);
    // then: `slice #3 of 2` is gone — no index claim survives, and the sentence
    //       names the command that would make a third slice real
    expect(line).not.toMatch(/slice #/);
    expect(line).not.toMatch(/#\d+ of \d+/);
    expect(line).toContain('no further slice is registered');
    expect(line).toContain('peaks job add-slice');
    expect(line).not.toContain(NO_PENDING_SLICE_LABEL);
  });

  it('in the human-readable mode, should keep the `next:` label the reader greps for', async () => {
    // given: the same finished job
    const jobId = 'repair1-render-text';
    await runJob(['init', '--job-id', jobId, '--slice-list', 'only slice'], repo.path);
    await checkpointDone(repo.path, jobId, 'slice-001', repo.headSha);
    // when: progress runs without --json (what a terminal shows a human). The
    // record prints without a trailing newline, so the labelled sentence follows
    // it on the same captured chunk — grep the label, not a line start.
    const captured = await runJob(['progress', '--job-id', jobId], repo.path, false);
    const printed = captured.stdout.join('');
    // then: the honest sentence is the one on stdout, on the `next:` label
    expect(printed).toContain('next: Next: ');
    expect(printed).not.toMatch(/slice #\d+ of/);
    expect(printed).toContain('peaks job add-slice');
  });
});

describe('Scenario: behavior — an index is entitled only by a pending slice', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-repair1-behavior-');
  });
  afterEach(() => repo.dispose());

  it('when a slice is pending of five registered, should name it with an index within the total', async () => {
    // given: five registered slices, four done in order
    const jobId = 'repair1-pending-of-five';
    await runJob(
      ['init', '--job-id', jobId, '--slice-list', 'alpha,beta,gamma,delta,epsilon'],
      repo.path
    );
    for (const sliceId of ['slice-001', 'slice-002', 'slice-003', 'slice-004']) {
      await checkpointDone(repo.path, jobId, sliceId, repo.headSha);
    }
    // when
    const line = await progressLine(repo.path, jobId);
    const claim = /slice #(\d+) of (\d+) \((.+)\)/.exec(line);
    // then: the claim exists, is within the ledger, and names the pending slice
    expect(claim).not.toBeNull();
    const slices = ledger(repo.path, jobId).slices;
    expect(Number(claim?.[1])).toBeLessThanOrEqual(slices.length);
    expect(Number(claim?.[2])).toBe(slices.length);
    expect(claim?.[3]).toBe('epsilon');
    // and the add-slice advice has no business in a line with work pending
    expect(line).not.toContain('add-slice');
  });

  it('when nothing is pending but registered slices are unfinished, should not announce the next index', async () => {
    // given: three slices, one blocked, the other two done in order
    const jobId = 'repair1-none-pending-remaining';
    await runJob(['init', '--job-id', jobId, '--slice-list', 'alpha,beta,gamma'], repo.path);
    await runJob(
      ['block', '--job-id', jobId, '--slice-id', 'beta', '--reason', 'waiting on an owner call'],
      repo.path
    );
    await checkpointDone(repo.path, jobId, 'alpha', repo.headSha);
    await checkpointDone(repo.path, jobId, 'gamma', repo.headSha);
    // when: the mirror is read — 2 of 3 done, nothing pending
    const line = await progressLine(repo.path, jobId);
    // then: `slice #3 of 3` claimed the blocked slice as the next work item
    expect(line).not.toMatch(/slice #/);
    expect(line).toContain('no slice is pending');
    expect(line).toContain('peaks job add-slice');
    expect(ledger(repo.path, jobId).slices.filter((sl) => sl.status === 'pending')).toHaveLength(0);
  });
});

describe('Scenario: integration — following the line reaches a command that works', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-repair1-coupling-');
  });
  afterEach(() => repo.dispose());

  it('after SLICE_NOT_FOUND, the advised add-slice should succeed and the slice the line then names should checkpoint', async () => {
    // given: a one-slice job finished, and a second slice the ledger has never
    //        heard of — the D1 reproduction, and the reason this pairing exists
    const jobId = 'repair1-coupling';
    await runJob(['init', '--job-id', jobId, '--slice-list', 'first slice'], repo.path);
    await checkpointDone(repo.path, jobId, 'slice-001', repo.headSha);
    const refused = await checkpointDone(repo.path, jobId, 'slice-002', repo.headSha);
    const refusal = parseCliEnvelope(refused.stdout.join('\n'));
    expect(refusal.ok).toBe(false);
    expect(refusal.code).toBe('SLICE_NOT_FOUND');

    // half 1: do EXACTLY what the tool's own next: line advises. Before the fix
    // this line read `Next: slice #3 of 2 (no slice pending)`, which advises no
    // command at all and points at a slice that does not exist.
    const advised = await progressLine(repo.path, jobId);
    const args = advisedAddSlice(advised, 'second slice');
    expect(args.slice(0, 2)).toEqual(['add-slice', '--job-id']);
    expect(args).toContain(jobId);
    const added = parseCliEnvelope((await runJob(args, repo.path)).stdout.join('\n'));
    expect(added.ok).toBe(true);

    // half 2: the same line now names a pending slice; checkpointing that very
    // identity must work, or the advice and the ledger have drifted apart.
    const named = await progressLine(repo.path, jobId);
    const identity = /slice #\d+ of \d+ \((.+)\)/.exec(named)?.[1];
    expect(identity).toBeDefined();
    const completed = parseCliEnvelope(
      (await checkpointDone(repo.path, jobId, identity ?? '', repo.headSha)).stdout.join('\n')
    );
    expect(completed.ok).toBe(true);
    expect(ledger(repo.path, jobId).slices.filter((sl) => sl.status === 'done')).toHaveLength(2);
  });
});

describe('Scenario: a11y — the line reports only slices the state file registers', () => {
  let repo: ScratchGitRepo;
  beforeEach(() => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-repair1-invariant-');
  });
  afterEach(() => repo.dispose());

  /**
   * The invariant, over `state.json`'s slice list rather than a string constant:
   * the line may claim a next index only when the ledger has a pending slice, the
   * index it claims must be inside the registered list, and any identity it
   * parenthesises must be a registered id or label of a slice that is not done.
   */
  async function expectLineAgreesWithLedger(projectPath: string, jobId: string): Promise<void> {
    const line = await progressLine(projectPath, jobId);
    const slices = ledger(projectPath, jobId).slices;
    const registered = new Set<string>(slices.flatMap((sl) => [sl.sliceId, sl.label]));
    const pending = slices.filter((sl) => sl.status === 'pending' || sl.status === 'in-progress');
    const claim = /slice #(\d+) of (\d+)(?: \((.+)\))?/.exec(line);
    if (pending.length === 0) {
      expect(claim).toBeNull();
      expect(line).toContain('peaks job add-slice');
      return;
    }
    expect(claim).not.toBeNull();
    expect(Number(claim?.[2])).toBe(slices.length);
    const index = Number(claim?.[1]);
    expect(index).toBeGreaterThan(0);
    expect(index).toBeLessThanOrEqual(slices.length);
    const named = claim?.[3];
    if (named !== undefined) {
      expect(registered.has(named)).toBe(true);
      expect(
        slices.some((sl) => (sl.sliceId === named || sl.label === named) && sl.status !== 'done')
      ).toBe(true);
    }
  }

  it('across untouched, mid-wave and finished ledgers, should report only registered slices', async () => {
    const jobId = 'repair1-invariant';
    await runJob(['init', '--job-id', jobId, '--slice-list', 'alpha,beta,gamma'], repo.path);
    await checkpointDone(repo.path, jobId, 'alpha', repo.headSha);
    // given/when: mid-wave — one pending slice of three
    await expectLineAgreesWithLedger(repo.path, jobId);
    // and: a slice discovered after the fact, registered through the command the
    //      line itself advises for the finished job
    await runJob(['add-slice', '--job-id', jobId, '--slice-label', 'delta'], repo.path);
    await expectLineAgreesWithLedger(repo.path, jobId);
    // when: every registered slice is done
    for (const sliceId of ['slice-002', 'slice-003', 'slice-004']) {
      await checkpointDone(repo.path, jobId, sliceId, repo.headSha);
    }
    // then: still only registered slices, and no index the ledger cannot hold
    await expectLineAgreesWithLedger(repo.path, jobId);
    expect(ledger(repo.path, jobId).slices).toHaveLength(4);
  });
});
