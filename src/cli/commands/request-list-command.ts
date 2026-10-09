// Split out of `request-commands.ts`:
// `peaks request list` plus the `--summary` projection it renders.
import type { Command } from 'commander';
import {
  listRequestArtifacts,
  type RequestArtifactSummary
} from '../../services/artifacts/request-artifact-service.js';
import { boundedNames, fitSummaryToBytes } from '../../services/context/summary-view.js';
import { parseRole, VALID_ROLES } from './request-format-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestListOptions } from './request-command-options.js';

const LIST_DESCRIPTION = 'List per-request artifacts under a project workspace';
const LIST_PROJECT_HELP = 'target project root';
const LIST_SESSION_HELP = 'limit to a specific session id';
const LIST_SUMMARY_HELP =
  'emit counts + names-of-first-N only (≤ 2 KB) instead of the full item array; the default envelope is unchanged';

/**
 * `request list`. `count` is the true total; `names` carries
 * `role/requestId (state)` labels for the first N entries. The full `items`
 * array (with paths + timestamps) is one flag away — omit `--summary`.
 */
export function buildRequestListSummary(
  items: readonly RequestArtifactSummary[]
): Record<string, unknown> {
  const view = {
    view: 'summary',
    count: items.length,
    items: boundedNames(items.map((i) => `${i.role}/${i.requestId} (${i.state})`))
  };
  return fitSummaryToBytes(view);
}

async function runRequestList(options: RequestListOptions, io: ProgramIO): Promise<void> {
  try {
    const listOptions: Parameters<typeof listRequestArtifacts>[0] = {
      projectRoot: options.project
    };
    if (options.sessionId !== undefined) {
      listOptions.sessionId = options.sessionId;
    }
    if (options.role !== undefined) {
      listOptions.role = options.role;
    }
    const items = await listRequestArtifacts(listOptions);
    // Slice B: `--summary` is opt-in; the default `{count, items}` shape is
    // byte-identical to before.
    const data =
      options.summary === true ? buildRequestListSummary(items) : { count: items.length, items };
    printResult(io, ok('request.list', data), options.json);
  } catch (error) {
    printResult(
      io,
      fail(
        'request.list',
        'REQUEST_LIST_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        ['Check project path before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRequestListCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('list')
      .description(LIST_DESCRIPTION)
      .requiredOption('--project <path>', LIST_PROJECT_HELP)
      .option('--session-id <session>', LIST_SESSION_HELP)
      .option('--role <role>', `limit to a single role (${VALID_ROLES.join(' | ')})`, parseRole)
      .option('--summary', LIST_SUMMARY_HELP)
  ).action((options: RequestListOptions) => runRequestList(options, io));
}
