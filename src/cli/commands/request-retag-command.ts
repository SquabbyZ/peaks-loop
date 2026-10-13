// `peaks request retag` — set or change a request's type after creation.
import type { Command } from 'commander';
import {
  retagRequestArtifact,
  describeRetag
} from '../../services/artifacts/request-retag-service.js';
import { VALID_REQUEST_TYPES } from '../../services/artifacts/request-artifact-service.js';
import { parseRequestType, parseRole, VALID_ROLES } from './request-format-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestRetagOptions } from './request-command-options.js';

const RETAG_DESCRIPTION =
  "Set a request artifact's type, replacing whatever it currently records. Reports the prerequisite table the new type selects and any of its artifacts that are not on disk yet.";
const RETAG_REQUEST_ID_HELP = 'request id, e.g. 2026-05-23-add-foo';
const RETAG_TYPE_HELP = `request type (${VALID_REQUEST_TYPES.join(' | ')})`;
const RETAG_PROJECT_HELP = 'target project root';
/**
 * Required, unlike the read verbs' optional flag. `showRequestArtifact` resolves
 * the first session holding a matching rid when none is given, which is a fine
 * way to READ and a way to WRITE the wrong artifact — so this verb names its
 * target or does nothing.
 */
const RETAG_SESSION_HELP = 'session id holding the artifact to retag (required)';

async function runRequestRetag(
  requestId: string,
  options: RequestRetagOptions,
  io: ProgramIO
): Promise<void> {
  try {
    const result = await retagRequestArtifact({
      projectRoot: options.project,
      role: options.role,
      requestId,
      requestType: options.type,
      sessionId: options.sessionId
    });
    if (result === null) {
      printResult(
        io,
        fail(
          'request.retag',
          'REQUEST_NOT_FOUND',
          `No artifact found for role=${options.role} requestId=${requestId}`,
          { role: options.role, requestId },
          ['Verify the request id, role, and session id']
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('request.retag', result, describeRetag(result)), options.json);
  } catch (error) {
    printResult(
      io,
      fail('request.retag', 'REQUEST_RETAG_FAILED', getErrorMessage(error), {
        role: options.role,
        requestId
      }),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRequestRetagCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('retag')
      .description(RETAG_DESCRIPTION)
      .argument('<request-id>', RETAG_REQUEST_ID_HELP)
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--type <type>', RETAG_TYPE_HELP, parseRequestType)
      .requiredOption('--project <path>', RETAG_PROJECT_HELP)
      .requiredOption('--session-id <session>', RETAG_SESSION_HELP)
  ).action((requestId: string, options: RequestRetagOptions) =>
    runRequestRetag(requestId, options, io)
  );
}
