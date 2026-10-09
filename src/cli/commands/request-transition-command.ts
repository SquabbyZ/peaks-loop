// Split out of `request-commands.ts`:
// `peaks request transition`. The action was 357 code lines with a complexity
// of 51; the preflight refusals, the two boundary hooks and the typed failure
// arms each live in their own module.
import type { Command } from 'commander';
import {
  transitionRequestArtifact,
  type RequestArtifactRole,
  type RequestArtifactState
} from '../../services/artifacts/request-artifact-service.js';
import { parseRole, parseStateForRole, VALID_ROLES } from './request-format-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestTransitionOptions } from './request-command-options.js';
import { runTransitionPreflight } from './request-transition-preflight.js';
import { reportTransitionFailure } from './request-transition-failures.js';
import {
  buildPrdHandoffResult,
  collectQaHandoffHooks,
  preCompactNote,
  type TransitionHooks,
  type TransitionResult
} from './request-transition-hooks.js';

const TRANSITION_DESCRIPTION =
  'Move a per-request artifact to a new state defined by its role state machine';
const TRANSITION_REQUEST_ID_HELP = 'request id, e.g. 2026-05-23-add-foo';
const TRANSITION_STATE_HELP = 'new state name; allowed values depend on role';
const TRANSITION_PROJECT_HELP = 'target project root';
const TRANSITION_SESSION_HELP = 'restrict to a specific session id';
const TRANSITION_REASON_HELP =
  'reason appended as a transition note; required when --allow-incomplete is set';
const TRANSITION_ALLOW_INCOMPLETE_HELP =
  'bypass artifact prerequisite checks; requires --reason and records the bypass in the artifact';
const TRANSITION_CONFIRM_HELP = 'skip the confirmation gate (for non-interactive / LLM contexts)';
const TRANSITION_FORCE_CONFIRM_HELP = 'bypass mode-enforced confirmation (use with caution)';

function buildTransitionOptions(
  requestId: string,
  role: RequestArtifactRole,
  newState: RequestArtifactState,
  options: RequestTransitionOptions
): Parameters<typeof transitionRequestArtifact>[0] {
  const transitionOptions: Parameters<typeof transitionRequestArtifact>[0] = {
    role,
    requestId,
    projectRoot: options.project,
    newState
  };
  if (options.sessionId !== undefined) {
    transitionOptions.sessionId = options.sessionId;
  }
  if (options.reason !== undefined) {
    transitionOptions.reason = options.reason;
  }
  if (options.allowIncomplete === true) {
    transitionOptions.allowIncomplete = true;
  }
  if (options.confirm === true) {
    transitionOptions.confirmed = true;
  }
  if (options.forceConfirm === true) {
    transitionOptions.forceConfirm = true;
  }
  return transitionOptions;
}

/** Type sanity check for PRD handoff. */
async function applyPrdTypeSanityCheck(
  transitionOptions: Parameters<typeof transitionRequestArtifact>[0],
  requestId: string,
  options: RequestTransitionOptions
): Promise<void> {
  if (!(transitionOptions.role === 'prd' && transitionOptions.newState === 'handed-off')) return;
  const { showRequestArtifact: showForType } =
    await import('../../services/artifacts/request-artifact-service.js');
  const showTypeOptions: {
    projectRoot: string;
    role: 'prd';
    requestId: string;
    sessionId?: string;
  } = {
    projectRoot: options.project,
    role: 'prd',
    requestId
  };
  if (options.sessionId !== undefined) {
    showTypeOptions.sessionId = options.sessionId;
  }
  const existing = await showForType(showTypeOptions);
  if (existing !== null) {
    transitionOptions.typeSanityCheck = {
      projectRoot: options.project,
      declaredType: existing.requestType
    };
  }
}

function failTransitionNotFound(
  io: ProgramIO,
  options: RequestTransitionOptions,
  role: RequestArtifactRole,
  requestId: string
): void {
  printResult(
    io,
    fail(
      'request.transition',
      'REQUEST_NOT_FOUND',
      `No artifact found for role=${role} requestId=${requestId}`,
      { role, requestId },
      ['Verify the request id, role, and session id']
    ),
    options.json
  );
  process.exitCode = 1;
}

function printTransitionResult(
  io: ProgramIO,
  options: RequestTransitionOptions,
  result: TransitionResult,
  hooks: TransitionHooks
): void {
  const note = preCompactNote(hooks.preCompact);
  printResult(
    io,
    ok(
      'request.transition',
      {
        ...result,
        preCompactCheckpoint: hooks.preCompact?.data ?? null,
        codegraphRefresh: hooks.codegraphRefresh
      },
      [
        ...(note === null ? [] : [note]),
        ...(hooks.codegraphWarning === null ? [] : [hooks.codegraphWarning])
      ]
    ),
    options.json
  );
}

async function runRequestTransition(
  requestId: string,
  options: RequestTransitionOptions,
  io: ProgramIO
): Promise<void> {
  try {
    const role = options.role;
    const newState = parseStateForRole(role, options.state);
    const preflight = await runTransitionPreflight(io, requestId, role, options);
    if (!preflight.proceed) return;
    const transitionOptions = buildTransitionOptions(requestId, role, newState, options);
    await applyPrdTypeSanityCheck(transitionOptions, requestId, options);
    const result = await transitionRequestArtifact(transitionOptions);
    if (result === null) {
      failTransitionNotFound(io, options, role, requestId);
      return;
    }
    const hooks = await collectQaHandoffHooks(role, newState, result.sessionId, options.project);
    const handoff = await buildPrdHandoffResult({
      role,
      newState,
      requestId,
      options,
      result
    });
    if (handoff !== null) {
      printResult(io, handoff, options.json);
      return;
    }
    printTransitionResult(io, options, result, hooks);
  } catch (error) {
    reportTransitionFailure(io, options, requestId, error);
  }
}

export function registerRequestTransitionCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('transition')
      .description(TRANSITION_DESCRIPTION)
      .argument('<request-id>', TRANSITION_REQUEST_ID_HELP)
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--state <state>', TRANSITION_STATE_HELP)
      .requiredOption('--project <path>', TRANSITION_PROJECT_HELP)
      .option('--session-id <session>', TRANSITION_SESSION_HELP)
      .option('--reason <text>', TRANSITION_REASON_HELP)
      .option('--allow-incomplete', TRANSITION_ALLOW_INCOMPLETE_HELP)
      .option('--confirm', TRANSITION_CONFIRM_HELP)
      .option('--force-confirm', TRANSITION_FORCE_CONFIRM_HELP)
  ).action((requestId: string, options: RequestTransitionOptions) =>
    runRequestTransition(requestId, options, io)
  );
}
