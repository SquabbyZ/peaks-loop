// `peaks request mark-qa-initiated <request-id>` — create the session's
// `qa/.initiated` marker when the QA role wrote its request artifact before
// `peaks request init --role qa` ran. `request init` refuses as soon as the
// artifact exists, so before this verb the only ways to the marker were
// deleting a real artifact or hand-creating the file (backlog §10.4).
//
// The verb is deliberately narrow: it requires the QA artifact to already
// exist — otherwise `request init` is the in-order path, and it creates the
// artifact together with the marker — and it never writes, rewrites, or
// deletes anything under `qa/requests/`.
import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';

import { markQaInitiated } from '../../services/artifacts/qa-initiated-marker.js';
import {
  showRequestArtifact,
  type ShowRequestArtifactOptions,
  type ShowRequestArtifactResult
} from '../../services/artifacts/request-artifact-service.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestMarkQaInitiatedOptions } from './request-command-options.js';

const MARK_DESCRIPTION =
  'Create the qa/.initiated marker for a session whose QA request artifact already exists. Idempotent: a second call changes nothing, and the request artifact is never touched.';
const MARK_REQUEST_ID_HELP = 'request id of the existing QA artifact';
const MARK_PROJECT_HELP = 'target project root';
const MARK_SESSION_HELP = 'restrict the artifact lookup to a specific session id';

type MarkFailure = {
  code: string;
  message: string;
  data: Record<string, unknown>;
  nextActions: string[];
};

function failMark(io: ProgramIO, json: boolean | undefined, failure: MarkFailure): void {
  printResult(
    io,
    fail(
      'request.mark-qa-initiated',
      failure.code,
      failure.message,
      failure.data,
      failure.nextActions
    ),
    json
  );
  process.exitCode = 1;
}

/**
 * The artifact is the anchor: the marker lands in THAT artifact's session, so
 * a caller who omits `--session-id` cannot mark a different session by
 * accident. A missing artifact refuses rather than writing the marker, because
 * then nothing records that QA was ever invoked.
 */
async function findQaArtifact(
  requestId: string,
  options: RequestMarkQaInitiatedOptions
): Promise<ShowRequestArtifactResult | null> {
  const showOptions: ShowRequestArtifactOptions = {
    projectRoot: options.project,
    role: 'qa',
    requestId
  };
  if (options.sessionId !== undefined) showOptions.sessionId = options.sessionId;
  return await showRequestArtifact(showOptions);
}

function artifactMissingFailure(
  requestId: string,
  options: RequestMarkQaInitiatedOptions
): MarkFailure {
  return {
    code: 'QA_ARTIFACT_MISSING',
    message: `No QA request artifact found for requestId=${requestId}; the marker records that the artifact already exists`,
    data: { requestId },
    nextActions: [
      `Run \`peaks request init --role qa --id ${requestId} --project ${options.project} --apply\` to create the artifact and the marker together`
    ]
  };
}

async function runRequestMarkQaInitiated(
  requestId: string,
  options: RequestMarkQaInitiatedOptions,
  io: ProgramIO
): Promise<void> {
  try {
    if (options.sessionId !== undefined && isUnsafePathInput(options.sessionId)) {
      failMark(io, options.json, {
        code: 'INVALID_SESSION_ID',
        message: `Invalid session id: ${options.sessionId} (must be a single path segment)`,
        data: { provided: options.sessionId },
        nextActions: ['Pass a session id that is a single path segment']
      });
      return;
    }
    const artifact = await findQaArtifact(requestId, options);
    if (artifact === null) {
      failMark(io, options.json, artifactMissingFailure(requestId, options));
      return;
    }
    const result = await markQaInitiated({
      projectRoot: options.project,
      sessionId: artifact.sessionId
    });
    printResult(
      io,
      ok(
        'request.mark-qa-initiated',
        { requestId, sessionId: artifact.sessionId, path: result.path, created: result.created },
        [],
        result.created ? [] : [`qa/.initiated already existed at ${result.path}; nothing changed`]
      ),
      options.json
    );
  } catch (error) {
    failMark(io, options.json, {
      code: 'REQUEST_MARK_QA_INITIATED_FAILED',
      message: getErrorMessage(error),
      data: { requestId },
      nextActions: [
        'Verify the project path, session id, and the existing QA artifact before retrying'
      ]
    });
  }
}

export function registerRequestMarkQaInitiatedCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('mark-qa-initiated')
      .description(MARK_DESCRIPTION)
      .argument('<request-id>', MARK_REQUEST_ID_HELP)
      .requiredOption('--project <path>', MARK_PROJECT_HELP)
      .option('--session-id <session>', MARK_SESSION_HELP)
  ).action((requestId: string, options: RequestMarkQaInitiatedOptions) =>
    runRequestMarkQaInitiated(requestId, options, io)
  );
}
