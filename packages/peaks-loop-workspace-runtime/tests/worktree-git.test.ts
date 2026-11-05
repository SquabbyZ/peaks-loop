import { describe, expect, it } from 'vitest';

import {
  addWorktree,
  pruneWorktreesBestEffort,
  removeWorktreeBestEffort,
  type GitResult,
  type RunGit
} from '../src/worktree/git.js';

type Recorded = { readonly argv: readonly string[]; readonly cwd: string };

/**
 * The only channel these functions have. A call that reaches this recorder
 * cannot also have reached a process: the recorder is the entire `runGit`
 * surface the module is given, and the module imports nothing that could spawn.
 */
function recordingRunGit(result: GitResult = { ok: true, stdout: '' }): {
  calls: Recorded[];
  runGit: RunGit;
} {
  const calls: Recorded[] = [];
  const runGit: RunGit = (argv, opts) => {
    calls.push({ argv, cwd: opts.cwd });
    return result;
  };
  return { calls, runGit };
}

const PROJECT_ROOT = '/work/project';
const WORKTREE = '/work/project/.runtime/wt-1';

describe('addWorktree', () => {
  it('when the runner reports success, should pass the add argv and the project cwd', () => {
    // given:
    const git = recordingRunGit();
    // when:
    addWorktree(git.runGit, PROJECT_ROOT, WORKTREE, 'branch-1');
    // then:
    expect(git.calls).toEqual([
      { argv: ['worktree', 'add', WORKTREE, '-b', 'branch-1'], cwd: PROJECT_ROOT }
    ]);
  });

  it('when the runner reports failure, should throw with the runner stderr', () => {
    // given:
    const git = recordingRunGit({ ok: false, stdout: '', stderr: 'fatal: already exists' });
    // when:
    const run = (): void => addWorktree(git.runGit, PROJECT_ROOT, WORKTREE, 'branch-1');
    // then:
    expect(run).toThrowError(/git worktree add failed: fatal: already exists/);
  });
});

describe('removeWorktreeBestEffort', () => {
  it('when the remove succeeds, should report no failure', () => {
    // given:
    const git = recordingRunGit();
    // when:
    const failed = removeWorktreeBestEffort(git.runGit, PROJECT_ROOT, WORKTREE);
    // then:
    expect(git.calls).toEqual([
      { argv: ['worktree', 'remove', '--force', WORKTREE], cwd: PROJECT_ROOT }
    ]);
    expect(failed).toBe(false);
  });

  it('when the remove fails, should report the failure instead of throwing', () => {
    // given:
    const git = recordingRunGit({ ok: false, stdout: '', stderr: 'fatal: not a worktree' });
    // when:
    const failed = removeWorktreeBestEffort(git.runGit, PROJECT_ROOT, WORKTREE);
    // then:
    expect(failed).toBe(true);
  });

  it('when the runner throws, should report the failure instead of throwing', () => {
    // given:
    const runGit: RunGit = () => {
      throw new Error('spawn failed');
    };
    // when:
    const failed = removeWorktreeBestEffort(runGit, PROJECT_ROOT, WORKTREE);
    // then:
    expect(failed).toBe(true);
  });
});

describe('pruneWorktreesBestEffort', () => {
  it('when pruning, should pass the prune argv and the project cwd', () => {
    // given:
    const git = recordingRunGit();
    // when:
    pruneWorktreesBestEffort(git.runGit, PROJECT_ROOT);
    // then:
    expect(git.calls).toEqual([{ argv: ['worktree', 'prune'], cwd: PROJECT_ROOT }]);
  });

  it('when the runner throws, should swallow the failure', () => {
    // given:
    const runGit: RunGit = () => {
      throw new Error('spawn failed');
    };
    // when:
    const run = (): void => pruneWorktreesBestEffort(runGit, PROJECT_ROOT);
    // then:
    expect(run).not.toThrow();
  });
});
