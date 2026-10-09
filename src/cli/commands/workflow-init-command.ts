// src/cli/commands/workflow-init-command.ts
//
// `peaks workflow init` — initialize a workflow graph + canonical lease + caller
// index. Split out of `workflow-lifecycle-commands.ts`; the verb name, its
// options, the session-binding refusal and the envelope shape are unchanged.

import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { initWorkflow } from '../../services/workflow/workflow-presence-lifecycle.js';
import { WORKFLOW_ID_REGEX } from '../../services/workflow/workflow-graph-types.js';
import {
  deriveCallerId,
  deriveProjectRoot,
  deriveSessionId,
  GENERATED_ID_RADIX,
  UNKNOWN_SESSION_ID,
  type WorkflowInitOptions
} from './workflow-command-shared.js';

/**
 * Tier 3 resolving to `unknown-sid` means NO session is bound at all. A
 * `workflow` subcommand that WRITES must fail loudly on that rather than
 * create a bucket named after a failure — `graph list` already does (see its
 * `PEAKS_SESSION_NOT_BOUND` guard); `init` did not.
 */
function buildSessionNotBoundEnvelope(
  sessionId: string,
  projectRoot: string
): ReturnType<typeof fail> {
  return fail(
    'workflow.init',
    'PEAKS_SESSION_NOT_BOUND',
    `No peaks session is bound for '${projectRoot}' (derived session id '${sessionId}'): --session-id, PEAKS_SESSION_ID and the project binding are all absent.`,
    { workflowId: null },
    [
      'Run `peaks workspace init --project <p>` to bind a session, then re-run.',
      'Or pass `--session-id <sid>` explicitly.'
    ]
  );
}

async function runWorkflowInit(io: ProgramIO, options: WorkflowInitOptions): Promise<void> {
  const asJson = options.json === true;
  try {
    const callerId = deriveCallerId();
    const projectRoot = deriveProjectRoot(options);
    const sessionId = deriveSessionId(options);
    if (sessionId === UNKNOWN_SESSION_ID) {
      printResult(io, buildSessionNotBoundEnvelope(sessionId, projectRoot), asJson);
      process.exitCode = 1;
      return;
    }
    const workflowId = options.workflowId ?? `wf-${Date.now().toString(GENERATED_ID_RADIX)}`;
    if (!WORKFLOW_ID_REGEX.test(workflowId)) {
      throw new Error(`workflowId shape invalid: ${workflowId}`);
    }
    const result = await initWorkflow({
      projectRoot,
      sessionId,
      callerId,
      skill: options.skill ?? 'peaks-code',
      workflowId,
      ...(options.parentWorkflow ? { parentWorkflowId: options.parentWorkflow } : {})
    });
    printResult(
      io,
      ok('workflow.init', {
        envelopeVersion: '4.0.8',
        workflowId: result.workflowId,
        graphRef: result.graphRef,
        events: result.events
      }),
      asJson
    );
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'PEAKS_GRAPH_WRITE_FAILED';
    printResult(
      io,
      fail('workflow.init', code, getErrorMessage(err), { workflowId: null } as never, []),
      asJson
    );
    process.exitCode = 1;
  }
}

export function registerWorkflowInitCommand(workflow: Command, io: ProgramIO): void {
  addJsonOption(
    workflow
      .command('init')
      .description('Initialize a workflow graph + canonical lease + caller index.')
      .requiredOption('--skill <name>', 'the skill owning this workflow (e.g. peaks-code)')
      .option('--workflow-id <id>', 'optional explicit workflowId (auto-generated if omitted)')
      .option('--parent-workflow <id>', 'parent workflowId for nested runs')
      .option(
        '--session-id <sid>',
        'override session id (default: derived from session.json / env)'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: WorkflowInitOptions) => runWorkflowInit(io, options));
}
