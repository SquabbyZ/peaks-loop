// tests/unit/services/job/job-commit-verification.test.ts
//
// D2 (rid 2026-10-03-job-ledger-truthfulness), service half: the one question the
// ledger now asks before it records a commit — does this sha resolve to a commit in
// THIS repository?
//
// This file talks to real git in `mkdtempSync` scratch repos that ran their own
// `git init` and made their own commit (tests/unit/_setup/scratch-git-repo.ts). The
// repository under test is never written to. Nothing here is mocked, so the four
// verdicts are git's own answers rather than a fixture's:
//
//   verified        git exit 0
//   unresolved      a repo is present and says `Not a valid object name`
//   no-repository   git says there is no repository to ask
//   git-unavailable git itself could not be run
//
// The last one is the only verdict this file cannot produce on a machine that has
// git, so it is pinned at the schema layer instead
// (tests/unit/services/job/job-checkpoint-input-schema.test.ts).
//
// Run with: pnpm vitest run tests/unit/services/job/job-commit-verification.test.ts

import { describe, expect, it } from 'vitest';

import {
  commitVerificationRefusal,
  verifyCommitSha
} from '~/src/services/job/job-commit-verification';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  createScratchGitRepo,
  createScratchPlainDir,
  unresolvedShaIn
} from '../../_setup/scratch-git-repo.js';

declareDimensions(
  'tests/unit/services/job/job-commit-verification.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the service returns a verdict, not output — the rendered refusal text is the a11y scenario, and the envelope a refusal produces is rendered in tests/unit/cli/job-checkpoint-commit-sha.test.ts'
    }
  ]
);

describe('Scenario: integration — the verdict is git answer, not a shape guess', () => {
  it('when the sha is a commit in the scratch repo, should report verified', () => {
    // given: a scratch repository with exactly one commit
    const repo = createScratchGitRepo('peaks-verify-ok-');
    try {
      // when/then: git itself resolves it, at both lengths a caller may type
      expect(verifyCommitSha(repo.path, repo.headSha).status).toBe('verified');
      expect(verifyCommitSha(repo.path, repo.shortSha).status).toBe('verified');
    } finally {
      repo.dispose();
    }
  });

  it('when the sha is 7+ characters and no commit here, should report unresolved', () => {
    // given: a repository, and a sha long enough to pass the shape pre-filter
    const repo = createScratchGitRepo('peaks-verify-bad-');
    try {
      const bogus = unresolvedShaIn(repo.path);
      // when: the check asks about it
      const verdict = verifyCommitSha(repo.path, bogus);
      // then: it is the refusal case, and the sha travels with the verdict
      expect(verdict.status).toBe('unresolved');
      expect(verdict.status === 'unresolved' ? verdict.sha : '').toBe(bogus);
      expect(verdict.status === 'unresolved' ? verdict.detail : '').toContain(bogus);
    } finally {
      repo.dispose();
    }
  });

  it('when the project is not a repository at all, should report no-repository', () => {
    // given: a directory git says holds no repository
    const plain = createScratchPlainDir('peaks-verify-norepo-');
    try {
      // when/then: the answer is about the ABSENCE of a repo, not about the sha
      expect(verifyCommitSha(plain.path, 'deadbeef1234567').status).toBe('no-repository');
    } finally {
      plain.dispose();
    }
  });
});

describe('Scenario: behavior — which verdicts allow the ledger to be written', () => {
  it('when the sha resolves, should give the caller no refusal to report', () => {
    const repo = createScratchGitRepo('peaks-verify-allow-');
    try {
      const verdict = verifyCommitSha(repo.path, repo.headSha);
      expect(commitVerificationRefusal(verdict, repo.path, repo.headSha)).toBeNull();
    } finally {
      repo.dispose();
    }
  });

  it('when there is no repository, should give no refusal either — nothing checked the claim', () => {
    // The boundary this slice chose and states: a directory with no git repository
    // cannot say whether the sha exists, and `git` answering "not a git repository"
    // is not a verdict about the sha. Recording proceeds as it did before the fix;
    // the refusal arms above are what changed.
    const plain = createScratchPlainDir('peaks-verify-boundary-');
    try {
      const verdict = verifyCommitSha(plain.path, 'deadbeef1234567');
      expect(commitVerificationRefusal(verdict, plain.path, 'deadbeef1234567')).toBeNull();
    } finally {
      plain.dispose();
    }
  });

  it('when the sha does not resolve, should refuse', () => {
    const repo = createScratchGitRepo('peaks-verify-refuse-');
    try {
      const bogus = unresolvedShaIn(repo.path);
      const verdict = verifyCommitSha(repo.path, bogus);
      expect(commitVerificationRefusal(verdict, repo.path, bogus)).not.toBeNull();
    } finally {
      repo.dispose();
    }
  });
});

describe('Scenario: a11y — what the refusal says', () => {
  it('when the sha does not resolve, should name the sha, the verdict and the repository', () => {
    const repo = createScratchGitRepo('peaks-verify-text-');
    try {
      const bogus = unresolvedShaIn(repo.path);
      const message = commitVerificationRefusal(
        verifyCommitSha(repo.path, bogus),
        repo.path,
        bogus
      );
      // Every reader of the refusal — a human on stderr, an LLM in the envelope —
      // gets the same three facts: which sha, that it does not resolve, where it
      // was looked for.
      expect(message).toContain(`"${bogus}"`);
      expect(message).toContain('does not resolve to a commit');
      expect(message).toContain(repo.path);
    } finally {
      repo.dispose();
    }
  });
});
