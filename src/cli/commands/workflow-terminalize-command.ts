// src/cli/commands/workflow-terminalize-command.ts
//
// `peaks workflow terminalize` — atomically terminalize a workflow (lease +
// graph + index + observability event). Split out of
// `workflow-lifecycle-commands.ts`; the verb name, its options, the
// `--require-consumed` passthrough and the envelope shape are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { terminalizeWorkflow } from '../../services/workflow/workflow-presence-lifecycle.js';
import {
  TERMINAL_REASONS,
  type TerminalReason
} from '../../services/workflow/workflow-graph-types.js';
import {
  deriveCallerId,
  deriveProjectRoot,
  deriveSessionId,
  type WorkflowTerminalizeOptions
} from './workflow-command-shared.js';

async function runWorkflowTerminalize(
  io: ProgramIO,
  options: WorkflowTerminalizeOptions
): Promise<void> {
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
      ...(options.requireConsumed ? { requireConsumed: true } : {})
    });
    printResult(
      io,
      ok('workflow.terminalize', {
        envelopeVersion: '4.0.8',
        lease: result.lease,
        graph: result.graph,
        events: result.events,
        indexCleared: result.indexCleared
      }),
      asJson
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_TERMINALIZE_ATOMICITY_FAILED';
    printResult(
      io,
      fail('workflow.terminalize', code, getErrorMessage(err), { lease: null } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerWorkflowTerminalizeCommand(workflow: Command, io: ProgramIO): void {
  addJsonOption(
    workflow
      .command('terminalize')
      .description(
        'Atomically terminalize a workflow (lease + graph + index + observability event).'
      )
      .requiredOption('--workflow <id>', 'workflow id')
      .requiredOption('--reason <reason>', `terminal reason: ${TERMINAL_REASONS.join(' | ')}`)
      .option('--session-id <sid>', 'session id')
      .option('--project <path>', 'project root')
      .option('--require-consumed', 'fail if there are unconsumed envelopes')
  ).action((options: WorkflowTerminalizeOptions) => runWorkflowTerminalize(io, options));
}
