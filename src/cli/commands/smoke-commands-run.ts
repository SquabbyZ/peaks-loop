/**
 * `peaks smoke run` and `peaks smoke run-and-repair` — the record paths for a
 * critical-path regression run.
 *
 * Extracted VERBATIM from `smoke-commands.ts` (job strict-remediation-abc,
 * slice c1-eslint-family-sweep, leaf c4w1-cli-b). Both sub-commands were split
 * out here because they read the same `--record <pairs>` grammar and share the
 * `RUN_STATUSES` allowlist. Predicate order, message text, hint lines, state
 * writes and the fail-vs-ok envelope shape are preserved exactly; the two
 * actions differ only in what the original file already had them do
 * (`run` prints INVALID_RECORD / INVALID_STATUS and returns; `run-and-repair`
 * silently skips a bad pair). No new error handling: neither action
 * swallows anything that HEAD did not already handle.
 */
import type { Command } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  readSmokeState,
  recordRun,
  summarizeState,
  writeSmokeState,
  type CriticalPathStatus,
  type SmokeState
} from '../../services/smoke/smoke-paths-state.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

const RUN_STATUSES: readonly CriticalPathStatus[] = ['pending', 'pass', 'fail'];

type SmokeRunOptions = {
  record?: string;
  notes?: string;
  project?: string;
  json?: boolean;
};

export function registerSmokeRun(smoke: Command, io: ProgramIO): void {
  addJsonOption(
    smoke
      .command('run')
      .description(
        'Record a smoke regression run. Without --record, this is a dry summary. ' +
          'With --record and --status-id pairs (id1:pass,id2:fail), it records ' +
          'the run result and persists updated state. ' +
          'Real Playwright integration is out of scope for this slice.'
      )
      .option('--record <pairs>', 'comma-separated id:status pairs (e.g. "login:pass,logout:fail")')
      .option('--notes <text>', 'optional run notes applied to all recorded paths')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: SmokeRunOptions) => {
    runSmokeRunAction(io, opts);
  });
}

export function registerSmokeRunAndRepair(smoke: Command, io: ProgramIO): void {
  addJsonOption(
    smoke
      .command('run-and-repair')
      .description(
        'Same as `smoke run --record`, but emits a "needs repair" warning when any path fails. ' +
          'Returns exit code 0 always (the CLI does not block on smoke failure; the user ' +
          "decides whether to enter the repair loop). Real repair execution is the user's " +
          'call (run peaks-rd / re-implement / re-test).'
      )
      .option('--record <pairs>', 'comma-separated id:status pairs (e.g. "login:pass,logout:fail")')
      .option('--notes <text>', 'optional run notes')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: SmokeRunOptions) => {
    runSmokeRunAndRepairAction(io, opts);
  });
}

function resolveProjectRoot(project: string | undefined): string {
  return project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

function splitRecordPairs(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isRunStatus(status: string): status is CriticalPathStatus {
  return RUN_STATUSES.includes(status as CriticalPathStatus);
}

type ApplyRunPairsArgs = {
  io: ProgramIO;
  json: boolean;
  projectRoot: string;
  state: SmokeState;
  pairs: string[];
  notes: string | undefined;
};

/**
 * Apply each `--record` pair to the state, preserving the original control
 * flow: on the first bad pair the caller prints its INVALID_RECORD /
 * INVALID_STATUS envelope and returns without writing state. `null` means the
 * caller has already printed and must bail.
 */
function applyRunPairs(args: ApplyRunPairsArgs): SmokeState | null {
  const { io, json, projectRoot, pairs, notes } = args;
  let cur = args.state;
  for (const pair of pairs) {
    const [id, status] = pair.split(':');
    if (!id || !status) {
      printResult(
        io,
        fail(
          'smoke.run',
          'INVALID_RECORD',
          `bad pair "${pair}" (expected id:status)`,
          { projectRoot },
          []
        ),
        json
      );
      return null;
    }
    if (!isRunStatus(status)) {
      printResult(
        io,
        fail(
          'smoke.run',
          'INVALID_STATUS',
          `bad status "${status}" (expected pending|pass|fail)`,
          { projectRoot },
          []
        ),
        json
      );
      return null;
    }
    cur = recordRun(cur, id.trim(), status, notes);
  }
  return cur;
}

function runSmokeRunAction(io: ProgramIO, opts: SmokeRunOptions): void {
  const projectRoot = resolveProjectRoot(opts.project);
  const startMs = Date.now();
  const json = opts.json ?? false;
  let state = readSmokeState(projectRoot);
  if (opts.record) {
    const pairs = splitRecordPairs(opts.record);
    const next = applyRunPairs({ io, json, projectRoot, state, pairs, notes: opts.notes });
    if (next === null) return;
    state = next;
    writeSmokeState(projectRoot, state);
  }
  const summary = summarizeState(state);
  const durationMs = Date.now() - startMs;
  printResult(
    io,
    ok(
      'smoke.run',
      {
        projectRoot,
        summary: { ...summary, durationMs }
      },
      summary.failedPaths > 0
        ? [`${summary.failedPaths} path(s) failed — consider \`peaks smoke run-and-repair\``]
        : []
    ),
    json
  );
}

function runSmokeRunAndRepairAction(io: ProgramIO, opts: SmokeRunOptions): void {
  const projectRoot = resolveProjectRoot(opts.project);
  const json = opts.json ?? false;
  let state = readSmokeState(projectRoot);
  if (opts.record) {
    const pairs = splitRecordPairs(opts.record);
    for (const pair of pairs) {
      const [id, status] = pair.split(':');
      if (!id || !status) continue;
      if (!isRunStatus(status)) continue;
      state = recordRun(state, id.trim(), status, opts.notes);
    }
    writeSmokeState(projectRoot, state);
  }
  const summary = summarizeState(state);
  const needsRepair = summary.failedPaths > 0;
  printResult(
    io,
    ok(
      'smoke.run-and-repair',
      {
        projectRoot,
        needsRepair,
        summary
      },
      needsRepair ? buildRepairWarnings(summary) : ['All paths pass.']
    ),
    json
  );
}

function buildRepairWarnings(summary: ReturnType<typeof summarizeState>): string[] {
  return [
    `Repair needed for ${summary.failedPaths} path(s):`,
    ...summary.failedDetails.map(
      (d) => `  - ${d.name}${d.lastRunNote ? ` (note: ${d.lastRunNote})` : ''}`
    ),
    'Re-run the failing paths, or enter peaks-rd repair-loop.'
  ];
}
