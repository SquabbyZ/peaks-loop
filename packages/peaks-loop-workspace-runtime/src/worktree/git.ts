/**
 * worktree/git — the three git calls the worktree lifecycle makes, with the
 * process itself left to the caller.
 *
 * `runGit` is a parameter. peaks-loop passes a shell-based implementation and
 * peaks-harness passes one that never touches a shell; neither choice belongs
 * in this package, and neither is made here.
 */

export interface GitResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr?: string;
}

/** Run git with `argv`, from `cwd`. The caller owns the process and its exit code. */
export type RunGit = (argv: readonly string[], opts: { readonly cwd: string }) => GitResult;

/** `git worktree add <path> -b <branch>`. Throws when the call reports failure. */
export function addWorktree(
  runGit: RunGit,
  projectRoot: string,
  wtPath: string,
  branch: string
): void {
  const result = runGit(['worktree', 'add', wtPath, '-b', branch], { cwd: projectRoot });
  if (result.ok) return;
  const detail = (result.stderr ?? '').trim() || result.stdout.trim() || '(no output)';
  throw new Error(`git worktree add failed: ${detail}`);
}

/**
 * `git worktree remove --force` is best-effort: when the path is already
 * pruned the caller still marks the lease released / gc. Returns whether the
 * git invocation failed.
 */
export function removeWorktreeBestEffort(
  runGit: RunGit,
  projectRoot: string,
  wtPath: string
): boolean {
  try {
    return !runGit(['worktree', 'remove', '--force', wtPath], { cwd: projectRoot }).ok;
  } catch {
    return true;
  }
}

/** `git worktree prune` clears stale admin entries. Best-effort. */
export function pruneWorktreesBestEffort(runGit: RunGit, projectRoot: string): void {
  try {
    runGit(['worktree', 'prune'], { cwd: projectRoot });
  } catch {
    // ignore — prune is idempotent
  }
}
