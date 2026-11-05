// tests/unit/cli/commands/worktree-lease-git.test.ts
//
// WHY THIS FILE EXISTS
// --------------------
// The independent security audit flagged `src/cli/commands/worktree-lease-git.ts`
// as `warn` for exactly one reason: it built a shell command string and
// double-quoted every non-git argument, so a `--branch` value containing `"` or
// `$(` reached the shell as syntax. The fix is not better quoting — it is no
// shell at all: the workspace-runtime package's `RunGit` contract is an argv
// array, and `execFileSync('git', argv, …)` hands that array to git unmodified.
//
// The behaviour this file pins is therefore the SECURITY property, not the
// formatting: a hostile branch must arrive as ONE argv element and must execute
// nothing. The real process layer is mocked — a unit test must never spawn a
// shell to prove a shell is not spawned.
//
// Dimensions covered:
//   - render:      the exact argv and options handed to `execFileSync`
//   - behavior:    hostile values survive verbatim; no command string is built
//   - integration: the `node:child_process` boundary is mocked; no process runs
//   - a11y:        omitted — the module returns a `GitResult`, no human surface

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/commands/worktree-lease-git.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a GitResult; it emits no text or exit code' }]
);

/**
 * Typed as function types rather than as inline implementations: the call
 * arguments are asserted below, so the mock must keep its parameter types, but
 * an implementation that never reads them would only raise
 * `@typescript-eslint/no-unused-vars` on every baseline regeneration.
 */
type ExecFileSyncCall = (file: string, args: readonly string[], options: unknown) => string;
type ExecSyncCall = (command: string, options?: unknown) => string;

const mocks = vi.hoisted(() => ({
  execFileSync: vi.fn<ExecFileSyncCall>(() => ''),
  execSync: vi.fn<ExecSyncCall>(() => '')
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
  execSync: mocks.execSync
}));

import { runGitCli } from '~/src/cli/commands/worktree-lease-git.js';

const CWD = '/repo';

/** Every shell metacharacter the old command-string build turned into syntax. */
const HOSTILE_BRANCH = 'peaks/x" & echo pwned > pwned.txt & echo "$(id)`whoami`';

describe('Scenario: render — the argv and options handed to the process layer', () => {
  beforeEach(() => {
    mocks.execFileSync.mockClear();
    mocks.execSync.mockClear();
  });

  it('when git is invoked, should hand execFileSync the literal "git" file and the argv array', () => {
    // given: the argv the package builds for a worktree add
    // when: the adapter runs it
    // then: the file is bare `git` and the arguments are the SAME array
    const argv = ['worktree', 'add', '/repo/.worktrees/ab12', '-b', 'peaks/rid-1'];
    runGitCli(argv, { cwd: CWD });
    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    const [file, args, options] = mocks.execFileSync.mock.calls[0] ?? [];
    expect(file).toBe('git');
    expect(args).toEqual(argv);
    expect(options).toEqual({
      cwd: CWD,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true
    });
  });

  it('when the call succeeds, should return the captured stdout as ok', () => {
    // given: the process layer answers with some output
    // when: the adapter runs the call
    // then: the stdout is returned unchanged
    mocks.execFileSync.mockReturnValueOnce('Preparing worktree\n');
    expect(runGitCli(['worktree', 'prune'], { cwd: CWD })).toEqual({
      ok: true,
      stdout: 'Preparing worktree\n'
    });
  });
});

describe('Scenario: behavior — a hostile branch is an argument, not syntax', () => {
  beforeEach(() => {
    mocks.execFileSync.mockClear();
    mocks.execSync.mockClear();
  });

  it('when a branch contains a quote, $(…) and a backtick, should keep it as ONE argv element', () => {
    // given: the branch value the audit used as its counter-example
    // when: the adapter runs it
    // then: the branch is one element, byte-for-byte, at its own position
    const argv = ['worktree', 'add', '/repo/.worktrees/ab12', '-b', HOSTILE_BRANCH];
    runGitCli(argv, { cwd: CWD });
    const [, args] = mocks.execFileSync.mock.calls[0] ?? [];
    expect(args).toEqual(argv);
    expect(args).toHaveLength(5);
    expect(args?.[4]).toBe(HOSTILE_BRANCH);
  });

  it('when the call is made, should never build a command string or use a shell', () => {
    // given: the same call
    // when: the process layer is inspected
    // then: the first argument is the executable name, nothing is string-joined,
    //   and no `shell` option was passed to a string-taking API
    runGitCli(['worktree', 'add', '/repo/.worktrees/ab12', '-b', HOSTILE_BRANCH], { cwd: CWD });
    const [file, args, options] = mocks.execFileSync.mock.calls[0] ?? [];
    expect(typeof file).toBe('string');
    expect(file).not.toContain(' ');
    expect(Array.isArray(args)).toBe(true);
    expect(options).not.toHaveProperty('shell');
    expect(mocks.execSync).not.toHaveBeenCalled();
  });

  it('when a path contains spaces, should keep it whole rather than splitting on them', () => {
    // given: a worktree path with a space in it
    // when: the adapter runs it
    // then: it is one element, not two
    const argv = ['worktree', 'remove', '--force', '/repo/.worktrees/has space/ab12'];
    runGitCli(argv, { cwd: CWD });
    const [, args] = mocks.execFileSync.mock.calls[0] ?? [];
    expect(args).toEqual(argv);
    expect(args).toHaveLength(4);
  });
});

describe('Scenario: integration — the child-process boundary', () => {
  beforeEach(() => {
    mocks.execFileSync.mockClear();
    mocks.execSync.mockClear();
  });

  it('when the process layer fails, should let the failure propagate to the caller', () => {
    // given: execFileSync throwing the way a non-zero git exit does
    // when: the adapter runs a call that fails
    // then: the error reaches the caller unchanged — the package decides
    //   whether a failed call is fatal (`addWorktree`) or best-effort (`prune`)
    mocks.execFileSync.mockImplementationOnce(() => {
      throw new Error('Command failed: git worktree add /repo/.worktrees/ab12 -b peaks/rid-1');
    });
    expect(() =>
      runGitCli(['worktree', 'add', '/repo/.worktrees/ab12', '-b', 'peaks/rid-1'], { cwd: CWD })
    ).toThrow('Command failed: git worktree add /repo/.worktrees/ab12 -b peaks/rid-1');
  });
});
