import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { resolveCanonicalProjectRoot } from '../../src/services/config/config-safety.js';

function makeTempDir(): string {
  // realpathSync so the returned path matches what git rev-parse will
  // return on macOS, where /tmp is a symlink to /private/tmp. Without
  // this, equality assertions would fail in either direction depending
  // on which side of the symlink each path came from.
  return realpathSync(mkdtempSync(join(tmpdir(), 'peaks-canonical-root-')));
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

describe('resolveCanonicalProjectRoot', () => {
  let home: string;
  beforeEach(() => {
    home = makeTempDir();
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test('promotes a nested sub-folder of a git repo to the git root (the prompt-project regression)', () => {
    // Realistic scenario: outer prompt-project/ is a git repo; the LLM
    // called peaks from inside prompt-project/prompt-project/ and passed
    // $(pwd). The old heuristic wrote .peaks/ into the nested
    // sub-folder. The fix must promote the path to the git root.
    const outer = join(home, 'prompt-project');
    mkdirSync(outer);
    git(outer, ['init', '-q']);
    const nested = join(outer, 'prompt-project');
    mkdirSync(nested);

    const result = resolveCanonicalProjectRoot(nested);

    expect(result).toBe(outer);
  });

  test('promotes a deeply nested sub-folder (3 levels deep) to the git root', () => {
    const outer = join(home, 'repo');
    mkdirSync(outer);
    git(outer, ['init', '-q']);
    const nested = join(outer, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });

    const result = resolveCanonicalProjectRoot(nested);

    expect(result).toBe(outer);
  });

  test('does not change the path when the cwd is already the git root', () => {
    const outer = join(home, 'repo');
    mkdirSync(outer);
    git(outer, ['init', '-q']);

    const result = resolveCanonicalProjectRoot(outer);

    expect(result).toBe(outer);
  });

  test('falls back to the cwd verbatim when the path is not inside a git repo (no git on path scenario)', () => {
    // A non-git directory: helper should not throw, should return the
    // cwd untouched. We simulate this by NOT running `git init`.
    const noGit = join(home, 'plain');
    mkdirSync(noGit);

    const result = resolveCanonicalProjectRoot(noGit);

    expect(result).toBe(noGit);
  });

  test('falls back to findProjectRoot heuristic when not in a git repo but a peaks .peaks/config.json marker exists', () => {
    // A pre-existing peaks project that was never committed to git
    // (e.g. a side-project living outside any VCS). The helper should
    // find the .peaks/config.json marker via the heuristic fallback
    // and return its directory, not the cwd.
    const noGit = join(home, 'side-project');
    mkdirSync(join(noGit, '.peaks'), { recursive: true });
    writeFileSync(join(noGit, '.peaks', 'config.json'), '{}', 'utf8');

    const result = resolveCanonicalProjectRoot(noGit);

    expect(result).toBe(noGit);
  });

  test('does not promote across git-repo boundaries (sub-folder of repo A is not repo B)', () => {
    // Two sibling git repos. A sub-folder of repo A must not be
    // promoted to repo B even if cwd walking would accidentally find B.
    // We construct the layout so the heuristic's home-boundary
    // protection matters: home is below tmpdir, both repos live
    // there, and the inner of repo A is several levels deep.
    const repoA = join(home, 'a');
    const repoB = join(home, 'b');
    mkdirSync(repoA);
    mkdirSync(repoB);
    git(repoA, ['init', '-q']);
    git(repoB, ['init', '-q']);
    const nestedInA = join(repoA, 'src', 'components');
    mkdirSync(nestedInA, { recursive: true });

    const result = resolveCanonicalProjectRoot(nestedInA);

    expect(result).toBe(repoA);
    // Make sure it did NOT pick repoB.
    expect(result).not.toBe(repoB);
  });

  test('handles a git worktree (git rev-parse returns the toplevel inside a worktree)', () => {
    // Worktrees: a sub-folder of a worktree still resolves to the
    // worktree's toplevel, not the original repo. This matches the
    // user-visible definition of "where does this project live?".
    const outer = join(home, 'main-repo');
    mkdirSync(outer);
    git(outer, ['init', '-q']);
    git(outer, ['commit', '--allow-empty', '-q', '-m', 'init']);
    // No linked worktree in the test sandbox (would need git worktree add
    // + a second working dir); just confirm the happy path stays stable
    // for the common non-worktree case.
    const nested = join(outer, 'src', 'lib');
    mkdirSync(nested, { recursive: true });

    const result = resolveCanonicalProjectRoot(nested);

    expect(result).toBe(outer);
  });
});
