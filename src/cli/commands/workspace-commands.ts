/**
 * `peaks workspace <sub-command>` entry — thin facade.
 *
 * Slice 2026-06-16-workspace-commands-split: this file used to be 925
 * lines and bundled all 5 sub-commands (init, reconcile, migrate,
 * clean, archive). It is now a thin dispatcher that delegates each
 * sub-command to its own file under `./workspace/`. The per-subcommand
 * files own their option parsing, action handler, and JSON envelope
 * shape. The shared hooks-decision marker + prompt helpers live in
 * `./workspace/helpers.ts`.
 *
 * Re-exports `resolveFirstTimeHooksInstall` for back-compat with
 * `tests/unit/workspace-init-hooks.test.ts` (it imports from this file).
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerWorkspaceInitCommand } from './workspace/init-command.js';
import { registerWorkspaceReconcileCommand } from './workspace/reconcile-command.js';
import { registerWorkspaceMigrateCommand } from './workspace/migrate-command.js';
import { registerWorkspaceCleanCommand } from './workspace/clean-command.js';
import { registerMigrate1_4_1Command } from './migrate-1-4-1-command.js';
import { registerMigrateV2ToV11Command } from './migrate-v2-10-to-v2-11-command.js';

// Re-export for back-compat with tests that import from
// `cli/commands/workspace-commands.js`. The init sub-command's
// `resolveFirstTimeHooksInstall` is the canonical home; we re-export
// so legacy imports keep working.
export {
  resolveFirstTimeHooksInstall,
  type FirstTimeHooksInstallOutcome,
  type ResolveFirstTimeHooksInstallOptions,
} from './workspace/init-command.js';

export function registerWorkspaceCommands(program: Command, io: ProgramIO): void {
  const workspace = program
    .command('workspace')
    .description('Manage the Peaks per-session artifact workspace (.peaks/_runtime/<session-id>/)');

  registerWorkspaceInitCommand(workspace, io);
  registerWorkspaceReconcileCommand(workspace, io);
  registerWorkspaceMigrateCommand(workspace, io);
  registerWorkspaceCleanCommand(workspace, io);

  // R004: slice 0.5 → 1.4.1 migration helper (legacy `.peaks/_runtime/<sid>/<role>/`
  // → `.peaks/_runtime/<sid>/<role>/`). Idempotent; purely a UX /
  // filesystem-cleanup helper — the functional behavior is already
  // correct without it.
  registerMigrate1_4_1Command(workspace, io);

  // v2.11.0 Group E (Tier 8): 2.10.0 → 2.11.0 migration helper. Tags
  // every pre-2.11.0 session's `rd/tech-doc.md` with a YAML deprecation
  // banner pointing to the new peaks-prd handoff. Text-only — no file
  // moves. Idempotent.
  registerMigrateV2ToV11Command(workspace, io);
}
