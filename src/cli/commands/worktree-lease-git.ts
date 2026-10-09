/**
 * Best-effort `git worktree` shell helpers shared by `release` and `gc`.
 *
 * Both commands detach a worktree the same way (and `gc` additionally
 * prunes stale admin entries). Extracted verbatim from
 * `worktree-lease-commands.ts`: the commands, cwd, stdio/encoding flags
 * and the swallow-on-failure posture are unchanged.
 */

import { execSync } from 'node:child_process';

/**
 * `git worktree remove --force` is best-effort: when the path is already
 * pruned the caller still marks the lease released / gc. Returns whether
 * the git invocation failed.
 *
 * `windowsHide: true` is spelled at each call site rather than shared: the
 * guard (`tests/unit/spawn-windows-hide-guard.test.ts`) resolves a same-file
 * plain-`const` object literal and a spread of it, but not one declared
 * `as const`, frozen, `let`, or imported from another file — measured: both
 * call sites below were reported while the shared constant was `as const`.
 */
export function removeWorktreeBestEffort(projectRoot: string, wtPath: string): boolean {
  try {
    execSync(`git worktree remove --force "${wtPath}"`, {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true
    });
    return false;
  } catch {
    return true;
  }
}

/** `git worktree prune` clears stale admin entries. Best-effort. */
export function pruneWorktreesBestEffort(projectRoot: string): void {
  try {
    execSync('git worktree prune', {
      cwd: projectRoot,
      stdio: 'pipe',
      encoding: 'utf8',
      windowsHide: true
    });
  } catch {
    // ignore — prune is idempotent
  }
}
