import { symlinkSync as nodeSymlinkSync, readlinkSync } from 'node:fs';
import { platform, type Platform } from './platform.js';

/**
 * Does this error mean "the path is legitimately absent or unreadable by us"?
 *
 * A `catch` is allowed to turn THAT class of failure into a fallback value.
 * Every other error is a bug and must propagate. Without the distinction,
 * "this catch only swallows IO errors" is a claim the code cannot keep:
 *
 *   catch (err) {
 *     if (err instanceof ReferenceError) throw err;
 *     if (err instanceof SyntaxError) throw err;
 *     return null;   // ← swallows every TypeError, every ERR_INVALID_ARG_TYPE,
 *                    //   every error a dependency throws, and calls it "IO"
 *   }
 *
 * That exact shape sat on two priority sites (`post-compact-detector`,
 * `step-08-gate`) with that exact comment. Rethrowing the two JS error
 * classes it happened to name is not the same rule as swallowing one error
 * class and rethrowing the rest — and it is the *inverted* one: the more
 * unexpected the failure, the more certainly it was swallowed.
 *
 * The set is deliberately the "miss" codes only. `EISDIR` is included because
 * reading a directory where a file was expected is indistinguishable from
 * absent to every caller here, and excluding it would turn a pre-existing
 * silent fallback into a new loud failure for no gain.
 */
export function isExpectedFsMiss(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return (
    code === 'ENOENT' ||
    code === 'ENOTDIR' ||
    code === 'EISDIR' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ELOOP' ||
    code === 'ENAMETOOLONG'
  );
}

export function getDirectoryLinkType(targetPlatform: Platform = platform): 'junction' | 'dir' {
  return targetPlatform === 'win32' ? 'junction' : 'dir';
}

export function createDirectoryLinkSync(target: string, linkPath: string): void {
  nodeSymlinkSync(target, linkPath, getDirectoryLinkType());
}

export function readDirectoryLinkTarget(linkPath: string): string | null {
  try {
    return readlinkSync(linkPath);
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}
