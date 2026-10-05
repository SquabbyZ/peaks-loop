/**
 *
 * Extracted from `workflow-plan-commands.ts` (strict-remediation c1). The
 * command registration re-exports these as its programmatic test entry points.
 * Behaviour is unchanged: each command still emits its own `workflow.plan.*`
 * envelope, and session/project resolution delegates to the shared
 * `workflow-plan-commands-session` module instead of four per-command copies.
 */
import { fail, getErrorMessage } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { readPlan, type PlanType } from '../../services/workflow/plan-reader.js';
import { refreshPlan } from '../../services/workflow/plan-refresher.js';
import { detectTrigger } from '../../services/workflow/plan-trigger-detector.js';
import { resolveProjectRoot, resolveSessionId } from './workflow-plan-commands-session.js';

const VALID_TYPES: readonly PlanType[] = ['security', 'perf'];
// null bytes, or traversal sequences.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isPlanType(value: string): value is PlanType {
  return (VALID_TYPES as readonly string[]).includes(value);
}

function isValidRequestId(value: string): boolean {
  return REQUEST_ID_PATTERN.test(value);
}

export interface PlanReadOptions {
  readonly type: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface PlanRefreshOptions extends PlanReadOptions {
  readonly apply?: boolean;
}

export interface PlanDetectTriggerOptions {
  readonly project?: string;
  readonly rid?: string;
  readonly sessionId?: string;
  readonly refresh?: boolean;
  readonly json?: boolean;
}

function invalidPlanTypeResult(command: string, type: string) {
  return fail(
    command,
    'INVALID_TYPE',
    `Unsupported plan type: ${type}`,
    { supportedTypes: VALID_TYPES },
    ['Use --type security or --type perf']
  );
}

export function runPlanRead(io: ProgramIO, options: PlanReadOptions): void {
  if (!isPlanType(options.type)) {
    printResult(
      io,
      invalidPlanTypeResult('workflow.plan.read', options.type),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(
    { io, command: 'workflow.plan.read', asJson: options.json },
    projectRoot,
    options.sessionId
  );
  if (sessionId === null) return;
  try {
    const result = readPlan({ type: options.type, project: projectRoot, sessionId });
    printResult(io, result, options.json === true);
  } catch (error) {
    printResult(
      io,
      fail('workflow.plan.read', 'READ_FAILED', getErrorMessage(error), null, [
        'Check that --project is a valid repo root with a peaks session'
      ]),
      options.json === true
    );
    process.exitCode = 1;
  }
}

export function runPlanRefresh(io: ProgramIO, options: PlanRefreshOptions): void {
  if (!isPlanType(options.type)) {
    printResult(
      io,
      invalidPlanTypeResult('workflow.plan.refresh', options.type),
      options.json === true
    );
    process.exitCode = 1;
    return;
  }
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(
    { io, command: 'workflow.plan.refresh', asJson: options.json },
    projectRoot,
    options.sessionId
  );
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
    printResult(
      io,
      fail('workflow.plan.refresh', 'REFRESH_FAILED', getErrorMessage(error), null, [
        'Check that --project is a valid repo root and the session exists'
      ]),
      options.json === true
    );
    process.exitCode = 1;
  }
}

function missingRidResult(command: string) {
  return fail(command, 'MISSING_RID', 'Missing --rid', null, ['Pass --rid <request-id>']);
}

function invalidRidResult(command: string, rid: string) {
  return fail(command, 'INVALID_RID', 'request id must match [A-Za-z0-9][A-Za-z0-9._-]*', { rid }, [
    'Pass --rid <alphanumeric.request-id>'
  ]);
}

export function runPlanDetectTrigger(io: ProgramIO, options: PlanDetectTriggerOptions): void {
  const command = 'workflow.plan.detect-trigger';
  if (options.rid === undefined || options.rid === '') {
    printResult(io, missingRidResult(command), options.json === true);
    process.exitCode = 1;
    return;
  }
  if (!isValidRequestId(options.rid)) {
    printResult(io, invalidRidResult(command, options.rid), options.json === true);
    process.exitCode = 1;
    return;
  }
  const projectRoot = resolveProjectRoot(options.project);
  const sessionId = resolveSessionId(
    { io, command, asJson: options.json },
    projectRoot,
    options.sessionId
  );
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
    printResult(
      io,
      fail('workflow.plan.detect-trigger', 'DETECT_FAILED', getErrorMessage(error), null, [
        'Check that --project is a valid repo root and --rid is set'
      ]),
      options.json === true
    );
    process.exitCode = 1;
  }
}
