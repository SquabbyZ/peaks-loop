// Split out of `request-commands.ts`:
// `peaks request show`.
import type { Command } from 'commander';
import { showRequestArtifact } from '../../services/artifacts/request-artifact-service.js';
import {
  applyPerArtifactFormat,
  inferArtifactName,
  parseRole,
  resolveDefaultFormat,
  VALID_ROLES
} from './request-format-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestShowOptions } from './request-command-options.js';

const SHOW_DESCRIPTION =
  'Show a single per-request artifact, optionally scoped to a session. R3: default body format is per-artifact (PRD/tech-doc pretty; everything else compact); pass --pretty or --compact to override uniformly.';
const SHOW_REQUEST_ID_HELP = 'request id, e.g. 2026-05-23-add-foo';
const SHOW_PROJECT_HELP = 'target project root';
const SHOW_SESSION_HELP = 'restrict to a specific session id';
const SHOW_PRETTY_HELP = 'force the body to render pretty (overrides the per-artifact default)';
const SHOW_COMPACT_HELP = 'force the body to render compact (overrides the per-artifact default)';

function failShowNotFound(io: ProgramIO, options: RequestShowOptions, requestId: string): void {
  printResult(
    io,
    fail(
      'request.show',
      'REQUEST_NOT_FOUND',
      `No artifact found for role=${options.role} requestId=${requestId}`,
      { role: options.role, requestId },
      ['Verify the request id, role, and session id']
    ),
    options.json
  );
  process.exitCode = 1;
}

function buildShowPayload(result: Record<string, unknown>, options: RequestShowOptions): unknown {
  // R3: pick the per-artifact default format and apply the override
  // if either flag is set. Last-flag-wins if both are passed.
  const override: 'pretty' | 'compact' | null =
    options.compact === true ? 'compact' : options.pretty === true ? 'pretty' : null;
  const artifactName = inferArtifactName(result, options.role);
  const format: 'pretty' | 'compact' = override ?? resolveDefaultFormat(artifactName);
  const transformed = applyPerArtifactFormat(result, override ?? format);
  return transformed === result ? { ...result, format } : transformed;
}

async function runRequestShow(
  requestId: string,
  options: RequestShowOptions,
  io: ProgramIO
): Promise<void> {
  try {
    const showOptions: Parameters<typeof showRequestArtifact>[0] = {
      projectRoot: options.project,
      role: options.role,
      requestId
    };
    if (options.sessionId !== undefined) {
      showOptions.sessionId = options.sessionId;
    }
    const result = await showRequestArtifact(showOptions);
    if (result === null) {
      failShowNotFound(io, options, requestId);
      return;
    }
    printResult(io, ok('request.show', buildShowPayload(result, options)), options.json);
  } catch (error) {
    printResult(
      io,
      fail(
        'request.show',
        'REQUEST_SHOW_FAILED',
        getErrorMessage(error),
        { role: options.role, requestId },
        ['Check role, request id, and project path before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRequestShowCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('show')
      .description(SHOW_DESCRIPTION)
      .argument('<request-id>', SHOW_REQUEST_ID_HELP)
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--project <path>', SHOW_PROJECT_HELP)
      .option('--session-id <session>', SHOW_SESSION_HELP)
      .option('--pretty', SHOW_PRETTY_HELP)
      .option('--compact', SHOW_COMPACT_HELP)
  ).action((requestId: string, options: RequestShowOptions) =>
    runRequestShow(requestId, options, io)
  );
}
