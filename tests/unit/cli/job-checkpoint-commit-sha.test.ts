// tests/unit/cli/job-checkpoint-commit-sha.test.ts
//
// D2 (rid 2026-10-03-job-ledger-truthfulness): `peaks job checkpoint --state
// done --commit-sha <sha>` validated only `sha.length >= 7`
// (`src/services/job/job-orchestrator.ts:55`), so a typo'd sha was accepted,
// written into `state.json`, and mirrored into `progress.json`. Measured against
// the committed build on 2026-10-03 (and again for this slice, see the envelope):
// a 12-hex string git calls `Not a valid object name` produced
// `{ ok: true, command: "checkpoint" }` and a ledger whose `commitSha` named it.
// A ledger that points at a commit which does not exist is worse than no ledger,
// because it will be trusted later.
//
// Fix under test: the sha must RESOLVE in the project git repository before the
// ledger is touched. The refusal rides the checkpoint input schema's existing
// refusal channel (`INVALID_CHECKPOINT`), which runs before
// `resolveJobStateRoot` and before every write — so a refusal leaves the ledger
// byte-unchanged, and the ≥7 pre-filter keeps a malformed string from paying a
// `git` call.
//
// Dimensions covered:
//   - render:      the refusal envelope and the ledger bytes it leaves behind
//   - behavior:    real sha recorded, unresolvable sha refused, prefix resolved
//   - integration: real `git cat-file` against a scratch repo with a real commit
//   - a11y:        the refusal message names the sha and says it does not resolve
//
// Nothing here mocks git. The repository under test is never written to: every
// fixture is a `mkdtempSync` scratch repo that ran its own `git init` and made
// its own commit (see tests/unit/_setup/scratch-git-repo.ts).
//
// Run with: pnpm vitest run tests/unit/cli/job-checkpoint-commit-sha.test.ts

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseCliEnvelope, parseCliEnvelopeWith } from '../../../src/cli/cli-envelope.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  createScratchGitRepo,
  createScratchPlainDir,
  unresolvedShaIn,
  type ScratchGitRepo
} from '../_setup/scratch-git-repo.js';

declareDimensions('tests/unit/cli/job-checkpoint-commit-sha.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-03-session-d2';
const JOB_ID = 'd2-commit-sha';

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

const checkpointPayload = z.looseObject({ sliceId: z.string(), status: z.string() });

/**
 * Run one `peaks job` invocation in-process and report what a script sees:
 * the captured channels and `process.exitCode` (zeroed and restored, exactly as
 * tests/unit/cli/job-exit-code.test.ts does — it is process-global).
 */
async function runJob(args: readonly string[], projectPath: string): Promise<CapturedIo> {
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

/** The exit code of one invocation, measured the same way. */
async function runJobExitCode(args: readonly string[], projectPath: string): Promise<number> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const { io } = makeCapturedIo();
    const program = new Command();
    registerJobCommands(program, io);
    await program.parseAsync(
      ['job', ...args, '--project', projectPath, '--session-id', SESSION_ID, '--json'],
      { from: 'user' }
    );
    return process.exitCode ?? 0;
  } finally {
    process.exitCode = previousExitCode;
  }
}

function statePath(projectPath: string): string {
  return join(projectPath, '.peaks', '_runtime', SESSION_ID, 'job', JOB_ID, 'state.json');
}

function progressPath(projectPath: string): string {
  return join(projectPath, '.peaks', '_runtime', SESSION_ID, 'job', JOB_ID, 'progress.json');
}

/** The ledger bytes, or null when the file does not exist yet. */
function readBytes(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function seedOneSliceJob(projectPath: string): Promise<void> {
  const seeded = parseCliEnvelope(
    (
      await runJob(['init', '--job-id', JOB_ID, '--slice-list', 'd2-slice'], projectPath)
    ).stdout.join('\n')
  );
  expect(seeded.ok).toBe(true);
}

describe('Scenario: integration — the sha is checked against a real repository', () => {
  let repo: ScratchGitRepo;

  beforeEach(async () => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-job-d2-repo-');
    await seedOneSliceJob(repo.path);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('when --commit-sha is the scratch repo HEAD, should accept it and record it verbatim', async () => {
    // given: a one-slice job in a repository with exactly one commit
    const sha = repo.headSha;
    // when: the slice is checkpointed done against that commit
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        sha
      ],
      repo.path
    );
    // then: the ledger carries the sha it was handed
    expect(parseCliEnvelopeWith(captured.stdout.join('\n'), checkpointPayload).ok).toBe(true);
    expect(readBytes(statePath(repo.path))).toContain(`"commitSha": "${sha}"`);
  });

  it('when --commit-sha is a 7-char prefix of a real commit, should resolve it and accept it', async () => {
    // given: the same repo, and the abbreviated form a human would type
    const short = repo.shortSha;
    // when: the checkpoint names the abbreviation rather than the full sha
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        short
      ],
      repo.path
    );
    // then: git resolves abbreviations, so the ledger is allowed to carry one
    expect(parseCliEnvelope(captured.stdout.join('\n')).ok).toBe(true);
    expect(readBytes(statePath(repo.path))).toContain(`"commitSha": "${short}"`);
  });
});

