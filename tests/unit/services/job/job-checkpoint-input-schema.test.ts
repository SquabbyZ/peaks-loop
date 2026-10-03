// tests/unit/services/job/job-checkpoint-input-schema.test.ts
//
// D2 (rid 2026-10-03-job-ledger-truthfulness), input-gate half: the checkpoint
// command's own validator must refuse a `--state done` claim whose commit does not
// exist, and must do so in the right ORDER.
//
// Why the schema is where the check runs: `JobCheckpointInputSchema.safeParse` is
// the first thing the `checkpoint` action does, so a refusal happens before
// `resolveJobStateRoot`, before the state lock, and before either ledger file is
// opened — that is what makes "the ledger is byte-unchanged on refusal" a property
// of the code path rather than of a careful rollback. This file pins the two rules
// that ordering carries:
//
//   1. the ≥7 shape rule is a PRE-FILTER — a malformed string is refused without
//      ever paying a `git` call;
//   2. past it, the verdict decides: `unresolved` and `git-unavailable` refuse,
//      `verified` and `no-repository` record.
//
// Only the spawn boundary is replaced: `verifyCommitSha` is mocked so the arms can
// say which verdict the ledger received, while the REAL refusal-message builder
// (`commitVerificationRefusal`) runs on top of it — so the text asserted here is the
// shipped text, not a stub's. No git is spawned by this file.
//
// Run with: pnpm vitest run tests/unit/services/job/job-checkpoint-input-schema.test.ts

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

const __verify = vi.hoisted(() => ({ verifyCommitSha: vi.fn() }));

vi.mock('~/src/services/job/job-commit-verification', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/src/services/job/job-commit-verification')>()),
  verifyCommitSha: __verify.verifyCommitSha
}));

import { JobCheckpointInputSchema } from '~/src/services/job/job-types';
import type { CommitVerification } from '~/src/services/job/job-commit-verification';

declareDimensions(
  'tests/unit/services/job/job-checkpoint-input-schema.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'this schema renders nothing — it is the input gate whose output is an issue list; the envelope a refusal produces is rendered in tests/unit/cli/job-checkpoint-commit-sha.test.ts'
    }
  ]
);

const PROJECT = 'C:/repo/under-test';

/** One `--state done` claim, varying only the sha and the verdict git returns. */
function parseDone(commitSha: string | undefined) {
  return JobCheckpointInputSchema.safeParse({
    jobId: 'j1',
    sliceId: 'slice-001',
    state: 'done',
    ...(commitSha === undefined ? {} : { commitSha }),
    project: PROJECT,
    json: true
  });
}

function messages(result: { success: false; error: { message: string } }): string {
  return result.error.message;
}

beforeEach(() => {
  __verify.verifyCommitSha.mockReset();
  __verify.verifyCommitSha.mockReturnValue({ status: 'verified', sha: 'deadbeef1234567' });
});

describe('Scenario: behavior — the shape rule is a pre-filter, the existence rule follows it', () => {
  it('when the sha is shorter than 7 characters, should refuse without calling git', () => {
    // when: a string that is not even sha-shaped is claimed
    const result = parseDone('abc');
    // then: the pre-filter is the refusal and no `git` call was paid
    expect(result.success).toBe(false);
    expect(__verify.verifyCommitSha).not.toHaveBeenCalled();
    if (!result.success) {
      expect(messages(result)).toContain('7');
      expect(messages(result)).not.toContain('does not resolve');
    }
  });

  it('when the sha is absent entirely, should refuse without calling git', () => {
    // when: `--state done` arrives with no commit at all
    const result = parseDone(undefined);
    // then: same pre-filter, same refusal to spawn
    expect(result.success).toBe(false);
    expect(__verify.verifyCommitSha).not.toHaveBeenCalled();
  });

  it('when the sha is sha-shaped, should ask the repository, with the projects own root', () => {
    // when: a claim worth checking arrives
    const result = parseDone('deadbeef1234567');
    // then: the check ran against the project the caller named, not cwd
    expect(result.success).toBe(true);
    expect(__verify.verifyCommitSha).toHaveBeenCalledWith(PROJECT, 'deadbeef1234567');
  });

  it('when the state is not done, should not check any commit', () => {
    // when: a failed checkpoint carries an uncheckable sha
    const result = JobCheckpointInputSchema.safeParse({
      jobId: 'j1',
      sliceId: 'slice-001',
      state: 'failed',
      commitSha: 'fffffffffffffff',
      reason: 'the gate said no',
      project: PROJECT,
      json: true
    });
    // then: no commit claim is being recorded, so none is checked
    expect(result.success).toBe(true);
    expect(__verify.verifyCommitSha).not.toHaveBeenCalled();
  });
});

describe('Scenario: integration — each verdict decides whether the claim is accepted', () => {
  const verdicts: ReadonlyArray<{ name: string; verdict: CommitVerification; accepted: boolean }> =
    [
      { name: 'verified', verdict: { status: 'verified', sha: 'deadbeef1234567' }, accepted: true },
      {
        name: 'no-repository',
        verdict: {
          status: 'no-repository',
          detail: 'fatal: not a git repository (or any of the parent directories): .git'
        },
        accepted: true
      },
      {
        name: 'unresolved',
        verdict: {
          status: 'unresolved',
          sha: 'aabbccddeeff0011',
          detail: 'fatal: Not a valid object name aabbccddeeff0011^{commit}'
        },
        accepted: false
      },
      {
        name: 'git-unavailable',
        verdict: { status: 'git-unavailable', detail: 'spawnSync git ENOENT' },
        accepted: false
      }
    ];

  for (const { name, verdict, accepted } of verdicts) {
    it(`when git answers ${name}, should ${accepted ? 'record' : 'refuse'} the commit claim`, () => {
      // given: one verdict from the boundary
      __verify.verifyCommitSha.mockReturnValue(verdict);
      // when: the claim is parsed
      const result = parseDone(verdict.status === 'unresolved' ? verdict.sha : 'aabbccddeeff0011');
      // then: the ledger is reached only when git allowed it
      expect(result.success).toBe(accepted);
    });
  }
});

describe('Scenario: a11y — the refusal text the caller reads', () => {
  it('when git says the sha does not resolve, should name the sha and the repository', () => {
    // given: the refusal verdict, built by the real message builder
    __verify.verifyCommitSha.mockReturnValue({
      status: 'unresolved',
      sha: 'aabbccddeeff0011',
      detail: 'fatal: Not a valid object name aabbccddeeff0011^{commit}'
    });
    // when: the claim is refused
    const result = parseDone('aabbccddeeff0011');
    // then: the message carries the sha, the verdict, and where it looked — the
    //       three facts a caller needs to fix the command
    expect(result.success).toBe(false);
    if (!result.success) {
      const text = messages(result);
      expect(text).toContain('aabbccddeeff0011');
      expect(text).toContain('does not resolve to a commit');
      expect(text).toContain(PROJECT);
    }
  });

  it('when git could not run, should say it could not be checked rather than that it does not exist', () => {
    // given: a broken tool, which is not a verdict about the sha
    __verify.verifyCommitSha.mockReturnValue({
      status: 'git-unavailable',
      detail: 'spawnSync git ENOENT'
    });
    // when: the claim is refused
    const result = parseDone('aabbccddeeff0011');
    // then: the wording refuses to over-claim
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(messages(result)).toContain('could not be checked');
      expect(messages(result)).not.toContain('does not resolve');
    }
  });
});
