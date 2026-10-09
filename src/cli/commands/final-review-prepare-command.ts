// src/cli/commands/final-review-prepare-command.ts
//
// The body of `peaks prepare-final-review`: the two input validations, the
// audit-goal path resolution, the provider check, the stub scaffold route and
// the real-provider route. Split out of `final-review-commands.ts`; every
// envelope code, message, `data` field and next-action string is unchanged.
//
// The input validations and the `_runtime` join below live in ONE module on
// purpose: rule D is file-scoped, so a join whose id slot is checked two
// modules away is a join the guard cannot see.

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { REQUEST_ID_PATTERN } from '../../services/artifacts/request-artifact-service.js';
import {
  createAnthropicRunner,
  LlmBindingError,
  resolveAnthropicConfig
} from '../../services/llm/anthropic-runner.js';
import {
  prepareFinalReview,
  type LlmRunner
} from '../../services/final-review/final-review-service.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  DEFAULT_LLM_PROVIDER,
  isSupportedLlmProvider,
  SUPPORTED_LLM_PROVIDERS,
  type PrepareFinalReviewOptions
} from './final-review-command-shared.js';
import {
  emitPrepareFailure,
  emitReviewEnvelope,
  emitStubEnvelope,
  finalReviewErrorCode,
  finalReviewNextActions,
  type PrepareGoalPath,
  type PrepareRefusal
} from './final-review-command-envelopes.js';

/** The three values a successful resolution yields. */
type PrepareInputs = PrepareGoalPath & { readonly projectRoot: string };

function validateProjectRoot(
  projectArg: string
): { ok: true; projectRoot: string } | { ok: false; code: string; message: string } {
  const projectRoot = resolve(projectArg);
  if (!existsSync(projectRoot)) {
    return {
      ok: false,
      code: 'PROJECT_NOT_FOUND',
      message: `project path does not exist: ${projectArg}`
    };
  }
  let stat;
  try {
    stat = statSync(projectRoot);
  } catch (error) {
    return { ok: false, code: 'INVALID_PROJECT', message: getErrorMessage(error) };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      message: `project path is not a directory: ${projectArg}`
    };
  }
  return { ok: true, projectRoot };
}

/**
 * Validate the session id. Rejects empty, path-traversal (`..`), and
 * any segment separator (`/`, `\`) so the caller cannot escape
 * `.peaks/_runtime/<sessionId>/audit-goal/` via CLI flags.
 */
function validateSessionId(
  sessionId: string
): { ok: true; sessionId: string } | { ok: false; code: string; message: string } {
  if (sessionId.length === 0) {
    return {
      ok: false,
      code: 'MISSING_REQUIRED_FLAG',
      message: '`--session-id` is required and must be a non-empty string'
    };
  }
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    return {
      ok: false,
      code: 'INVALID_SESSION_ID',
      message:
        '`--session-id` must not contain path-traversal or path-separator characters (rejected: "..", "/", "\\")'
    };
  }
  return { ok: true, sessionId };
}

/** The refusal for an audit goal the pre-flight did not find on disk. */
function auditGoalMissingRefusal(
  rid: string,
  sessionId: string,
  auditGoalPath: string
): PrepareRefusal {
  return {
    rid,
    code: 'AUDIT_GOAL_NOT_FOUND',
    message: `audit-goal file not found at expected path: ${auditGoalPath}`,
    sessionId,
    auditGoalPath,
    nextActions: [
      'Run `peaks audit goal --project <path> --need <text>` first to produce the approved goal JSON.',
      'Confirm `--session-id` matches the session that wrote the goal.'
    ]
  };
}

/**
 * Resolve the audit-goal path, or the refusal that replaces it.
 *
 * The `rid` axis is checked HERE, at the join: the rid is the CLI positional
 * and it is the FILENAME segment, so the `--session-id` validation does not
 * cover it (added 2026-09-14, repair R1 — a second-slot hole, found by the
 * widened rule D rather than by a human reading the file).
 *
 * The audit-goal existence pre-flight sits here too, so the caller learns the
 * real reason its request cannot proceed BEFORE the provider check.
 */
