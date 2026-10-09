/**
 * `peaks audit goal` runner — the peaks-audit entry gate.
 *
 * The action body moved out of `audit-commands.ts` verbatim; the registrar now
 * only wires the command and delegates. This is the one action whose delegate
 * returns a promise, so the runner stays `async` (it awaits `auditGoal()`).
 *
 * `anthropic` is the default and reads the session's own environment
 * (see `resolveAnthropicConfig`). `stub` stays for CI/tests but is
 * reported as a scaffold, and a missing credential fails loudly — a silent
 * fall back to the scaffold envelope would leave the gate exactly as fake
 * as it was before this slice.
 */

import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import {
  auditGoal,
  IncompleteAuditError,
  type LlmRunner
} from '../../services/audit/audit-goal-service.js';
import {
  createAnthropicRunner,
  LlmBindingError,
  LlmRequestError,
  resolveAnthropicConfig
} from '../../services/llm/anthropic-runner.js';
import { createStubRunner } from '../../services/llm/stub-runner.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  DEFAULT_LLM_PROVIDER,
  isSupportedLlmProvider,
  PROJECT_PATH_HINT,
  SUPPORTED_LLM_PROVIDERS,
  validateProjectRoot,
  type AuditGoalData,
  type AuditGoalOptions
} from './audit-command-shared.js';
import { auditGoalFailureData } from './audit-refusal-data.js';

export const AUDIT_GOAL_DESCRIPTION =
  'Audit a human need across 6 dimensions and propose a goal (peaks-audit primitive)';

/** The slice-owned error codes are carried verbatim so callers can gate on them. */
function auditGoalErrorCode(error: unknown): string {
  if (
    error instanceof IncompleteAuditError ||
    error instanceof LlmBindingError ||
    error instanceof LlmRequestError
  ) {
    return error.code;
  }
  return 'AUDIT_GOAL_FAILED';
}

function auditGoalNextActions(code: string): string[] {
  switch (code) {
    case 'LLM_CREDENTIAL_MISSING':
      return [
        'Export ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) in the environment that launches peaks, then re-run.',
        'For an offline scaffold instead of an audit, re-run with `--llm-provider stub` — it performs NO audit.'
      ];
    case 'LLM_MODEL_MISSING':
      return [
        'Export ANTHROPIC_MODEL (or CLAUDE_CODE_SUBAGENT_MODEL) in the environment that launches peaks, then re-run.'
      ];
    case 'INCOMPLETE_AUDIT':
      return [
        'The LLM reply omitted a required dimension; re-run so autonomous work never proceeds on a partial audit.'
      ];
    default:
      return ['Inspect the failure above, then re-run with the same --need.'];
  }
}

function unsupportedProviderEnvelope(
  options: AuditGoalOptions,
  projectRoot: string,
  provider: string
): ResultEnvelope<AuditGoalData> {
  return fail<AuditGoalData>(
    'audit.goal',
    'LLM_PROVIDER_NOT_IMPLEMENTED',
    `LLM provider "${provider}" is not implemented. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}.`,
    auditGoalFailureData(options.need, projectRoot),
    [
      `Re-run with \`--llm-provider ${DEFAULT_LLM_PROVIDER}\` for a real audit, or \`--llm-provider stub\` for an offline scaffold.`
    ]
  );
}

/** Bind the provider, run the audit, and print the success envelope. */
async function runBoundAudit(
  options: AuditGoalOptions,
  projectRoot: string,
  isStub: boolean,
  io: ProgramIO
): Promise<void> {
  const providerBinding: AuditGoalData['providerBinding'] = isStub
    ? 'stub'
    : 'anthropic-messages-api';
  let model: string | undefined;
  let llmRunner: LlmRunner;
  if (isStub) {
    llmRunner = createStubRunner();
  } else {
    const config = resolveAnthropicConfig();
    model = config.model;
    llmRunner = createAnthropicRunner(config);
  }

  const result = await auditGoal({ need: options.need }, llmRunner);
  const data: AuditGoalData = {
    status: isStub ? 'scaffold-only' : 'audit-complete',
    providerBinding,
    need: options.need,
    projectRoot,
    result,
    ...(model === undefined ? {} : { model })
  };
  const envelope: ResultEnvelope<AuditGoalData> = ok(
    'audit.goal',
    data,
    [],
    isStub
      ? [
          `Stub provider: the 6 dimensions below are placeholders, not findings. Re-run with \`--llm-provider ${DEFAULT_LLM_PROVIDER}\` for a real audit.`
        ]
      : [`Audit produced by ${providerBinding}${model === undefined ? '' : ` (model: ${model})`}.`]
  );
  printResult(io, envelope, options.json);
}

function goalErrorEnvelope(
  options: AuditGoalOptions,
  projectRoot: string,
  isStub: boolean,
  error: unknown
): ResultEnvelope<AuditGoalData> {
  const code = auditGoalErrorCode(error);
  const providerBinding: AuditGoalData['providerBinding'] = isStub
    ? 'stub'
    : 'anthropic-messages-api';
  return fail<AuditGoalData>(
    'audit.goal',
    code,
    getErrorMessage(error),
    auditGoalFailureData(
      options.need,
      projectRoot,
      providerBinding,
      error instanceof LlmBindingError ? error.missingEnv : undefined
    ),
    auditGoalNextActions(code)
  );
}

export async function runAuditGoal(options: AuditGoalOptions, io: ProgramIO): Promise<void> {
  const validation = validateProjectRoot(options.project);
  if (!validation.ok) {
    printResult(
      io,
      fail<AuditGoalData>(
        'audit.goal',
        validation.code,
        validation.message,
        auditGoalFailureData(options.need, options.project),
        [PROJECT_PATH_HINT]
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  const provider = options.llmProvider ?? DEFAULT_LLM_PROVIDER;
  if (!isSupportedLlmProvider(provider)) {
    printResult(
      io,
      unsupportedProviderEnvelope(options, validation.projectRoot, provider),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  const isStub = provider === 'stub';
  try {
    await runBoundAudit(options, validation.projectRoot, isStub, io);
  } catch (error) {
    printResult(
      io,
      goalErrorEnvelope(options, validation.projectRoot, isStub, error),
      options.json
    );
    process.exitCode = 1;
  }
}
