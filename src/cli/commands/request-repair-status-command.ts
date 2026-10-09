// Split out of `request-commands.ts`:
// `peaks request repair-status`. The action was 60 code lines; the cap
// resolution, the not-found refusal and the next-action builder are their own
// functions.
import type { Command } from 'commander';
import { getRepairCycleStatus } from '../../services/artifacts/repair-cycle-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import type { RequestRepairStatusOptions } from './request-command-options.js';

const REPAIR_STATUS_DESCRIPTION =
  'Count RD↔QA repair cycles for a request from its RD artifact transition notes; reports cycle count and whether the 3-cycle cap is reached';
const REPAIR_STATUS_REQUEST_ID_HELP = 'request id';
const REPAIR_STATUS_PROJECT_HELP = 'target project root';
const REPAIR_STATUS_SESSION_HELP = 'restrict to a specific session id';
const REPAIR_STATUS_MAX_CYCLES_HELP = 'override the default max cycle cap (default 3)';

type RepairReport = NonNullable<Awaited<ReturnType<typeof getRepairCycleStatus>>>;

function resolveRepairMaxCycles(options: RequestRepairStatusOptions): number {
  return options.maxCycles !== undefined && /^\d+$/.test(options.maxCycles)
    ? Number(options.maxCycles)
    : 3;
}

function failRepairStatusNotFound(
  io: ProgramIO,
  options: RequestRepairStatusOptions,
  requestId: string
): void {
  printResult(
    io,
    fail(
      'request.repair-status',
      'REQUEST_NOT_FOUND',
      `No RD artifact found for requestId=${requestId}`,
      { requestId },
      ['Verify the request id and session id']
    ),
    options.json
  );
  process.exitCode = 1;
}

function repairStatusNextActions(report: RepairReport): string[] {
  const nextActions: string[] = [];
  if (report.atCap) {
    nextActions.push(
      `Repair cap reached (${report.cycleCount}/${report.maxCycles}). Emit a blocked TXT handoff and stop the loop.`
    );
  } else if (report.cycleCount > 0) {
    nextActions.push(`${report.remaining} repair cycle(s) remaining before block.`);
  }
  return nextActions;
}

async function runRequestRepairStatus(
  requestId: string,
  options: RequestRepairStatusOptions,
  io: ProgramIO
): Promise<void> {
  try {
    const statusOptions: Parameters<typeof getRepairCycleStatus>[0] = {
      projectRoot: options.project,
      requestId,
      maxCycles: resolveRepairMaxCycles(options)
    };
    if (options.sessionId !== undefined) {
      statusOptions.sessionId = options.sessionId;
    }
    const report = await getRepairCycleStatus(statusOptions);
    if (report === null) {
      failRepairStatusNotFound(io, options, requestId);
      return;
    }
    printResult(
      io,
      ok('request.repair-status', report, [], repairStatusNextActions(report)),
      options.json
    );
    if (report.atCap) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'request.repair-status',
        'REQUEST_REPAIR_STATUS_FAILED',
        getErrorMessage(error),
        { requestId },
        ['Verify the artifact path before retrying']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerRequestRepairStatusCommand(request: Command, io: ProgramIO): void {
  addJsonOption(
    request
      .command('repair-status')
      .description(REPAIR_STATUS_DESCRIPTION)
      .argument('<request-id>', REPAIR_STATUS_REQUEST_ID_HELP)
      .requiredOption('--project <path>', REPAIR_STATUS_PROJECT_HELP)
      .option('--session-id <session>', REPAIR_STATUS_SESSION_HELP)
      .option('--max-cycles <n>', REPAIR_STATUS_MAX_CYCLES_HELP)
  ).action((requestId: string, options: RequestRepairStatusOptions) =>
    runRequestRepairStatus(requestId, options, io)
  );
}
