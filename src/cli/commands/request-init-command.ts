// Split out of `request-commands.ts`:
// `peaks request init`. The action was 81 code lines with a complexity of 11;
// the caller-id resolution and the two refusal printers are their own functions.
import type { Command } from 'commander';
import {
  createRequestArtifact,
  VALID_REQUEST_TYPES,
  type RequestArtifactRole
} from '../../services/artifacts/request-artifact-service.js';
import { parseRole, parseRequestType, VALID_ROLES } from './request-format-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestInitOptions } from './request-command-options.js';

const INIT_DESCRIPTION =
  'Create the per-request artifact template for a Peaks role (dry-run by default)';
const INIT_ID_HELP =
  'request id, e.g. 2026-05-23-add-foo. With --apply, also pre-creates the canonical change-id scope dir at .peaks/_runtime/change/<id>/ so sub-agents never write .peaks/_runtime/<id>/ at top level.';
const INIT_PROJECT_HELP = 'target project root';
const INIT_SESSION_HELP = 'override the default date-stamped session id';
const INIT_APPLY_HELP = 'write the artifact file (default: preview only)';
const INIT_CALLER_ID_HELP =
  'Override the caller id for this invocation (D4 priority: flag beats env beats platform fallback). The resolved callerId is stamped on the artifact body and surfaced in the response envelope.';
const CALLER_ID_INVALID_HINTS: string[] = [
  'Set --caller-id to a value matching ^[a-zA-Z0-9._-]{1,200}$',
  'Or set PEAKS_CALLER_ID env var (or CLAUDE_CODE_SESSION_ID for Claude Code)'
];

function failInitSessionIdRequired(io: ProgramIO, options: RequestInitOptions): void {
  printResult(
    io,
    fail(
      'request.init',
      'SESSION_ID_REQUIRED',
      '--session-id is required: the CLI writes envelopes only to .peaks/_runtime/<sessionId>/... (one-axis layout)',
      { role: options.role, requestId: options.id },
      ['Re-run with --session-id <sid>', 'Or run `peaks workspace init` to create a session first']
    ),
    options.json
  );
  process.exitCode = 1;
}

function buildInitServiceOptions(
  options: RequestInitOptions,
  sessionId: string
): Parameters<typeof createRequestArtifact>[0] {
  // One-axis layout: --session-id is REQUIRED. The on-disk root
  // is always `.peaks/_runtime/<sessionId>/<role>/...`. The user
  // has forbidden the `.peaks/_runtime/<id>/` root layout — without an
  // explicit session id, we cannot guarantee the artifact lands
  // under `_runtime/`. See
  // `.peaks/memory/2026-06-21-peaks-request-session-id-leaks-into-change-id.md`.
  const serviceOptions: Parameters<typeof createRequestArtifact>[0] = {
    role: options.role as RequestArtifactRole,
    requestId: options.id,
    projectRoot: options.project
  };
  serviceOptions.sessionId = sessionId;
  if (options.apply === true) {
    serviceOptions.apply = true;
  }
  if (options.type !== undefined) {
    serviceOptions.requestType = options.type;
  }
  return serviceOptions;
}

/**
 * Resolve the caller id, or `null` when the refusal has already been printed
 * and the exit code set. The CLI integration layer is the single entry point
 * for the resolver; we do not pre-judge whether the caller passed a flag.
 * D2 (no callerId available) and D5 (regex fail) both surface as
 * `CALLER_ID_INVALID` with the inner `CallerIdError.source` propagated for
 * caller-side audit. A non-`CallerIdError` propagates to the caller's catch.
 */
async function resolveInitCallerId(
  io: ProgramIO,
  options: RequestInitOptions
): Promise<string | null> {
  const { resolveCallerId, CallerIdError } =
    await import('../../services/session/resolve-caller-id.js');
  try {
    return resolveCallerId(options.callerId !== undefined ? { flagValue: options.callerId } : {});
  } catch (error: unknown) {
    if (error instanceof CallerIdError) {
      // D2 (EX_USAGE, exit 64) = nothing usable; D5 (EX_DATAERR, exit 65)
      // = something was passed but did not match the D1 regex.
      const code = error.code === 'EX_USAGE' ? 64 : 65;
      printResult(
        io,
        fail('request.init', 'CALLER_ID_INVALID', error.message, { source: error.source }, [
          ...CALLER_ID_INVALID_HINTS
        ]),
        options.json
      );
      process.exitCode = code;
      return null;
    }
    throw error;
  }
}

async function runRequestInit(options: RequestInitOptions, io: ProgramIO): Promise<void> {
  try {
    if (options.sessionId === undefined || options.sessionId.trim().length === 0) {
      failInitSessionIdRequired(io, options);
      return;
    }
    const serviceOptions = buildInitServiceOptions(options, options.sessionId);
    const callerId = await resolveInitCallerId(io, options);
    if (callerId === null) return;
    serviceOptions.callerId = callerId;
    const result = await createRequestArtifact(serviceOptions);
    printResult(
      io,
      ok(
        'request.init',
        result,
        [],
        result.applied ? [] : [`Re-run with --apply to write ${result.path}`]
      ),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'request.init',
        'REQUEST_INIT_FAILED',
        getErrorMessage(error),
        { role: options.role, requestId: options.id },
        ['Check role, request id, and project path before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRequestInitCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('init')
      .description(INIT_DESCRIPTION)
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--id <request-id>', INIT_ID_HELP)
      .requiredOption('--project <path>', INIT_PROJECT_HELP)
      .option('--session-id <session>', INIT_SESSION_HELP)
      .option('--apply', INIT_APPLY_HELP)
      .option(
        '--type <type>',
        `request type (${VALID_REQUEST_TYPES.join(' | ')}); default: feature`,
        parseRequestType
      )
      // (D4 priority level 1). When set, the resolved callerId is surfaced
      // in the JSON envelope; the on-disk artifact records it in the
      // artifact body so future reads know which caller produced it.
      .option('--caller-id <id>', INIT_CALLER_ID_HELP)
  ).action((options: RequestInitOptions) => runRequestInit(options, io));
}
