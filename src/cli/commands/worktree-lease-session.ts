/**
 * Session / project-root resolution shared by every `peaks worktree
 * <spawn|release|renew|list|gc|lease-status>` sub-command.
 *
 * The host policy lives here — the package reads no env, no cwd and no
 * `session.json` (S1 rule 2). `joinPathSession` is now a delegation to the
 * workspace-runtime package's `defaultStateRoot` + `sessionRuntimeDir`, the
 * single implementation shared with peaks-harness. The exported name and
 * signature are unchanged so the six commands and `worktree-lease-store.ts`
 * keep their shape.
 */

import { defaultStateRoot, sessionRuntimeDir } from 'peaks-loop-workspace-runtime';

import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

export function resolveSessionId(options: { session?: string }, projectRoot: string): string {
  if (typeof options.session === 'string' && options.session.length > 0) return options.session;
  // Reuse the same precedence as the rest of peaks: explicit --session > PEAKS_SESSION_ID > active session.json
  return process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ?? 'unknown-sid';
}

export function resolveProjectRoot(options: { project?: string }): string {
  return options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

/**
 * Resolve the per-session runtime directory.
 * The runtime tree is gitignored; the spawn CLI writes the lease file
 * under `<this>/worktree-leases/<leaseId>.json` and the worktree itself
 * under `<this>/worktrees/<leaseId>/`.
 */
export function joinPathSession(projectRoot: string, sessionId: string): string {
  return sessionRuntimeDir({ stateRoot: defaultStateRoot(projectRoot), sessionId });
}