function resolveAuditGoalPath(
  rid: string,
  options: PrepareFinalReviewOptions,
  projectRoot: string
): PrepareInputs | PrepareRefusal {
  const sessionValidation = validateSessionId(options.sessionId);
  if (!sessionValidation.ok) {
    return {
      rid,
      code: sessionValidation.code,
      message: sessionValidation.message,
      sessionId: options.sessionId,
      auditGoalPath: '',
      nextActions: [
        'Pass a non-empty `--session-id` whose value is a single segment (no "..", "/", or "\\")'
      ]
    };
  }

  if (!REQUEST_ID_PATTERN.test(rid)) {
    return {
      rid,
      code: 'RID_INVALID',
      message: `Invalid request id: ${rid} (expected letters, digits, dots, underscores, or dashes)`,
      sessionId: sessionValidation.sessionId,
      auditGoalPath: '',
      nextActions: ['Pass the rid of the slice, e.g. 2026-09-14-some-slug']
    };
  }

  const auditGoalPath = join(
    projectRoot,
    '.peaks',
    '_runtime',
    sessionValidation.sessionId,
    'audit-goal',
    `${rid}.json`
  );
  if (!existsSync(auditGoalPath)) {
    return auditGoalMissingRefusal(rid, sessionValidation.sessionId, auditGoalPath);
  }

  return { projectRoot, sessionId: sessionValidation.sessionId, auditGoalPath };
}

/** Resolve the three inputs the run needs, or the refusal that replaces them. */
function resolvePrepareInputs(
  rid: string,
  options: PrepareFinalReviewOptions
): PrepareInputs | PrepareRefusal {
  const projectValidation = validateProjectRoot(options.project);
  if (!projectValidation.ok) {
    return {
      rid,
      code: projectValidation.code,
      message: projectValidation.message,
      sessionId: options.sessionId,
      auditGoalPath: '',
      nextActions: ['Verify the project path exists and is a directory']
    };
  }
  return resolveAuditGoalPath(rid, options, projectValidation.projectRoot);
}

function isRefusal(value: PrepareInputs | PrepareRefusal): value is PrepareRefusal {
  return !('projectRoot' in value);
}

/**
 * Real provider path: bind a real `LlmRunner` and run the service.
 *
 * Binding happens INSIDE the try so an absent credential surfaces as
 * `LlmBindingError`'s own code instead of escaping as a crash. No envelope is
 * emitted on that path — a "successful" empty review would be worse than an
 * error.
 */
async function runRealReview(
  io: ProgramIO,
  rid: string,
  inputs: PrepareInputs,
  options: PrepareFinalReviewOptions
): Promise<void> {
  const { json } = options;
  try {
    const config = resolveAnthropicConfig();
    const llmRunner: LlmRunner = createAnthropicRunner(config);
    const review = await prepareFinalReview(rid, {
      projectRoot: inputs.projectRoot,
      sessionId: inputs.sessionId,
      llmRunner,
      ...(options.base === undefined ? {} : { baseRef: options.base })
    });
    emitReviewEnvelope(io, { rid, goal: inputs, model: config.model, review, json });
  } catch (error) {
    const code = finalReviewErrorCode(error);
    emitPrepareFailure(
      io,
      json,
      {
        rid,
        code,
        message: getErrorMessage(error),
        sessionId: inputs.sessionId,
        auditGoalPath: inputs.auditGoalPath,
        nextActions: finalReviewNextActions(code)
      },
      error instanceof LlmBindingError ? error.missingEnv : undefined
    );
  }
}

export async function runPrepareFinalReview(
  rid: string,
  options: PrepareFinalReviewOptions,
  io: ProgramIO
): Promise<void> {
  const inputs = resolvePrepareInputs(rid, options);
  if (isRefusal(inputs)) {
    emitPrepareFailure(io, options.json, inputs);
    return;
  }

  // Unknown provider names fail loudly — a silent fallback to `stub` would hand
  // the caller a scaffold envelope that reads as a review route, which is the
  // defect class this gate exists to stop.
  const provider = options.llmProvider ?? DEFAULT_LLM_PROVIDER;
  if (!isSupportedLlmProvider(provider)) {
    emitPrepareFailure(io, options.json, {
      rid,
      code: 'LLM_PROVIDER_NOT_IMPLEMENTED',
      message: `LLM provider "${provider}" is not implemented. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}.`,
      sessionId: inputs.sessionId,
      auditGoalPath: inputs.auditGoalPath,
      nextActions: [
        `Re-run with \`--llm-provider anthropic\` for a real 4-dim review, or \`--llm-provider ${DEFAULT_LLM_PROVIDER}\` for an offline scaffold.`
      ]
    });
    return;
  }

  if (provider === 'stub') {
    emitStubEnvelope(io, rid, inputs, options.json);
    return;
  }

  await runRealReview(io, rid, inputs, options);
}
