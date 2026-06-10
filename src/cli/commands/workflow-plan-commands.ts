/**
 * `peaks workflow plan <read|refresh|detect-trigger>` — slice 025 CLI.
 *
 * Three subcommands under the existing `peaks workflow` verb:
 * - `read <security|perf> --project <repo> --json`
 * - `refresh <security|perf> --project <repo> [--apply] --json`
 * - `detect-trigger --project <repo> --rid <rid> [--refresh] --json`
 *
 * CLI justification (per dev-preference rules):
 * - `read`           (2) JSON-gated — slice workflow reads plan hash.
 * - `refresh`        (3) destructive write needs explicit `--apply`.
 * - `detect-trigger` (2) JSON-gated — slice workflow needs the verdict.
 */
import { Command } from 'commander';
import { fail, getErrorMessage, ok } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { readPlan, type PlanType } from '../../services/workflow/plan-reader.js';
import { refreshPlan } from '../../services/workflow/plan-refresher.js';
import { detectTrigger } from '../../services/workflow/plan-trigger-detector.js';
import { getSessionId } from '../../services/session/session-manager.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

const VALID_TYPES: readonly PlanType[] = ['security', 'perf'];

// F-1 (slice 025 security): reject session ids that look like path
// traversal payloads. Canonical pattern is YYYY-MM-DD-<slug>.
const SESSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-[a-z][a-z0-9-]*[a-z0-9]$/;
// F-1 (slice 025 security): reject rids that contain path separators,
// null bytes, or traversal sequences.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlanType(value: string): value is PlanType {
  return (VALID_TYPES as readonly string[]).includes(value);
}

function isValidSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

function resolveSessionId(
  io: ProgramIO,
  command: string,
  projectRoot: string,
  explicit: string | undefined,
  asJson: boolean | undefined
): string | null {
  if (explicit !== undefined && explicit.length > 0) {
    if (!isValidSessionId(explicit)) {
      printResult(
        io,
        fail(command, 'INVALID_SESSION_ID', 'session id must match YYYY-MM-DD-slug pattern', { sessionId: explicit }, ['Use --session-id <YYYY-MM-DD-slug>']),
        asJson === true
      );
      process.exitCode = 1;
      return null;
    }
    return explicit;
  }
  const sid = getSessionId(projectRoot);
  if (sid === null || sid === undefined) {
    printResult(
      io,
      fail(command, 'NO_ACTIVE_SESSION', 'No active session — pass --session-id explicitly or run peaks workspace init', { projectRoot }, ['Run peaks workspace init or pass --session-id <YYYY-MM-DD-slug>']),
      asJson === true
    );
    process.exitCode = 1;
    return null;
  }
  // Defensive: even active-session resolution must satisfy the pattern.
  if (!isValidSessionId(sid)) {
    printResult(
      io,
      fail(command, 'INVALID_SESSION_ID', 'session id must match YYYY-MM-DD-slug pattern', { sessionId: sid }, ['Use --session-id <YYYY-MM-DD-slug>']),
      asJson === true
    );
    process.exitCode = 1;
    return null;
  }
  return sid;
}

function resolveProjectRoot(projectArg: string | undefined): string {
  if (projectArg === undefined || projectArg === '') {
    return findProjectRoot(process.cwd()) ?? process.cwd();
  }
  return projectArg;
}