describe('Scenario: behavior — a sha that does not resolve is refused, and nothing is written', () => {
  let repo: ScratchGitRepo;

  beforeEach(async () => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-job-d2-bad-');
    await seedOneSliceJob(repo.path);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('when --commit-sha is not a commit in the project repo, should refuse', async () => {
    // given: a sha git itself calls unresolvable in this repository
    const bogus = unresolvedShaIn(repo.path);
    // when: the checkpoint claims that commit
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        bogus
      ],
      repo.path
    );
    // then: the envelope says no
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    expect(envelope.ok).toBe(false);
  });

  it('when --commit-sha is refused, should leave the ledger byte-unchanged', async () => {
    // given: the ledger exactly as `job init` wrote it, and no progress mirror
    const before = readBytes(statePath(repo.path));
    expect(before).not.toBeNull();
    expect(readBytes(progressPath(repo.path))).toBeNull();
    const bogus = unresolvedShaIn(repo.path);
    // when: a checkpoint claiming that sha runs
    await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        bogus
      ],
      repo.path
    );
    // then: state.json is the same bytes — not merely "still pending" — and no
    //       progress.json was created
    expect(readBytes(statePath(repo.path))).toBe(before);
    expect(readBytes(progressPath(repo.path))).toBeNull();
  });

  it('when --commit-sha is refused, should exit non-zero', async () => {
    // given: a repo, a seeded job, and an unresolvable sha
    const bogus = unresolvedShaIn(repo.path);
    // when: the refusal path runs as a script would run it
    const exitCode = await runJobExitCode(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        bogus
      ],
      repo.path
    );
    // then: it is a failure in the exit code as well as in the envelope
    expect(exitCode).toBe(1);
  });

  it('when --commit-sha is malformed (3 chars), should refuse on the shape rule without a git verdict', async () => {
    // given: a string that is not even sha-shaped
    // when: the checkpoint runs with it
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        'abc'
      ],
      repo.path
    );
    // then: the pre-filter is the refusal — the ≥7 message, not a resolution
    //       message. The ordering matters: a malformed string must not be paid
    //       a `git` call. (tests/unit/services/job/
    //       job-checkpoint-input-schema.test.ts pins the call itself away.)
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    expect(envelope.ok).toBe(false);
    expect(envelope.message ?? '').toContain('7');
    expect(envelope.message ?? '').not.toContain('does not resolve');
  });
});

describe('Scenario: render — the refusal envelope is a structured failure, not a recorded slice', () => {
  let repo: ScratchGitRepo;

  beforeEach(async () => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-job-d2-render-');
    await seedOneSliceJob(repo.path);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('when --commit-sha is refused, should report INVALID_CHECKPOINT with no checkpoint payload', async () => {
    // given: a sha this repository does not contain
    const bogus = unresolvedShaIn(repo.path);
    // when: the checkpoint runs
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        bogus
      ],
      repo.path
    );
    // then: the envelope is the failure shape the command already uses for a
    //       refused input, and it carries no `sliceId`/`status` (nothing was
    //       checkpointed)
    const envelope = parseCliEnvelope(captured.stdout.join('\n'));
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_CHECKPOINT');
    expect(envelope.data).not.toHaveProperty('sliceId');
    expect(envelope.data).not.toHaveProperty('status');
  });
});

describe('Scenario: a11y — the refusal envelope names the sha and the verdict', () => {
  let repo: ScratchGitRepo;

  beforeEach(async () => {
    withEnv('PEAKS_SESSION_ID', undefined);
    repo = createScratchGitRepo('peaks-job-d2-a11y-');
    await seedOneSliceJob(repo.path);
  });
  afterEach(() => {
    repo.dispose();
  });

  it('when the sha does not resolve, should name the sha and say it does not resolve', async () => {
    // given: an unresolvable sha
    const bogus = unresolvedShaIn(repo.path);
    // when: the checkpoint is refused
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        bogus
      ],
      repo.path
    );
    // then: the text a human or an LLM reads carries both facts
    const message = parseCliEnvelope(captured.stdout.join('\n')).message ?? '';
    expect(message).toContain(bogus);
    expect(message).toContain('does not resolve');
  });
});

describe('Scenario: behavior — the documented boundary: no repository, nothing to check', () => {
  // The check is "the sha must resolve in that repo". Where there is no repo at
  // all, `git cat-file` answers "not a git repository", which is not a verdict
  // about the sha — so the ledger records the claim as it was handed, exactly as
  // before this slice. This arm pins that boundary on purpose: it is the shape
  // the rest of the job suite already depends on (they run against tmp
  // workspaces with `deadbeef1234567`), and a silent widening of the refusal to
  // cover it would be a behaviour change nobody asked for. See the envelope.
  let plain: { path: string; dispose: () => void };

  beforeEach(async () => {
    withEnv('PEAKS_SESSION_ID', undefined);
    plain = createScratchPlainDir('peaks-job-d2-plain-');
    await seedOneSliceJob(plain.path);
  });
  afterEach(() => {
    plain.dispose();
  });

  it('when the project is not a git repository, should record the sha it was given', async () => {
    // given: a project directory git says is not a repository
    // when: a checkpoint names a sha that cannot be checked anywhere
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'd2-slice',
        '--state',
        'done',
        '--commit-sha',
        'deadbeef1234567'
      ],
      plain.path
    );
    // then: the claim is recorded, unverifiable and stated as such in the
    //       service's own status name
    expect(parseCliEnvelope(captured.stdout.join('\n')).ok).toBe(true);
    expect(readBytes(statePath(plain.path))).toContain('"commitSha": "deadbeef1234567"');
  });
});
