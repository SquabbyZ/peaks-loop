// `peaks workflow verify-pipeline` and `peaks workflow skip` — the two commands that
// decide whether a request's gates were satisfied, or recorded as deliberately skipped.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { getSessionId } from '../../services/session/session-manager.js';
import { verifyPipeline } from '../../services/workflow/pipeline-verify-service.js';
import {
  applySkip,
  detectCallerKind,
  type SkipArgs
} from '../../services/workflow/workflow-skip-service.js';

const VERIFY_PIPELINE_DESCRIPTION =
  'Verify the complete rd→qa pipeline was followed for a request. Scans the v2.17.0 canonical session-axis layout (artifacts under _runtime per-session) and falls back to the legacy v2.16.0 change-axis forms during the 1-minor-release deprecation window.';

const SKIP_DESCRIPTION =
  'Skip specific gates for a request (RD/QA). Use --dry-run to preview without writing. Allowed gate names: QA / RD (phase shortcuts) or specific gate names (rd-request-exists, prd-handoff, bug-analysis, code-review, security-review, perf-baseline, qa-request-exists, test-cases, test-report). Three rules apply: (1) only docs/config/chore slices can skip; (2) skip is one-time per rid; (3) script callers must also pass --i-have-reviewed.';

interface VerifyPipelineOpts {
  rid: string;
  project: string;
  type?: string;
  sessionId?: string;
  json?: boolean;
}

interface WorkflowSkipOpts {
  rid: string;
  project: string;
  gates: string;
  reason: string;
  dryRun?: boolean;
  iHaveReviewed?: boolean;
  json?: boolean;
}

