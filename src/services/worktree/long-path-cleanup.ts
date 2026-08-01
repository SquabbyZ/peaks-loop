import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

export type LongPathCleanupResult = {
  readonly removed: boolean;
  readonly strategy: 'git' | 'windows-long-path' | 'none';
  readonly error?: string;
};

export function windowsLongPath(path: string): string {
  const absolute = resolve(path);
  if (process.platform !== 'win32' || absolute.startsWith('\\\\?\\')) return absolute;
  if (absolute.startsWith('\\\\')) return `\\\\?\\UNC\\${absolute.slice(2)}`;
  return `\\\\?\\${absolute}`;
}

export function removeRegisteredWorktree(input: {
  readonly projectRoot: string;
  readonly worktreePath: string;
}): LongPathCleanupResult {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', input.worktreePath], {
      cwd: input.projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('git', ['worktree', 'prune'], { cwd: input.projectRoot, stdio: 'ignore' });
    return { removed: !existsSync(input.worktreePath), strategy: 'git' };
  } catch (error) {
    if (process.platform !== 'win32') {
      return { removed: false, strategy: 'none', error: error instanceof Error ? error.message : String(error) };
    }
    try {
      rmSync(windowsLongPath(input.worktreePath), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      execFileSync('git', ['worktree', 'prune'], { cwd: input.projectRoot, stdio: 'ignore' });
      return { removed: !existsSync(input.worktreePath), strategy: 'windows-long-path' };
    } catch (fallbackError) {
      return {
        removed: false,
        strategy: 'none',
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      };
    }
  }
}
