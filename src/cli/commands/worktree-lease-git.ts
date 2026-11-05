/**
 * The peaks-loop `RunGit` implementation handed to the workspace-runtime
 * package.
 *
 * peaks-loop keeps its shell: every worktree call is one `execSync` command
 * string with the same `cwd`, `stdio`, `encoding` and `windowsHide` as before
 * the extraction. The package never imports `node:child_process`; it takes
 * this function as an effect (S1 rule 3).
 *
 * The argv → command-string mapping reproduces the literals this module used
 * to spell out (`git worktree add "<path>" -b "<branch>"`,
 * `git worktree remove --force "<path>"`, `git worktree prune`): the git
 * tokens of those three calls are passed through bare, and every other
 * argument — a path, a branch — is double-quoted, which is how the call sites
 * wrote them. A closed set, not a "looks like a word" heuristic: a branch
 * named `main` was quoted before and stays quoted.
 */

import { execSync } from 'node:child_process';
import type { RunGit } from 'peaks-loop-workspace-runtime';

/** Every bare token the three worktree calls pass to git. */
const BARE_GIT_ARGUMENTS: ReadonlySet<string> = new Set([
  'worktree',
  'add',
  'remove',
  'prune',
  '-b',
  '--force'
]);

export const runGitShell: RunGit = (argv, opts) => {
  const command = `git ${argv
    .map((argument) => (BARE_GIT_ARGUMENTS.has(argument) ? argument : `"${argument}"`))
    .join(' ')}`;
  // `windowsHide: true` is spelled at the call site on purpose: the guard in
  // `tests/unit/spawn-windows-hide-guard.test.ts` resolves an inline object
  // literal, not one imported or declared `as const`.
  const stdout = execSync(command, {
    cwd: opts.cwd,
    stdio: 'pipe',
    encoding: 'utf8',
    windowsHide: true
  });
  return { ok: true, stdout };
};
