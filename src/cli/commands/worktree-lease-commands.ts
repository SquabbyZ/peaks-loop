/**
 * `peaks worktree <spawn|release|renew|list|gc|lease-status>` — lease
 * lifecycle sub-commands.
 *
 * Extracted from `worktree-auth-commands.ts` to keep that file under the
 * 800 LOC cap (mechanical verbatim move). These commands own the lease
 * lifecycle: spawn writes a lease + runs `git worktree add`; release runs
 * `git worktree remove` + transitions the lease to 'released'; renew /
 * list / gc / lease-status read and mutate the same on-disk lease store.
 * They coexist with `peaks worktree auth grant|revoke|status` (the L2 hook
 * gate surface) on the shared `peaks worktree` parent command.
 *
 * Each sub-command now lives in its own `worktree-lease-<name>-command.ts`
 * sibling (registrar + runner + helpers), with the shared pieces in
 * `worktree-lease-session.ts` (session / project-root resolution),
 * `worktree-lease-load.ts` (single-lease loader), `worktree-lease-store.ts`
 * (lease-store reader) and `worktree-lease-git.ts` (best-effort git
 * helpers). This module keeps the registration entry point and re-exports
 * the two resolvers the rest of the CLI imports from this path. Command
 * names, options, envelopes, error codes and exit codes are unchanged.
 */

import type { Command } from 'commander';

import { type ProgramIO } from '../cli-helpers.js';
import { registerWorktreeLeaseGcCommand } from './worktree-lease-gc-command.js';
import { registerWorktreeLeaseListCommand } from './worktree-lease-list-command.js';
import { registerWorktreeLeaseReleaseCommand } from './worktree-lease-release-command.js';
import { registerWorktreeLeaseRenewCommand } from './worktree-lease-renew-command.js';
import { registerWorktreeLeaseSpawnCommand } from './worktree-lease-spawn-command.js';
import { registerWorktreeLeaseStatusCommand } from './worktree-lease-status-command.js';

export { resolveProjectRoot, resolveSessionId } from './worktree-lease-session.js';

// These commands own the lease lifecycle: spawn writes a lease + runs
// `git worktree add`; release runs `git worktree remove` + transitions
// the lease to 'released'. The remaining CLI surface (renew / list / gc /
// status) ships in Part 2 along with the hook integration that consults
// the lease.
//
// Coexistence with `peaks worktree auth`: this slice does NOT delete
// `peaks worktree auth grant|revoke|status` — those are the L2 hook
// gate's existing surface and remain valid for sub-agents that have
// NOT adopted the lease contract yet. New code uses lease; old code
// uses grant; both live on the `peaks worktree` parent command.
export function registerWorktreeLeaseCommands(auth: Command, io: ProgramIO): void {
  registerWorktreeLeaseSpawnCommand(auth, io);
  registerWorktreeLeaseReleaseCommand(auth, io);

  // ─── Part 2.A: renew / list / gc / status ──────────────────────────────
  // These four commands own the rest of the lease lifecycle. The hook
  // integration (Part 2.B) and dispatch --isolation (Part 2.C) consult
  // the same on-disk lease files these commands read/write, so the
  // source-of-truth contract is preserved end-to-end.
  //
  //   renew   — extend an active lease's expiresAt
  //   list    — enumerate every lease in the session store (with filter)
  //   gc      — prune released/expired worktrees + mark leases 'gc'
  //   status  — read a single lease in detail
  registerWorktreeLeaseRenewCommand(auth, io);
  registerWorktreeLeaseListCommand(auth, io);
  registerWorktreeLeaseGcCommand(auth, io);
  registerWorktreeLeaseStatusCommand(auth, io);
}