type SkipResult = Awaited<ReturnType<typeof applySkip>>;

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
async function runVerifyPipeline(options: VerifyPipelineOpts, io: ProgramIO): Promise<void> {
  try {
    const result = await verifyPipeline({
      projectRoot: options.project,
      rid: options.rid,
      ...(options.type ? { requestType: options.type } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {})
    });
    const exitOk = result.complete ? 0 : 1;
    printResult(
      io,
      result.complete
        ? ok('workflow.verify-pipeline', result)
        : fail(
            'workflow.verify-pipeline',
            'PIPELINE_INCOMPLETE',
            `${result.violations.length} violation(s): ${result.violations.join('; ')}`,
            result,
            result.nextActions
          ),
      options.json
    );
    process.exitCode = exitOk;
  } catch (error) {
    printResult(
      io,
      fail(
        'workflow.verify-pipeline',
        'VERIFY_FAILED',
        getErrorMessage(error),
        { acceptedForm: 'none', gateC: 'fail' },
        ['Check that --project and --rid are correct.']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/** The `no peaks-code session binding` branch, lifted verbatim out of the skip action body. */
function reportSkipNoActiveSession(io: ProgramIO, options: WorkflowSkipOpts): void {
  printResult(
    io,
    fail(
      'workflow.skip',
      'NO_ACTIVE_SESSION',
      `project "${options.project}" has no peaks-code session binding; run \`peaks workspace init --project ${options.project} --json\` first`,
      { applied: false },
      [`peaks workspace init --project ${options.project} --json`]
    ),
    options.json
  );
  process.exitCode = 1;
}

/**
 * The applied / idempotent / rejected tail of the skip action, lifted verbatim
 * out of its body; it runs at the same point in the sequence and the caller
 * returns where the original returned early.
 */
function reportSkipOutcome(
  io: ProgramIO,
  options: WorkflowSkipOpts,
  sessionId: string,
  result: SkipResult
): void {
  if (result.applied) {
    printResult(
      io,
      ok(
        'workflow.skip',
        result,
        [],
        [
          `Skip applied for rid "${options.rid}": gates [${result.skippedGates.join(', ')}] marked as status: 'skipped' on next verify-pipeline.`,
          `State file: ${result.persistedTo}`,
          `Run \`peaks workflow verify-pipeline --rid ${options.rid} --project ${options.project} --session-id ${sessionId} --json\` to confirm.`
        ]
      ),
      options.json
    );
    return;
  }
  if (result.idempotent) {
    printResult(
      io,
      ok(
        'workflow.skip',
        result,
        [],
        [`Skip already applied for rid "${options.rid}"; idempotent no-op.`]
      ),
      options.json
    );
    return;
  }
  // applied:false + reason → rejection.
  printResult(
    io,
    fail('workflow.skip', 'SKIP_REJECTED', result.reason ?? 'unknown rejection', result, [
      'See RD request for the three rules: docs/config/chore only, one-time per rid, script callers need --i-have-reviewed.'
    ]),
    options.json
  );
  process.exitCode = 1;
}

/** The catch branch, lifted verbatim out of the skip action body. */
function reportSkipFailure(io: ProgramIO, error: unknown, json?: boolean): void {
  printResult(
    io,
    fail('workflow.skip', 'SKIP_FAILED', getErrorMessage(error), { applied: false }, [
      'Check that --project and --rid are correct; --reason and --gates are required.'
    ]),
    json
  );
  process.exitCode = 1;
}

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
async function runWorkflowSkip(options: WorkflowSkipOpts, io: ProgramIO): Promise<void> {
  try {
    // Resolve the session id from the project's current binding
    // (CLI is the single source of truth per the dev-preference
    // rules). The skip-state is keyed by session id, so the
    // operator's current session determines where the marker
    // lives. Auto-rotation on outer-mismatch is irrelevant here
    // because we read, not write, the binding.
    const sessionId = getSessionId(options.project);
    if (sessionId === null) {
      reportSkipNoActiveSession(io, options);
      return;
    }
    const callerKind = detectCallerKind(process.env['PEAKS_CALLER_ID']);
    const skipArgs: SkipArgs = {
      rid: options.rid,
      gatesRaw: options.gates,
      reason: options.reason,
      ...(options.dryRun === true ? { dryRun: true } : {}),
      ...(options.iHaveReviewed === true ? { iHaveReviewed: true } : {}),
      callerKind
    };
    const result = await applySkip(options.project, sessionId, skipArgs);
    reportSkipOutcome(io, options, sessionId, result);
  } catch (error) {
    reportSkipFailure(io, error, options.json);
  }
}

export function registerWorkflowGateCommands(workflow: Command, io: ProgramIO): void {
  addJsonOption(
    workflow
      .command('verify-pipeline')
      .description(VERIFY_PIPELINE_DESCRIPTION)
      .requiredOption('--rid <rid>', 'request identifier')
      .requiredOption('--project <path>', 'project root path')
      .option(
        '--type <type>',
        'request type: feature, bugfix, refactor, docs, config, chore',
        'feature'
      )
      .option(
        '--session-id <sid>',
        'slice 2026-06-13-peaks-workflow-skip: session id under which to read the skip-state file. When omitted, no skip-state is consulted (legacy behavior).'
      )
  ).action((options: VerifyPipelineOpts) => runVerifyPipeline(options, io));

  // Mark gates as bypassed for a specific rid, so the next
  // `verify-pipeline` reports them as `status: 'skipped'` instead of
  // missing-evidence violations. See RD
  // for the three-rule classifier (type allowlist, one-time
  // semantics, role-based auth).
  addJsonOption(
    workflow
      .command('skip')
      .description(SKIP_DESCRIPTION)
      .requiredOption('--rid <rid>', 'request identifier')
      .requiredOption('--project <path>', 'project root path')
      .requiredOption(
        '--gates <list>',
        'comma-separated gate names (e.g. "QA" or "QA,slice-check" or "code-review,security-review")'
      )
      .requiredOption(
        '--reason <text>',
        'free-text justification; persisted in the state file and surfaced in verify-pipeline nextActions'
      )
      .option('--dry-run', 'preview the skip; do not write the state file')
      .option(
        '--i-have-reviewed',
        'required when caller is a script (CI / postinstall / cron). LLM and human callers do not need this.'
      )
  ).action((options: WorkflowSkipOpts) => runWorkflowSkip(options, io));
}
