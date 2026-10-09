// src/cli/commands/workflow-node-commands.ts
//
// `peaks workflow node prepare` / `node ack` / `node mark-lost` — the workflow
// node lifecycle verbs. Split out of `workflow-lifecycle-commands.ts`; every
// verb name, option and envelope shape is unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { readGraph } from '../../services/workflow/workflow-graph-store.js';
import {
  prepareNodeAction,
  transitionNode
} from '../../services/workflow/workflow-node-lifecycle.js';
import {
  TERMINAL_REASONS,
  WORKFLOW_ID_REGEX,
  type TerminalReason
} from '../../services/workflow/workflow-graph-types.js';
import {
  deriveProjectRoot,
  deriveSessionId,
  GENERATED_ID_RADIX,
  type WorkflowNodeAckOptions,
  type WorkflowNodeMarkLostOptions,
  type WorkflowNodePrepareOptions
} from './workflow-command-shared.js';

type WorkflowGraph = ReturnType<typeof readGraph>;

/** The comma-separated `--depends-on` list, trimmed, with empties removed. */
function parseDependsOn(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** What a `prepare` asks for, gathered so the lookup stays one argument. */
type PrepareRequest = {
  nodeId: string;
  kind: 'step' | 'dispatch' | 'terminal';
  label: string | undefined;
  dependsOn: string[];
};

/** The node this `prepare` acts on: the one already in the graph, or the new default. */
function prepareGraphNode(
  existing: WorkflowGraph,
  request: PrepareRequest
): WorkflowGraph['nodes'][number] {
  return (
    existing.nodes.find((n) => n.id === request.nodeId) ?? {
      id: request.nodeId,
      kind: request.kind,
      label: request.label ?? request.nodeId,
      status: 'prepared',
      dependsOn: request.dependsOn
    }
  );
}

function runWorkflowNodePrepare(io: ProgramIO, options: WorkflowNodePrepareOptions): void {
  const asJson = options.json === true;
  try {
    const sessionId = deriveSessionId(options);
    const projectRoot = deriveProjectRoot(options);
    const workflowId = options.workflow ?? '';
    if (!workflowId || !WORKFLOW_ID_REGEX.test(workflowId)) {
      throw new Error('workflowId is required');
    }
    const graphRef = `graphs/${workflowId}.json`;
    const existing = readGraph({ projectRoot, sessionId, graphRef, workflowId });
    const nodeId = options.node ?? `node-${Date.now().toString(GENERATED_ID_RADIX)}`;
    const kind = (options.kind ?? 'step') as 'step' | 'dispatch' | 'terminal';
    const dependsOn = parseDependsOn(options.dependsOn);
    const updated = prepareNodeAction({
      workflowId,
      nodeId,
      graphNode: prepareGraphNode(existing, {
        nodeId,
        kind,
        label: options.label,
        dependsOn
      }),
      dependsOn,
      status: 'prepared'
    });
    // Persist via the graph store
    // (not inlined so the CLI delegates everything to the service).
    printResult(
      io,
      ok('workflow.node.prepare', { envelopeVersion: '4.0.8', graph: updated }),
      asJson
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_GRAPH_CORRUPTED';
    printResult(
      io,
      fail('workflow.node.prepare', code, getErrorMessage(err), { graph: null } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

function runWorkflowNodeAck(io: ProgramIO, options: WorkflowNodeAckOptions): void {
  const asJson = options.json === true;
  try {
    const sessionId = deriveSessionId(options);
    const projectRoot = deriveProjectRoot(options);
    const workflowId = options.workflow ?? '';
    if (!workflowId) throw new Error('workflowId is required');
    const graphRef = `graphs/${workflowId}.json`;
    const graph = readGraph({ projectRoot, sessionId, graphRef, workflowId });
    const nodeId = options.node ?? '';
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`node ${nodeId} not found`);
    if (node.status !== 'envelope-received') {
      throw new Error('PEAKS_ENVELOPE_NOT_RECEIVED: node is not envelope-received');
    }
    const updated = transitionNode(node.status, 'consumed-by-parent', { graphNode: node });
    printResult(io, ok('workflow.node.ack', { envelopeVersion: '4.0.8', node: updated }), asJson);
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_ENVELOPE_NOT_RECEIVED';
    printResult(
      io,
      fail('workflow.node.ack', code, getErrorMessage(err), { node: null } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

function runWorkflowNodeMarkLost(io: ProgramIO, options: WorkflowNodeMarkLostOptions): void {
  const asJson = options.json === true;
  try {
    const workflowId = options.workflow ?? '';
    if (!workflowId) throw new Error('workflowId is required');
    const nodeId = options.node ?? '';
    if (!nodeId) throw new Error('nodeId is required');
    const reason = options.reason ?? 'unknown';
    if (!TERMINAL_REASONS.includes(reason as TerminalReason)) {
      throw new Error(`PEAKS_TERMINAL_REASON_INVALID: ${reason}`);
    }
    printResult(
      io,
      ok('workflow.node.mark-lost', {
        envelopeVersion: '4.0.8',
        workflowId,
        nodeId,
        status: 'lost',
        terminalReason: reason
      }),
      asJson
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_TERMINAL_REASON_INVALID';
    printResult(
      io,
      fail('workflow.node.mark-lost', code, getErrorMessage(err), { node: null } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerWorkflowNodeCommands(workflow: Command, io: ProgramIO): void {
  // Reuse one `node` parent for prepare / ack / mark-lost (Commander v12
  // creates a NEW parent per `.command('node X')` call, so we must
  // explicitly create the parent first to avoid duplicate-registration).
  const nodeCmd = workflow.command('node').description('workflow node commands');

  nodeCmd
    .command('prepare')
    .description('Prepare a node in a workflow graph.')
    .option('--workflow <id>', 'workflow id')
    .option('--node <id>', 'node id')
    .option('--kind <k>', 'node kind: step | dispatch | terminal')
    .option('--label <text>', 'human-readable label')
    .option('--depends-on <ids>', 'comma-separated list of dependency node ids')
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowNodePrepareOptions) => runWorkflowNodePrepare(io, options));

  nodeCmd
    .command('ack')
    .description('Acknowledge a node that has an envelope-received status.')
    .option('--workflow <id>', 'workflow id')
    .option('--node <id>', 'node id')
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowNodeAckOptions) => runWorkflowNodeAck(io, options));

  nodeCmd
    .command('mark-lost')
    .description('Mark a node as lost.')
    .option('--workflow <id>', 'workflow id')
    .option('--node <id>', 'node id')
    .option('--reason <reason>', `terminal reason: ${TERMINAL_REASONS.join(' | ')}`)
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowNodeMarkLostOptions) => runWorkflowNodeMarkLost(io, options));
}
