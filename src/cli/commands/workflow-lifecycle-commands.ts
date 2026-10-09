/**
 * Workflow lifecycle CLI commands (RD §4 — slice 4.0.8).
 *
 * Thin CLI for `peaks workflow init / graph show / graph list / node
 * prepare / node ack / node mark-lost / terminalize`. All commands
 * delegate to the canonical services. Each action emits the typed
 * envelope via `ok` / `fail` so the LLM runner can branch on `code`.
 *
 * The verb implementations live beside this file, one module per verb group:
 * `workflow-init-command.ts`, `workflow-graph-commands.ts`,
 * `workflow-node-commands.ts`, `workflow-terminalize-command.ts`, with the
 * option vocabulary and the caller / project / session derivation in
 * `workflow-command-shared.ts`.
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerWorkflowGraphCommands } from './workflow-graph-commands.js';
import { registerWorkflowInitCommand } from './workflow-init-command.js';
import { registerWorkflowNodeCommands } from './workflow-node-commands.js';
import { registerWorkflowTerminalizeCommand } from './workflow-terminalize-command.js';

export type {
  WorkflowGraphListOptions,
  WorkflowGraphShowOptions,
  WorkflowInitOptions,
  WorkflowNodeAckOptions,
  WorkflowNodeMarkLostOptions,
  WorkflowNodePrepareOptions,
  WorkflowTerminalizeOptions
} from './workflow-command-shared.js';

export { UNKNOWN_SESSION_ID } from './workflow-command-shared.js';

export function registerWorkflowLifecycleCommand(parent: Command, io: ProgramIO): void {
  // Reuse the existing `workflow` parent (created by `registerWorkflowCommands`)
  // to avoid Commander.js's "cannot add command 'workflow' as already have
  // command 'workflow'" duplicate-registration throw at CLI startup.
  const existingWorkflow = parent.commands.find((c) => c.name() === 'workflow');
  const workflow =
    existingWorkflow ??
    parent.command('workflow').description('workflow lifecycle commands (RD §4)');

  registerWorkflowInitCommand(workflow, io);
  registerWorkflowGraphCommands(workflow, io);
  registerWorkflowNodeCommands(workflow, io);
  registerWorkflowTerminalizeCommand(workflow, io);
}
