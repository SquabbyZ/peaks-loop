// src/cli/commands/qa-run-command.ts
//
// `peaks qa run` — the peaks-qa slice (functional / security / browser E2E /
// mutation gates) for the active project. Extracted from `qa-commands.ts`:
//
//   1. `--no-browser` (G5) skips the browser E2E gate entirely; the resulting
//      gate list marks it `status: skipped`, reason `--no-browser`. This is a
//      slice-level opt-out for backend-only or already-covered-by-unit-tests
//      work.
//   2. Plan 2 / Task 8 — `loadMutReport` supplies the MUT.sig gate; a missing
//      report is `skipped`, never `failed`.
//   3. The LLM tool dispatcher would push browser events into the detector in
//      real dogfood; here the slice records an empty event log so the gate-list
//      shape stays stable for downstream parsers.
//
// The registered name, description, options, envelope and exit codes are
// unchanged.

import type { Command } from 'commander';
import { fail, ok } from 'peaks-loop-shared/result';
import { loadMutReport, mutReportPath, type MutReportJson } from 'peaks-loop-mut';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ensureContextForQa } from './qa-context-prestep.js';
import { readQaRunOptions, type QaRunOptions } from './qa-run-options.js';
import { DEFAULT_MAX_BROWSER_RESTARTS, runQaSlice, type QaRunResult } from './qa-run-slice.js';

export function registerQaRunCommand(qa: Command, io: ProgramIO): void {
  addJsonOption(qaRunCommand(qa)).action((options: QaRunOptions) => runQaRun(io, options));
}

/** The `run` verb's description and its six options, verbatim. */
function qaRunCommand(qa: Command): Command {
  return (
    qa
      .command('run')
      .description(
        'Run the peaks-qa slice (PRD 2026-06-16-playwright-restart-loop; Plan 2 mut gate)'
      )
      .option(
        '--project <path>',
        'project the gates evaluate against (default: current directory)',
        '.'
      )
      .option('--session-id <sid>', 'session id; defaults to "ad-hoc" for one-shot runs', 'ad-hoc')
      .option('--no-browser', 'skip the browser E2E gate entirely (PRD G5 / AC4)')
      .option(
        '--max-browser-restarts <n>',
        'halt threshold for close->navigate pairs in this slice (default 3, PRD AC5)',
        String(DEFAULT_MAX_BROWSER_RESTARTS)
      )
      .option('--no-restart-detector', 'disable the restart-loop detector escape hatch (PRD AC6)')
      // Plan 2 / Task 8 — MUT.sig gate opt-out (mirrors --no-browser).
      .option(
        '--no-mutation',
        'skip the mutation gate even if .peaks/_runtime/<sid>/mut/mut-report.json exists'
      )
  );
}

async function runQaRun(io: ProgramIO, options: QaRunOptions): Promise<void> {
  try {
    const { browserEnabled, detectorEnabled, maxRestarts, mutationEnabled } =
      readQaRunOptions(options);
    const qaSid = options.sessionId ?? 'ad-hoc';
    // Sid axis. `--session-id` reaches three consumers below — the context
    // pre-build, `loadMutReport`, and `runQaSlice`'s
    // `qa/browser-events.jsonl` join — so one guard at resolution covers all
    // three. (`peaks qa archive-screenshots` has its own, separate join.)
    if (isUnsafePathInput(qaSid)) {
      printResult(io, unsafeSessionEnvelope(qaSid), options.json);
      process.exitCode = 1;
      return;
    }
    // Plan 1 / Task 9 — pre-build peaks-context before peaks-qa runs.
    // Goal is audience-scoped doc retrieval only; pass a placeholder
    // when the user did not supply one.
    await ensureContextForQa('qa gate run', options.project, qaSid);
    const mutationReport: MutReportJson | null = mutationEnabled
      ? await loadMutReport(qaSid)
      : null;
    const result = runQaSlice({
      project: options.project,
      sessionId: qaSid,
      browserEnabled,
      maxRestarts,
      detectorEnabled,
      events: [],
      mutationReport,
      mutationEnabled
    });
    const mutationFailed = result.gates.find((g) => g.name === 'mutation')?.status === 'failed';
    printResult(
      io,
      ok('qa.run', result, [], qaRunNextActions({ result, browserEnabled, mutationFailed, qaSid })),
      options.json
    );
    if (result.detectorTriggered || mutationFailed) {
      process.exitCode = 2;
    }
  } catch (error) {
    printResult(
      io,
      fail(
        'qa.run',
        'QA_RUN_FAILED',
        error instanceof Error ? error.message : 'Unknown error',
        { project: options.project },
        ['Check the project path and rerun']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

/** The refusal for a `--session-id` that is not a single path segment. */
function unsafeSessionEnvelope(qaSid: string): ReturnType<typeof fail> {
  return fail(
    'qa.gate',
    'INVALID_SESSION_ID',
    `Invalid session id: ${qaSid} (must be a single path segment)`,
    { provided: qaSid },
    ['Pass a session id that is a single path segment']
  );
}

/** What the caller should do next, by the gate that decided the slice's outcome. */
function qaRunNextActions(input: {
  readonly result: QaRunResult;
  readonly browserEnabled: boolean;
  readonly mutationFailed: boolean;
  readonly qaSid: string;
}): string[] {
  if (input.result.detectorTriggered) {
    return [
      'Stop the slice and inspect the diagnostic above',
      'Re-run with --no-restart-detector if the close/reopen was intentional',
      'See .peaks/memory/playwright-restart-loop-2026-06-16.md'
    ];
  }
  if (input.mutationFailed) {
    return [
      'Re-run peaks mut and address the threshold breaches (see reason)',
      'Re-run with --no-mutation to bypass the gate for this slice',
      `mut-report path: ${mutReportPath(input.qaSid)}`
    ];
  }
  return input.browserEnabled
    ? ['No action required; browser gate passed']
    : ['Browser E2E skipped; run without --no-browser when the slice needs E2E'];
}
