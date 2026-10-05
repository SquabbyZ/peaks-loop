/**
 *
 * Records (or revokes / inspects) a current-task user authorization for
 * a worktree-mutating operation. The PreToolUse gate
 * (`src/services/hooks/worktree-authorization-gate.ts`) reads the
 * resulting file before allowing `git worktree ...`, `git stash ...`,
 * or `Agent(isolation: worktree)` tool calls.
 *
 * Sub-commands:
 *   - grant   : append a one-shot (or multi-use) authorization
 *   - revoke  : remove all unconsumed grants
 *   - status  : list current grants + fingerprint
 *
 * Default TTL: 5 min, single-use. Multi-use is opt-in via --multi.
 * Default operation: `git-worktree` (the most common ask). Specify
 * `--operation agent-isolation-worktree` or `--operation git-stash-mutating`
 * when authorizing a different shape.
 *
 * This command is invoked by the LLM after the user has explicitly
 * authorized the operation in the current task. It must NOT be invoked
 * autonomously without a user prompt that names the operation. The
 * command itself does not enforce user confirmation — that is the
 * peaks-code orchestrator's responsibility (see
 * `skills/peaks-code/SKILL.md` "Worktree authorization" red line).
 */

import type { Command } from 'commander';

import { type ProgramIO } from '../cli-helpers.js';
import { registerWorktreeAuthGrantCommand } from './worktree-auth-grant-command.js';
import {
  registerWorktreeAuthReconcileCommand,
  registerWorktreeAuthRevokeCommand,
  registerWorktreeAuthStatusCommand
} from './worktree-auth-manage-commands.js';
import { registerWorktreeLeaseCommands } from './worktree-lease-commands.js';

// The grant/revoke/status/reconcile-host command builders and their
// validation/presentation helpers were extracted to
// `worktree-auth-grant-command.ts` and `worktree-auth-manage-commands.ts`
// (mechanical verbatim moves). The default TTL stays here and is passed
// into the grant builder so the two `no-magic-numbers` findings on it do
// not relocate into a sibling that must be clean outright.
const DEFAULT_TTL_MS = 5 * 60 * 1_000;

export function registerWorktreeAuthCommand(program: Command, io: ProgramIO): void {
  const auth = program
    .command('worktree')
    .description('worktree authorization gate (slice 2026-07-27-worktree-user-auth)')
    .addHelpText(
      'after',
      'Examples:\n' +
        '  peaks worktree auth grant --operation git-worktree --reason "rd sub-agent for rid-006"\n' +
        '  peaks worktree auth grant --operation agent-isolation-worktree --reason "explore worktree dispatch demo" --multi\n' +
        '  peaks worktree auth revoke\n' +
        '  peaks worktree auth status\n\n' +
        'The grant is current-task scoped: the LLM must invoke grant after the user has explicitly ' +
        'asked for the operation. The PreToolUse gate fail-closes on missing or expired grants.'
    );

  const auth_ = auth
    .command('auth')
    .description(
      'Manage worktree authorization grants (granted by the LLM after explicit user opt-in).'
    );

  registerWorktreeAuthReconcileCommand(auth, io);

  registerWorktreeAuthGrantCommand(auth_, io, DEFAULT_TTL_MS);

  registerWorktreeAuthRevokeCommand(auth_, io);

  registerWorktreeAuthStatusCommand(auth_, io);

  registerWorktreeLeaseCommands(auth, io);
}
