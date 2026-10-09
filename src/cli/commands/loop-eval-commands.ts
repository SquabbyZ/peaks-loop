/**
 * peaks-workflow v3.0.0 — Slice A.3 + Slice B.2
 *
 * CLI surface for the workflow primitive + the loop evaluator dispatcher.
 *
 * Commands (added under the existing `peaks workflow` group and the
 * existing `peaks loop` group — never as new top-level commands, per the
 * peaks-loop add-a-new-subcommand-check-for-existing-top-level-first rule):
 *
 *   peaks workflow run <id> --session <sid> --project <repo> --json
 *   peaks workflow graph <id> --session <sid> --json   (dry-run)
 *   peaks workflow lint <id> --session <sid> --json
 *   peaks loop eval <rid> --evaluator <name> [--project <repo>] [--json]
 *   peaks loop check-monotonic <rid> --session <sid> [--json]
 *   peaks loop spec show|bootstrap|lint ...
 *   peaks loop run <rid> --session <sid> [--json]
 *
 * This module is the registrar only: each command family owns its own file, so a
 * change to one family cannot make the others harder to edit.
 */
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerWorkflowEvalWorkflowCommands } from './loop-eval-workflow-commands.js';
import { registerLoopEvalCommand } from './loop-eval-eval-command.js';
import { registerLoopCheckMonotonicCommand } from './loop-eval-monotonic-command.js';
import { registerLoopSpecCommands } from './loop-eval-spec-commands.js';
import { registerLoopSpecLintCommand } from './loop-eval-spec-lint-command.js';
import { registerLoopRunCommand } from './loop-eval-run-command.js';

export function registerWorkflowEvalCommands(program: Command, io: ProgramIO): void {
  registerWorkflowEvalWorkflowCommands(program, io);
  registerLoopEvalCommand(program, io);
  registerLoopCheckMonotonicCommand(program, io);
  registerLoopSpecCommands(program, io);
  registerLoopSpecLintCommand(program, io);
  registerLoopRunCommand(program, io);
}
