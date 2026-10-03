// tests/unit/_setup/scratch-git-repo.ts
//
// A throwaway git repository for tests that must measure a REAL commit.
//
// WHY THIS EXISTS. `peaks job checkpoint --commit-sha` records a claim about a
// commit, and the claim is only testable against a repository that has commits.
// A hand-typed string (`deadbeef1234567`) can prove the ledger stored what it was
// handed; it cannot prove the CLI checked anything. So the arms that care about
// "does this sha resolve" need a repo the test created, with commits the test
// made — never the repository under test, whose `.git` no test may write to.
//
// Every git call here is synchronous and loud: a spawn that cannot run (no git on
// PATH) or a git command that fails THROWS rather than returning a half-built
// fixture. A fixture that did not run is never reported as "0 failures".

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ScratchGitRepo {
  /** Absolute path to the repository root (safe to pass as `--project`). */
  readonly path: string;
  /** The full 40-char sha of the single commit this fixture created. */
  readonly headSha: string;
  /** A short (7-char) prefix of `headSha` — the form users actually type. */
  readonly shortSha: string;
  /** Remove the directory. Registered by the caller in `afterEach`. */
  dispose: () => void;
}

/**
 * Run one git command in `cwd` and return its stdout, or throw.
 *
 * `status !== 0` and `error` are separate refusals: the first is git saying no,
 * the second is the process never starting. The message names both.
 */
function git(cwd: string, args: readonly string[]): string {
  const res = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (res.error !== undefined && res.error !== null) {
    throw new Error(
      `scratch-git-repo: \`git ${args.join(' ')}\` did not run in ${cwd}: ${res.error.message}`
    );
  }
  if (res.status !== 0) {
    throw new Error(
      `scratch-git-repo: \`git ${args.join(' ')}\` failed in ${cwd} (exit ${String(res.status)}): ${(res.stderr ?? '').trim()}`
    );
  }
  return (res.stdout ?? '').trim();
}

/**
 * True when `dir` is inside no git repository at all.
 *
 * The `no-repository` arms of the commit-verification tests are only meaningful
 * in a directory git itself agrees is not a repo — a tmp path that happens to
 * sit under a working tree would silently turn a refusal arm into a pass. The
 * helpers below refuse to build a fixture on that assumption.
 */
function isGitRepository(dir: string): boolean {
  const res = spawnSync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
    encoding: 'utf8',
    windowsHide: true
  });
  return res.error === undefined || res.error === null ? res.status === 0 : true;
}

function makeScratchDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function assertOutsideAnyRepo(dir: string): void {
  if (isGitRepository(dir)) {
    throw new Error(
      `scratch-git-repo: ${dir} already sits inside a git repository, so a "not a repository" ` +
        'fixture cannot be built here. Point TMPDIR outside the working tree and re-run.'
    );
  }
}

/** Create a repo with exactly one commit and return its shas. */
export function createScratchGitRepo(prefix = 'peaks-scratch-repo-'): ScratchGitRepo {
  const path = makeScratchDir(prefix);
  git(path, ['init', '--quiet']);
  // Local config only — never the operator's global identity, and never a hook
  // that could reach the repository under test.
  git(path, ['config', 'user.email', 'rd@peaks.invalid']);
  git(path, ['config', 'user.name', 'Peaks RD fixture']);
  git(path, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(path, 'seed.txt'), 'seed\n', 'utf8');
  git(path, ['add', 'seed.txt']);
  git(path, ['commit', '--quiet', '-m', 'seed commit']);
  const headSha = git(path, ['rev-parse', 'HEAD']);
  const shortSha = git(path, ['rev-parse', '--short=7', 'HEAD']);
  if (headSha.length !== 40 || !shortSha.startsWith(shortSha.slice(0, 7))) {
    throw new Error(`scratch-git-repo: unexpected sha shape head=${headSha} short=${shortSha}`);
  }
  return {
    path,
    headSha,
    shortSha,
    dispose: () => {
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  };
}

/** A directory that is NOT a git repository (and is provably not inside one). */
export function createScratchPlainDir(prefix = 'peaks-scratch-plain-'): {
  readonly path: string;
  dispose: () => void;
} {
  const path = makeScratchDir(prefix);
  assertOutsideAnyRepo(path);
  return {
    path,
    dispose: () => {
      rmSync(path, { recursive: true, force: true, maxRetries: 3 });
    }
  };
}

/**
 * A sha 7+ characters long that git says resolves to nothing in `repoPath`.
 *
 * The fixture asks git rather than trusting a constant, because a random hex
 * string can collide with a real object — and an arm that means to prove a
 * refusal must not be handed a commit that exists.
 */
export function unresolvedShaIn(repoPath: string): string {
  const candidate = 'aabbccddeeff0011';
  const res = spawnSync('git', ['-C', repoPath, 'cat-file', '-e', `${candidate}^{commit}`], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (res.status === 0) {
    throw new Error(
      `scratch-git-repo: ${candidate} resolves in ${repoPath}; the refusal fixture needs a sha that does not`
    );
  }
  return candidate;
}
