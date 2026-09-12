/**
 * `peaks prepare-final-review <rid>` CLI wrapper (W5 Fix M2; real provider
 * binding added by the S3 defect-remediation slice).
 *
 * Exposes the `prepareFinalReview()` service (W2 T9 on
 * `feature/slice-topology-multipass`) via the CLI surface. The service
 * depends on an injected `LlmRunner`; this file owns the binding:
 *   - `--llm-provider stub` (default) returns a structured "scaffold ready"
 *     envelope WITHOUT calling the service, so CI can verify the route
 *     offline. It performs no review, and says so in every hint it emits.
 *   - `--llm-provider anthropic` binds the real Messages-API runner
 *     (`resolveAnthropicConfig()` + `createAnthropicRunner()`) and runs the
 *     service for real, carrying the 4-dim result back in the envelope.
 *     An absent credential or model raises `LlmBindingError`, reported under
 *     its own error code — never degraded into a scaffold a caller could
 *     mistake for a review.
 * Unknown provider names still fail loudly with
 * `LLM_PROVIDER_NOT_IMPLEMENTED` rather than silently falling back to stub.
 *
 * Per the dev-preference "Default-no on new CLI commands" rule and the
 * W4 T14 spec, this is a NEW top-level command (`prepare-final-review`),
 * not a subcommand of `audit`. The two primitives are distinct:
 *   - `peaks audit goal`   — propose a 6-dim goal from a human need
 *   - `peaks prepare-final-review` — produce a 4-dim review evidence
 *                                  pack for human acceptance
 */

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import {
  createAnthropicRunner,
  LlmBindingError,
  LlmRequestError,
  resolveAnthropicConfig,
} from '../../services/llm/anthropic-runner.js';
import {
  IncompleteFinalReviewError,
  prepareFinalReview,
  type LlmRunner,
} from '../../services/final-review/final-review-service.js';
import type { FinalReviewOutput } from '../../services/final-review/final-review-types.js';

type PrepareFinalReviewOptions = {
  project: string;
  sessionId: string;
  llmProvider?: string;
  json?: boolean;
};

/** Whitelist of supported `--llm-provider` values for `peaks prepare-final-review`. */
const SUPPORTED_LLM_PROVIDERS = ['anthropic', 'stub'] as const;
type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

/**
 * Default stays `stub` (unlike `peaks audit goal`, whose default is the real
 * provider): the scaffold route is what CI and the registered e2e contract
 * exercise without credentials, and the stub envelope is labelled
 * `status: 'scaffold-only'` / `providerBinding: 'stub'` so it can never be
 * read as a review.
 */
const DEFAULT_LLM_PROVIDER: SupportedLlmProvider = 'stub';

function isSupportedLlmProvider(value: string): value is SupportedLlmProvider {
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(value);
}

export type FinalReviewStatus = 'scaffold-only' | 'review-complete' | 'not-applicable';

/**
 * Which LLM produced this envelope. `unknown` is reserved for failure
 * envelopes, where no binding was ever established.
 */
export type FinalReviewProviderBinding = 'stub' | 'anthropic-messages-api' | 'unknown';

export interface FinalReviewData {
  readonly status: FinalReviewStatus;
  readonly rid: string;
  readonly sessionId: string;
  readonly auditGoalPath: string;
  readonly serviceWired: boolean;
  readonly providerBinding: FinalReviewProviderBinding;
  /** Model id the bound provider answered with (real-provider runs only). */
  readonly model?: string;
  /** The 4-dim review the service produced (real-provider runs only). */
  readonly review?: FinalReviewOutput;
  /**
   * Environment variables that were absent when binding failed. Surfaced on
   * `data` because `fail()` redacts `message` through
   * `redactSensitiveErrorMessage`, whose catch-all pattern matches the words
   * `token` / `api_key` and would blank out the very names an operator needs.
   */
  readonly missingEnv?: readonly string[];
}

/**
 * Empty placeholder used by `fail()` envelopes. `status` is
 * `'not-applicable'` on the error path so consumers can tell
 * "this is a placeholder on a failure" apart from "this is a real
 * scaffold-only success".
 */
function emptyFinalReviewData(
  rid: string,
  sessionId: string,
  auditGoalPath: string,
  missingEnv?: readonly string[]
): FinalReviewData {
  return {
    status: 'not-applicable',
    rid,
    sessionId,
    auditGoalPath,
    serviceWired: false,
    providerBinding: 'unknown',
    ...(missingEnv === undefined ? {} : { missingEnv }),
  };
}