function runPlanRead(io: ProgramIO, options: { type: string; project?: string; sessionId?: string; json?: boolean }): void {
  if (!isPlanType(options.type)) {
    printResult(
      io,
      fail('workflow.plan.read', 'INVALID_TYPE', `Unsupported plan type: ${options.type}`, { supportedTypes: VALID_TYPES }, ['Use --type security or --type perf']),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(io, 'workflow.plan.read', projectRoot, options.sessionId, options.json);
  if (sessionId === null) return;
  try {
    const result = readPlan({ type: options.type, project: projectRoot, sessionId });
    printResult(io, result, options.json === true);
  } catch (error) {
    printResult(io, fail('workflow.plan.read', 'READ_FAILED', getErrorMessage(error), null, ['Check that --project is a valid repo root with a peaks session']), options.json === true);
    process.exitCode = 1;
  }
}

function runPlanRefresh(io: ProgramIO, options: { type: string; project?: string; sessionId?: string; apply?: boolean; json?: boolean }): void {
  if (!isPlanType(options.type)) {
    printResult(
      io,
      fail('workflow.plan.refresh', 'INVALID_TYPE', `Unsupported plan type: ${options.type}`, { supportedTypes: VALID_TYPES }, ['Use --type security or --type perf']),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(io, 'workflow.plan.refresh', projectRoot, options.sessionId, options.json);
  if (sessionId === null) return;
  try {
    const result = refreshPlan({
      type: options.type,
      project: projectRoot,
      sessionId,
      apply: options.apply === true
    });
    printResult(io, result, options.json === true);
  } catch (error) {
    printResult(io, fail('workflow.plan.refresh', 'REFRESH_FAILED', getErrorMessage(error), null, ['Check that --project is a valid repo root and the session exists']), options.json === true);
    process.exitCode = 1;
  }
}

function runPlanDetectTrigger(io: ProgramIO, options: { project?: string; rid?: string; sessionId?: string; refresh?: boolean; json?: boolean }): void {
  if (options.rid === undefined || options.rid === '') {
    printResult(
      io,
      fail('workflow.plan.detect-trigger', 'MISSING_RID', 'Missing --rid', null, ['Pass --rid <request-id>']),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  if (!isValidRequestId(options.rid)) {
    printResult(
      io,
      fail('workflow.plan.detect-trigger', 'INVALID_RID', 'request id must match [A-Za-z0-9][A-Za-z0-9._-]*', { rid: options.rid }, ['Pass --rid <alphanumeric.request-id>']),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(io, 'workflow.plan.detect-trigger', projectRoot, options.sessionId, options.json);
  if (sessionId === null) return;
  try {
    const result = detectTrigger({
      project: projectRoot,
      rid: options.rid,
      sessionId,
      ...(options.refresh === true ? { manualOverride: true } : {})
    });
    printResult(io, result, options.json === true);
  } catch (error) {
    printResult(io, fail('workflow.plan.detect-trigger', 'DETECT_FAILED', getErrorMessage(error), null, ['Check that --project is a valid repo root and --rid is set']), options.json === true);
    process.exitCode = 1;
  }
}

export function registerWorkflowPlanCommands(program: Command, io: ProgramIO): void {
  let workflowCmd = program.commands.find((c) => c.name() === 'workflow');
  if (workflowCmd === undefined) {
    workflowCmd = program.command('workflow').description('Plan workflow routing dry-run graphs');
  }
  const plan = workflowCmd
    .command('plan')
    .description('Read, refresh, or detect-trigger for security / perf plans (slice 025)');

  addJsonOption(
    plan
      .command('read')
      .description('Read the project-level plan envelope (exists, path, hash, refreshedAt)')
      .requiredOption('--type <type>', 'plan type: security or perf')
      .option('--project <path>', 'project root', process.cwd())
      .option('--session-id <sid>', 'session id (defaults to the active session)')
  ).action((options: { type: string; project?: string; sessionId?: string; json?: boolean }) => {
    runPlanRead(io, options);
  });

  addJsonOption(
    plan
      .command('refresh')
      .description('Regenerate the plan (deterministic, idempotent; --apply to write)')
      .requiredOption('--type <type>', 'plan type: security or perf')
      .option('--project <path>', 'project root', process.cwd())
      .option('--session-id <sid>', 'session id (defaults to the active session)')
      .option('--apply', 'write the plan to disk (default is dry-run preview)')
  ).action((options: { type: string; project?: string; sessionId?: string; apply?: boolean; json?: boolean }) => {
    runPlanRefresh(io, options);
  });

  addJsonOption(
    plan
      .command('detect-trigger')
      .description('Detect whether a plan refresh is warranted for the slice diff')
      .requiredOption('--rid <rid>', 'request identifier')
      .option('--project <path>', 'project root', process.cwd())
      .option('--session-id <sid>', 'session id (defaults to the active session)')
      .option('--refresh', 'force triggered=true (manual override)')
  ).action((options: { project?: string; rid?: string; sessionId?: string; refresh?: boolean; json?: boolean }) => {
    runPlanDetectTrigger(io, options);
  });
}

// Re-export for tests that need a programmatic entry point.
export { runPlanRead as _runPlanRead };
export { runPlanRefresh as _runPlanRefresh };
export { runPlanDetectTrigger as _runPlanDetectTrigger };
