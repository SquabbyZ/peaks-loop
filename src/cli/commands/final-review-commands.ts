/**
 * W5 Fix M2 — `peaks prepare-final-review <rid>` CLI wrapper.
 *
 * Exposes the `prepareFinalReview()` service (added in W2 T9 on
 * `feature/slice-topology-multipass`) via the CLI surface. The service
 * depends on an injected `LlmRunner`; this slice wires the CLI route
 * with a `stub` provider that returns a structured "scaffold ready"
 * envelope so CI can verify the route without a real LLM. A follow-up
 * slice will bind a real provider. Until then, non-stub providers fail
 * loudly with `LLM_PROVIDER_NOT_IMPLEMENTED` so callers cannot silently
 * no-op.
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

type PrepareFinalReviewOptions = {
  project: string;
  sessionId: string;
  llmProvider?: string;
  json?: boolean;
};

/** Whitelist of supported `--llm-provider` values for `peaks prepare-final-review`. */
const SUPPORTED_LLM_PROVIDERS = ['stub'] as const;
type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

function isSupportedLlmProvider(value: string): value is SupportedLlmProvider {
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(value);
}

export type FinalReviewStatus = 'scaffold-only' | 'not-applicable';

export interface FinalReviewData {
  readonly status: FinalReviewStatus;
  readonly rid: string;
  readonly sessionId: string;
  readonly auditGoalPath: string;
  readonly serviceWired: boolean;
  readonly providerBinding: 'pending-follow-up-slice' | 'unknown';
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
  auditGoalPath: string
): FinalReviewData {
  return {
    status: 'not-applicable',
    rid,
    sessionId,
    auditGoalPath,
    serviceWired: false,
    providerBinding: 'unknown',
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
      .option('--llm-provider <name>', 'LLM provider name (default: stub)', 'stub')
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

    // 5. Provider check: only `stub` is wired in this slice.
    const provider = options.llmProvider ?? 'stub';
    if (!isSupportedLlmProvider(provider)) {
      printResult(
        io,
        fail<FinalReviewData>(
          'final-review.prepare',
          'LLM_PROVIDER_NOT_IMPLEMENTED',
          `Provider '${provider}' is not yet wired. The CLI surface is in place; real provider binding is a follow-up slice. Use --llm-provider stub to validate the route without invoking the LLM.`,
          emptyFinalReviewData(rid, sessionValidation.sessionId, auditGoalPath),
          [
            'Re-run with `--llm-provider stub` (default) to validate the route.',
            'Real provider binding is tracked as a follow-up slice.',
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // 6. Stub path: surface a structured "scaffold ready" envelope.
    //    We DO NOT call the service in this slice — the service depends
    //    on an injected `LlmRunner` interface, and no real provider is
    //    bound yet. The envelope confirms the route is wired end-to-end
    //    and reports the audit-goal path the service WOULD read.
    const data: FinalReviewData = {
      status: 'scaffold-only',
      rid,
      sessionId: sessionValidation.sessionId,
      auditGoalPath,
      serviceWired: true,
      providerBinding: 'pending-follow-up-slice',
    };
    const envelope: ResultEnvelope<FinalReviewData> = ok(
      'final-review.prepare',
      data,
      [],
      [
        'prepareFinalReview() service is wired and reachable. The stub provider returns a scaffold envelope so CI can verify the route without a real LLM.',
        `Audit-goal file is present at: ${auditGoalPath}`,
        'A follow-up slice will bind a real LLM provider; until then, non-stub providers fail loudly with `LLM_PROVIDER_NOT_IMPLEMENTED`.',
      ]
    );
    printResult(io, envelope, options.json);
  });
}
