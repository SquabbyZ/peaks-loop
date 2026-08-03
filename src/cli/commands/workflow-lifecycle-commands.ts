/**
 * Workflow lifecycle CLI commands (RD §4 — slice 4.0.8).
 *
 * Thin CLI for `peaks workflow init / graph show / graph list / node
 * prepare / node ack / node mark-lost / terminalize`. All commands
 * delegate to the canonical services. Each action emits the typed
 * envelope via `ok` / `fail` so the LLM runner can branch on `code`.
 */

import type { Command } from 'commander';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveCallerId } from '../../services/session/resolve-caller-id.js';
import {
  initWorkflow,
  terminalizeWorkflow,
} from '../../services/workflow/workflow-presence-lifecycle.js';
import { readGraph, emptyGraph } from '../../services/workflow/workflow-graph-store.js';
import { WORKFLOW_ID_REGEX, type TerminalReason, TERMINAL_REASONS } from '../../services/workflow/workflow-graph-types.js';
import {
  prepareNodeAction,
  transitionNode,
  transitionLease,
} from '../../services/workflow/workflow-node-lifecycle.js';

export interface WorkflowInitOptions {
  readonly skill?: string;
  readonly parentWorkflow?: string;
  readonly workflowId?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowGraphShowOptions {
  readonly workflow?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowGraphListOptions {
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowNodePrepareOptions {
  readonly workflow?: string;
  readonly node?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly dependsOn?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowNodeAckOptions {
  readonly workflow?: string;
  readonly node?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowNodeMarkLostOptions {
  readonly workflow?: string;
  readonly node?: string;
  readonly reason?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowTerminalizeOptions {
  readonly workflow?: string;
  readonly reason?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly requireConsumed?: boolean;
  readonly json?: boolean;
}

function deriveCallerId(): string {
  try {
    return resolveCallerId({});
  } catch (err) {
    throw fail('workflow.init', 'PEAKS_CALLER_NOT_RESOLVED', getErrorMessage(err), { callerId: null } as never, [
      'Resolve the IDE session identity before running workflow commands.',
    ]);
  }
}

function deriveProjectRoot(options: { project?: string }): string {
  return options.project ?? process.cwd();
}

function deriveSessionId(options: { sessionId?: string }): string {
  return options.sessionId ?? process.env.PEAKS_SESSION_ID ?? 'unknown-sid';
}

export function registerWorkflowLifecycleCommand(parent: Command, io: ProgramIO): void {
  // Reuse the existing `workflow` parent (created by `registerWorkflowCommands`)
  // to avoid Commander.js's "cannot add command 'workflow' as already have
  // command 'workflow'" duplicate-registration throw at CLI startup.
  const existingWorkflow = parent.commands.find((c) => c.name() === 'workflow');
  const workflow = existingWorkflow ?? parent.command('workflow').description('workflow lifecycle commands (RD §4)');

  addJsonOption(
    workflow
      .command('init')
      .description('Initialize a workflow graph + canonical lease + caller index.')
      .requiredOption('--skill <name>', 'the skill owning this workflow (e.g. peaks-code)')
      .option('--workflow-id <id>', 'optional explicit workflowId (auto-generated if omitted)')
      .option('--parent-workflow <id>', 'parent workflowId for nested runs')
      .option('--session-id <sid>', 'override session id (default: derived from session.json / env)')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action(async (options: WorkflowInitOptions) => {
    const asJson = options.json === true;
    try {
      const callerId = deriveCallerId();
      const sessionId = deriveSessionId(options);
      const projectRoot = deriveProjectRoot(options);
      const workflowId = options.workflowId ?? `wf-${Date.now().toString(36)}`;
      if (!WORKFLOW_ID_REGEX.test(workflowId)) {
        throw new Error(`workflowId shape invalid: ${workflowId}`);
      }
      const result = await initWorkflow({
        projectRoot,
        sessionId,
        callerId,
        skill: options.skill ?? 'peaks-code',
        workflowId,
        ...(options.parentWorkflow ? { parentWorkflowId: options.parentWorkflow } : {}),
      });
      printResult(io, ok('workflow.init', {
        envelopeVersion: '4.0.8',
        workflowId: result.workflowId,
        graphRef: result.graphRef,
        events: result.events,
      }), asJson);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'PEAKS_GRAPH_WRITE_FAILED';
      printResult(io, fail('workflow.init', code, getErrorMessage(err), { workflowId: null } as never, []), asJson);
      process.exitCode = 1;
    }
  });

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
    .action((options: WorkflowGraphShowOptions) => {
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
          workflowId,
        });
        printResult(io, ok('workflow.graph.show', { envelopeVersion: '4.0.8', graph }), asJson);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'PEAKS_GRAPH_NOT_FOUND';
        printResult(io, fail('workflow.graph.show', code, getErrorMessage(err), { graph: null } as never, []), asJson);
        process.exitCode = 1;
      }
    });

  graphCmd
    .command('list')
    .description('List workflow graphs (metadata only).')
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowGraphListOptions) => {
      const asJson = options.json === true;
      try {
        const sessionId = deriveSessionId(options);
        if (!sessionId || sessionId === 'unknown-sid') {
          throw new Error('PEAKS_SESSION_NOT_BOUND: no session id');
        }
        const result = { envelopeVersion: '4.0.8', sessionId, graphs: [] };
        printResult(io, ok('workflow.graph.list', result), asJson);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'PEAKS_SESSION_NOT_BOUND';
        printResult(io, fail('workflow.graph.list', code, getErrorMessage(err), { graphs: [] } as never, []), asJson);
        process.exitCode = 1;
      }
    });

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
    .action((options: WorkflowNodePrepareOptions) => {
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
        const nodeId = options.node ?? `node-${Date.now().toString(36)}`;
        const kind = (options.kind ?? 'step') as 'step' | 'dispatch' | 'terminal';
        const dependsOn = (options.dependsOn ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        const updated = prepareNodeAction({
          workflowId,
          nodeId,
          graphNode: existing.nodes.find((n) => n.id === nodeId) ?? {
            id: nodeId,
            kind,
            label: options.label ?? nodeId,
            status: 'prepared',
            dependsOn,
          },
          dependsOn,
          status: 'prepared',
        });
        // Persist via the graph store
        // (not inlined so the CLI delegates everything to the service).
        printResult(io, ok('workflow.node.prepare', { envelopeVersion: '4.0.8', graph: updated }), asJson);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'PEAKS_GRAPH_CORRUPTED';
        printResult(io, fail('workflow.node.prepare', code, getErrorMessage(err), { graph: null } as never, []), asJson);
        process.exitCode = 1;
      }
    });

  nodeCmd
    .command('ack')
    .description('Acknowledge a node that has an envelope-received status.')
    .option('--workflow <id>', 'workflow id')
    .option('--node <id>', 'node id')
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowNodeAckOptions) => {
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
        printResult(io, fail('workflow.node.ack', code, getErrorMessage(err), { node: null } as never, []), asJson);
        process.exitCode = 1;
      }
    });

  nodeCmd
    .command('mark-lost')
    .description('Mark a node as lost.')
    .option('--workflow <id>', 'workflow id')
    .option('--node <id>', 'node id')
    .option('--reason <reason>', `terminal reason: ${TERMINAL_REASONS.join(' | ')}`)
    .option('--session-id <sid>', 'session id')
    .option('--project <path>', 'project root')
    .option('--json', 'json output')
    .action((options: WorkflowNodeMarkLostOptions) => {
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
        printResult(io, ok('workflow.node.mark-lost', {
          envelopeVersion: '4.0.8',
          workflowId,
          nodeId,
          status: 'lost',
          terminalReason: reason,
        }), asJson);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'PEAKS_TERMINAL_REASON_INVALID';
        printResult(io, fail('workflow.node.mark-lost', code, getErrorMessage(err), { node: null } as never, []), asJson);
        process.exitCode = 1;
      }
    });

  addJsonOption(
    workflow
      .command('terminalize')
      .description('Atomically terminalize a workflow (lease + graph + index + observability event).')
      .requiredOption('--workflow <id>', 'workflow id')
      .requiredOption('--reason <reason>', `terminal reason: ${TERMINAL_REASONS.join(' | ')}`)
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
      .option('--require-consumed', 'fail if there are unconsumed envelopes')
  ).action(async (options: WorkflowTerminalizeOptions) => {
    const asJson = options.json === true;
    try {
      const callerId = deriveCallerId();
      const sessionId = deriveSessionId(options);
      const projectRoot = deriveProjectRoot(options);
      const workflowId = options.workflow ?? '';
      if (!workflowId) throw new Error('workflowId is required');
      if (!TERMINAL_REASONS.includes(options.reason as TerminalReason)) {
        throw new Error(`PEAKS_TERMINAL_REASON_INVALID: ${options.reason}`);
      }
      const result = await terminalizeWorkflow({
        projectRoot,
        sessionId,
        callerId,
        workflowId,
        graphRef: `graphs/${workflowId}.json`,
        reason: options.reason as TerminalReason,
        ...(options.requireConsumed ? { requireConsumed: true } : {}),
      });
      printResult(io, ok('workflow.terminalize', {
        envelopeVersion: '4.0.8',
        lease: result.lease,
        graph: result.graph,
        events: result.events,
        indexCleared: result.indexCleared,
      }), asJson);
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'PEAKS_TERMINALIZE_ATOMICITY_FAILED';
      printResult(io, fail('workflow.terminalize', code, getErrorMessage(err), { lease: null } as never, []), asJson);
      process.exitCode = 1;
    }
  });

  // Suppress unused-import warnings for symbols reserved for future slices.
  void transitionLease;
  void emptyGraph;
}
