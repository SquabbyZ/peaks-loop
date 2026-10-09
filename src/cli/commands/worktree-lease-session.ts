/**
 * Session / project-root resolution shared by every `peaks worktree
 * <spawn|release|renew|list|gc|lease-status>` sub-command.
 *
 * Extracted verbatim from `worktree-lease-commands.ts` so each
 * `worktree-lease-<name>-command.ts` sibling can resolve the same roots
 * without importing the registrar module (the dependency direction stays
 * one-way: siblings → this module → services).
 */

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
 * Resolve the per-session runtime directory: `<projectRoot>/.peaks/_runtime/<sessionId>`.
 * The runtime tree is gitignored; the spawn CLI writes the lease file
 * under `<this>/worktree-leases/<leaseId>.json` and the worktree itself
 * under `<this>/worktrees/<leaseId>/`.
 */
export function joinPathSession(projectRoot: string, sessionId: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime/${sessionId}`;
}
