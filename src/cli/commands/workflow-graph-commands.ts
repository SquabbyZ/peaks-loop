// src/cli/commands/workflow-graph-commands.ts
//
// `peaks workflow graph show` / `graph list` — the workflow graph read
// commands. Split out of `workflow-lifecycle-commands.ts`; both verb names,
// their options and both envelope shapes are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { readGraph } from '../../services/workflow/workflow-graph-store.js';
import { WORKFLOW_ID_REGEX } from '../../services/workflow/workflow-graph-types.js';
import {
  deriveProjectRoot,
  deriveSessionId,
  UNKNOWN_SESSION_ID,
  type WorkflowGraphListOptions,
  type WorkflowGraphShowOptions
} from './workflow-command-shared.js';

function runWorkflowGraphShow(io: ProgramIO, options: WorkflowGraphShowOptions): void {
  const asJson = options.json === true;
  try {
    const sessionId = deriveSessionId(options);
    const projectRoot = deriveProjectRoot(options);
    const workflowId = options.workflow ?? '';
    if (!workflowId || !WORKFLOW_ID_REGEX.test(workflowId)) {
      throw new Error('workflowId is required');
    }
    const graph = readGraph({
      projectRoot,
      sessionId,
      graphRef: `graphs/${workflowId}.json`,
      workflowId
    });
    printResult(io, ok('workflow.graph.show', { envelopeVersion: '4.0.8', graph }), asJson);
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_GRAPH_NOT_FOUND';
    printResult(
      io,
      fail('workflow.graph.show', code, getErrorMessage(err), { graph: null } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

function runWorkflowGraphList(io: ProgramIO, options: WorkflowGraphListOptions): void {
  const asJson = options.json === true;
  try {
    const sessionId = deriveSessionId(options);
    if (sessionId === UNKNOWN_SESSION_ID) {
      throw new Error('PEAKS_SESSION_NOT_BOUND: no session id');
    }
    const result = { envelopeVersion: '4.0.8', sessionId, graphs: [] };
    printResult(io, ok('workflow.graph.list', result), asJson);
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_SESSION_NOT_BOUND';
    printResult(
      io,
      fail('workflow.graph.list', code, getErrorMessage(err), { graphs: [] } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerWorkflowGraphCommands(workflow: Command, io: ProgramIO): void {
  // Note: `.command('graph show')` and `.command('graph list')` each
  // implicitly create a NEW `graph` parent under `workflow` in
  // Commander v12 (no auto-reuse), so calling them in sequence throws
  // "cannot add command 'graph' as already have command 'graph'" at
  // startup. Reuse the first created `graph` parent for the second
  // registration.
  const graphCmd = workflow.command('graph').description('workflow graph read commands');

  graphCmd
    .command('show')
    .description('Read a workflow graph.')
    .option('--workflow <id>', 'workflow id')
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowGraphShowOptions) => runWorkflowGraphShow(io, options));

  graphCmd
    .command('list')
    .description('List workflow graphs (metadata only).')
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowGraphListOptions) => runWorkflowGraphList(io, options));
}
