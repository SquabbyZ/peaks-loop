/**
 * The `peaks refactor | tech | workflow | route | autonomous | swarm | recommend`
 * planning surface.
 *
 * This module is the registrar: each family owns its own file, and the two helpers
 * they share live in `workflow-plan-helpers.ts`. The `peaks workflow` parent is
 * created by the planning family and handed back, so the gate family attaches to
 * the same group instead of creating a second one.
 */
import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { registerWorkflowPlanningCommands } from './workflow-planning-commands.js';
import { registerWorkflowGateCommands } from './workflow-gate-commands.js';
import { registerWorkflowSwarmCommands } from './workflow-swarm-commands.js';

export function registerWorkflowCommands(program: Command, io: ProgramIO): void {
  const workflow = registerWorkflowPlanningCommands(program, io);
  registerWorkflowGateCommands(workflow, io);
  registerWorkflowSwarmCommands(program, io);
}
