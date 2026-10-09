// Split out of `request-commands.ts`:
// `peaks request lint`. The action was 54 code lines; the not-found refusal is
// its own printer.
import type { Command } from 'commander';
import { lintRequestArtifact } from '../../services/artifacts/artifact-lint-service.js';
import { parseRole, VALID_ROLES } from './request-format-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestLintOptions } from './request-command-options.js';

const LINT_DESCRIPTION =
  'Scan a request artifact body for unfilled placeholders (<...>, TBD, bare bullets) before declaring it complete';
const LINT_REQUEST_ID_HELP = 'request id';
const LINT_PROJECT_HELP = 'target project root';
const LINT_SESSION_HELP = 'restrict to a specific session id';

function failLintNotFound(io: ProgramIO, options: RequestLintOptions, requestId: string): void {
  printResult(
    io,
    fail(
      'request.lint',
      'REQUEST_NOT_FOUND',
      `No artifact found for role=${options.role} requestId=${requestId}`,
      { role: options.role, requestId },
      ['Verify the request id, role, and session id']
    ),
    options.json
  );
  process.exitCode = 1;
}

async function runRequestLint(
  requestId: string,
  options: RequestLintOptions,
  io: ProgramIO
): Promise<void> {
  try {
    const lintOptions: Parameters<typeof lintRequestArtifact>[0] = {
      projectRoot: options.project,
      role: options.role,
      requestId
    };
    if (options.sessionId !== undefined) {
      lintOptions.sessionId = options.sessionId;
    }
    const report = await lintRequestArtifact(lintOptions);
    if (report === null) {
      failLintNotFound(io, options, requestId);
      return;
    }
    const nextActions: string[] = [];
    if (!report.ok) {
      nextActions.push(
        `Fix ${report.findings.filter((f) => f.severity === 'error').length} error finding(s) before transitioning this artifact.`
      );
    }
    printResult(io, ok('request.lint', report, [], nextActions), options.json);
    if (!report.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'request.lint',
        'REQUEST_LINT_FAILED',
        getErrorMessage(error),
        { role: options.role, requestId },
        ['Verify the artifact path before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRequestLintCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('lint')
      .description(LINT_DESCRIPTION)
      .argument('<request-id>', LINT_REQUEST_ID_HELP)
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--project <path>', LINT_PROJECT_HELP)
      .option('--session-id <session>', LINT_SESSION_HELP)
  ).action((requestId: string, options: RequestLintOptions) =>
    runRequestLint(requestId, options, io)
  );
}