function validateProjectRoot(
  projectArg: string
): { ok: true; projectRoot: string } | { ok: false; code: string; message: string } {
  const projectRoot = resolve(projectArg);
  if (!existsSync(projectRoot)) {
    return {
      ok: false,
      code: 'PROJECT_NOT_FOUND',
      message: `project path does not exist: ${projectArg}`,
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
      message: `project path is not a directory: ${projectArg}`,
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
      message: '`--session-id` is required and must be a non-empty string',
    };
  }
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    return {
      ok: false,
      code: 'INVALID_SESSION_ID',
      message:
        '`--session-id` must not contain path-traversal or path-separator characters (rejected: "..", "/", "\\")',
    };
  }
  return { ok: true, sessionId };
}

export function registerFinalReviewCommands(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('prepare-final-review <rid>')
      .description(
        'Prepare the 4-dimension business review (final-review primitive) for human acceptance (W2 T9 service; CLI surface in W5 M2)'
      )
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--session-id <sid>', 'session id whose .peaks/_runtime/<sid>/audit-goal/<rid>.json is the approved goal source')
      .option(
        '--llm-provider <name>',
        `LLM provider name: ${SUPPORTED_LLM_PROVIDERS.join(' | ')} (default: ${DEFAULT_LLM_PROVIDER} — performs no review)`,
        DEFAULT_LLM_PROVIDER
      )
  ).action(async (rid: string, options: PrepareFinalReviewOptions) => {
    // 1. Project root must exist and be a directory.
    const projectValidation = validateProjectRoot(options.project);
    if (!projectValidation.ok) {
      printResult(
        io,
        fail<FinalReviewData>(
          'final-review.prepare',
          projectValidation.code,
          projectValidation.message,
          emptyFinalReviewData(rid, options.sessionId, ''),
          ['Verify the project path exists and is a directory']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // 2. Session id must be a safe single-segment string.
    const sessionValidation = validateSessionId(options.sessionId);
    if (!sessionValidation.ok) {
      printResult(
        io,
        fail<FinalReviewData>(
          'final-review.prepare',
          sessionValidation.code,
          sessionValidation.message,
          emptyFinalReviewData(rid, options.sessionId, ''),
          [
            'Pass a non-empty `--session-id` whose value is a single segment (no "..", "/", or "\\")',
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // 3. Compute the audit-goal path the service WOULD read. We do this
    //    in two places: the pre-flight existence check (here) and the
    //    stub-path envelope (below). The service computes it identically
    //    at `src/services/final-review/final-review-service.ts:45-52`.
    const auditGoalPath = join(
      projectValidation.projectRoot,
      '.peaks',
      '_runtime',
      sessionValidation.sessionId,
      'audit-goal',
      `${rid}.json`
    );

    // 4. Pre-flight: if the audit-goal file is missing, surface a 404
    //    BEFORE the stub/provider check so the caller learns the real
    //    reason their request can't proceed.
    if (!existsSync(auditGoalPath)) {
      printResult(
        io,
        fail<FinalReviewData>(
          'final-review.prepare',
          'AUDIT_GOAL_NOT_FOUND',
          `audit-goal file not found at expected path: ${auditGoalPath}`,
          emptyFinalReviewData(rid, sessionValidation.sessionId, auditGoalPath),
          [
            'Run `peaks audit goal --project <path> --need <text>` first to produce the approved goal JSON.',
            'Confirm `--session-id` matches the session that wrote the goal.',
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // 5. Provider check: unknown names fail loudly — a silent fallback to
    //    `stub` would hand the caller a scaffold envelope that reads as a
    //    review route, which is the defect class this gate exists to stop.
    const provider = options.llmProvider ?? DEFAULT_LLM_PROVIDER;
    if (!isSupportedLlmProvider(provider)) {
      printResult(
        io,
        fail<FinalReviewData>(
          'final-review.prepare',
          'LLM_PROVIDER_NOT_IMPLEMENTED',
          `LLM provider "${provider}" is not implemented. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}.`,
          emptyFinalReviewData(rid, sessionValidation.sessionId, auditGoalPath),
          [
            `Re-run with \`--llm-provider anthropic\` for a real 4-dim review, or \`--llm-provider ${DEFAULT_LLM_PROVIDER}\` for an offline scaffold.`,
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // 6. Stub path: surface a structured "scaffold ready" envelope.
    //    We DO NOT call the service here — the stub runner answers the
    //    audit-goal shape, not the 4-dim review shape, so running it through
    //    `prepareFinalReview()` would only manufacture a malformed review.
    //    The envelope confirms the route is wired end-to-end and reports the
    //    audit-goal path the service WOULD read.
    if (provider === 'stub') {
      const data: FinalReviewData = {
        status: 'scaffold-only',
        rid,
        sessionId: sessionValidation.sessionId,
        auditGoalPath,
        serviceWired: true,
        providerBinding: 'stub',
      };
      const envelope: ResultEnvelope<FinalReviewData> = ok(
        'final-review.prepare',
        data,
        [],
        [
          'Stub provider: no 4-dim review was performed. This envelope only proves the route is wired and reachable.',
          `Audit-goal file is present at: ${auditGoalPath}`,
          'Re-run with `--llm-provider anthropic` to produce a real review.',
        ]
      );
      printResult(io, envelope, options.json);
      return;
    }

    // 7. Real provider path: bind a real `LlmRunner` and run the service.
    //    Binding happens INSIDE the try so an absent credential surfaces as
    //    `LlmBindingError`'s own code instead of escaping as a crash. No
    //    envelope is emitted on that path — a "successful" empty review would
    //    be worse than an error.
    try {
      const config = resolveAnthropicConfig();
      const llmRunner: LlmRunner = createAnthropicRunner(config);
      const review = await prepareFinalReview(rid, {
        projectRoot: projectValidation.projectRoot,
        sessionId: sessionValidation.sessionId,
        llmRunner,
      });
      const data: FinalReviewData = {
        status: 'review-complete',
        rid,
        sessionId: sessionValidation.sessionId,
        auditGoalPath,
        serviceWired: true,
        providerBinding: 'anthropic-messages-api',
        model: config.model,
        review,
      };
      const envelope: ResultEnvelope<FinalReviewData> = ok(
        'final-review.prepare',
        data,
        review.allPass ? [] : [
          `Dimensions needing human attention: ${review.needsAttention.join(', ') || 'none flagged'}.`,
        ],
        [
          `4-dim review produced by anthropic-messages-api (model: ${config.model}).`,
          `allPass: ${String(review.allPass)}.`,
        ]
      );
      printResult(io, envelope, options.json);
    } catch (error) {
      const code = finalReviewErrorCode(error);
      printResult(
        io,
        fail<FinalReviewData>(
          'final-review.prepare',
          code,
          getErrorMessage(error),
          emptyFinalReviewData(
            rid,
            sessionValidation.sessionId,
            auditGoalPath,
            error instanceof LlmBindingError ? error.missingEnv : undefined
          ),
          finalReviewNextActions(code)
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

/**
 * Map a thrown error to the CLI's error code. The LLM-layer errors already
 * carry codes precise enough to act on (`LLM_CREDENTIAL_MISSING`,
 * `LLM_REQUEST_FAILED`, …), so they are passed through rather than flattened
 * into one opaque failure.
 */
function finalReviewErrorCode(error: unknown): string {
  if (
    error instanceof LlmBindingError ||
    error instanceof LlmRequestError ||
    error instanceof IncompleteFinalReviewError
  ) {
    return error.code;
  }
  return 'FINAL_REVIEW_FAILED';
}

function finalReviewNextActions(code: string): string[] {
  switch (code) {
    case 'LLM_CREDENTIAL_MISSING':
      return [
        'Export ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) in the environment that launches peaks, then re-run.',
        'For an offline scaffold instead of a review, re-run with `--llm-provider stub` — it performs NO review.',
      ];
    case 'LLM_MODEL_MISSING':
      return [
        'Export ANTHROPIC_MODEL (or CLAUDE_CODE_SUBAGENT_MODEL) in the environment that launches peaks, then re-run.',
      ];
    case 'LLM_REQUEST_FAILED':
      return [
        'Check ANTHROPIC_BASE_URL and network reachability, then re-run — a transport failure produces no review.',
      ];
    case 'INCOMPLETE_FINAL_REVIEW':
      return [
        'The LLM reply was not valid JSON or omitted a required dimension; re-run so the gate is never read as complete.',
      ];
    default:
      return ['Re-run with `--llm-provider stub` to validate the CLI route without a real LLM.'];
  }
}
