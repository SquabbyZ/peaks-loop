/**
 * The peaks-loop `RunGit` implementation handed to the workspace-runtime
 * package.
 *
 * `execFileSync('git', argv, …)`, not a shell command string. The package's
 * `RunGit` contract is an argv array, and the shell is what used to reinterpret
 * it: a path or branch containing `"`, `$(…)` or a backtick reached the shell
 * as syntax because this module quoted the argument by hand. No hand-rolled
 * quoting helper is provably correct for both `cmd.exe` and POSIX `sh`, so the
 * shell is gone rather than escaped.
 *
 * The `{ cwd, stdio, encoding, windowsHide }` object literal is spelled at the
 * call site on purpose: the guard in `tests/unit/spawn-windows-hide-guard.test.ts`
 * resolves an inline object literal, not one imported or declared `as const`.
 */

import { execFileSync } from 'node:child_process';
import type { RunGit } from 'peaks-loop-workspace-runtime';

export const runGitCli: RunGit = (argv, opts) => {
  const stdout = execFileSync('git', argv, {
    cwd: opts.cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    windowsHide: true
  });
  return { ok: true, stdout };
};
