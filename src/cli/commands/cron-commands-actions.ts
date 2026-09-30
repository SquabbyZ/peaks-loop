/**
 * The three `peaks cron` action handlers (init / list / run) — moved VERBATIM
 * out of `cron-commands.ts` (job strict-remediation-abc, slice
 * c1-eslint-family-sweep, leaf c3w1-cron-commands) so the registration file
 * clears the `max-lines-per-function` findings.
 *
 * NOTHING was restructured: same predicate order inside the due/nextDueAt
 * annotation (`e.enabled && (e.lastRunAt === null || now - e.lastRunAt >=
 * e.intervalMs)`, with `>=` exactly as it was), same `process.exitCode = 1`
 * points, same emitted message text, same sort. The run action's 66-line body
 * was further split into `runCronTasks` / `runTargets` / `printRunOutcome`
 * purely to cross the function-length line; ordering is unchanged.
 *
 * One dead local was not copied: `const now = Date.now();` inside the run
 * action was never read (it carried a `no-unused-vars` baseline ERROR on the
 * original file). Removing an unread, effect-free assignment changes no branch,
 * throw, exit code, or emitted byte — and a new sibling must be clean outright.
 */

import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  ensureLeaseGcEntry,
  listDueTasks,
  readSchedule,
  schedulePath,
  SCHEDULE_VERSION,
  writeSchedule,
  type RunRecord,
  type ScheduleEntry
} from './cron-commands-schedule.js';
import { runTask } from './cron-commands.js';

const STDERR_NEXT_ACTIONS_TRUNCATE_CHARS = 200;

export function handleCronInit(io: ProgramIO, options: { project?: string; json?: boolean }): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const file = readSchedule(projectRoot);
    const updated = ensureLeaseGcEntry(file);
    writeSchedule(projectRoot, updated);
    const added = updated.entries.length - file.entries.length;
    printResult(
      io,
      ok(
        'cron.init',
        {
          projectRoot,
          schedulePath: schedulePath(projectRoot),
          totalEntries: updated.entries.length,
          added
        },
        [],
        [
          added > 0
            ? `Added ${added} built-in task(s). Use 'peaks cron list' to inspect.`
            : 'Schedule already contains the built-in tasks; no change made.'
        ]
      ),
      options.json
    );
  } catch (err) {
    printResult(
      io,
      fail(
        'cron.init',
        'CRON_INIT_FAILED',
        getErrorMessage(err),
        { projectRoot: options.project },
        [
          'Verify the project root is a peaks-loop project (.peaks/ exists).',
          'Check filesystem permissions.'
        ]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function handleCronList(io: ProgramIO, options: { project?: string; json?: boolean }): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const file = readSchedule(projectRoot);
    const now = Date.now();
    const annotated = file.entries.map((e) => ({
      ...e,
      due: e.enabled && (e.lastRunAt === null || now - e.lastRunAt >= e.intervalMs),
      nextDueAt: e.lastRunAt === null ? now : e.lastRunAt + e.intervalMs
    }));
    annotated.sort((a, b) => a.nextDueAt - b.nextDueAt);
    printResult(
      io,
      ok(
        'cron.list',
        { projectRoot, schedulePath: schedulePath(projectRoot), entries: annotated },
        [],
        [`${annotated.length} task(s); ${annotated.filter((e) => e.due).length} due now.`]
      ),
      options.json
    );
  } catch (err) {
    printResult(
      io,
      fail(
        'cron.list',
        'CRON_LIST_FAILED',
        getErrorMessage(err),
        { projectRoot: options.project },
        ["If schedule.json is missing, run 'peaks cron init' first."]
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function handleCronRun(
  io: ProgramIO,
  options: { id?: string; project?: string; json?: boolean }
): void {
  try {
    runCronTasks(io, options);
  } catch (err) {
    printResult(
      io,
      fail('cron.run', 'CRON_RUN_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
        "If schedule.json is missing, run 'peaks cron init' first."
      ]),
      options.json
    );
    process.exitCode = 1;
  }
}

function runCronTasks(
  io: ProgramIO,
  options: { id?: string; project?: string; json?: boolean }
): void {
  const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const file = readSchedule(projectRoot);
  const targets = options.id
    ? file.entries.filter((e) => e.id === options.id)
    : listDueTasks(projectRoot);
  if (targets.length === 0) {
    printResult(
      io,
      ok('cron.run', { projectRoot, ran: 0, records: [] }, [], ['No due tasks; nothing to run.']),
      options.json
    );
    return;
  }
  const { records, updatedEntries } = runTargets(projectRoot, file.entries, targets);
  writeSchedule(projectRoot, { version: SCHEDULE_VERSION, entries: updatedEntries });
  printRunOutcome(io, options, projectRoot, records);
}

function runTargets(
  projectRoot: string,
  entries: ReadonlyArray<ScheduleEntry>,
  targets: ReadonlyArray<ScheduleEntry>
): { records: RunRecord[]; updatedEntries: ScheduleEntry[] } {
  const records: RunRecord[] = [];
  const updatedEntries: ScheduleEntry[] = [];
  for (const task of entries) {
    if (!targets.some((t) => t.id === task.id)) {
      updatedEntries.push(task);
      continue;
    }
    const record = runTask(projectRoot, task);
    records.push(record);
    updatedEntries.push({ ...task, lastRunAt: record.finishedAt });
  }
  return { records, updatedEntries };
}

function printRunOutcome(
  io: ProgramIO,
  options: { json?: boolean },
  projectRoot: string,
  records: ReadonlyArray<RunRecord>
): void {
  printResult(
    io,
    ok(
      'cron.run',
      { projectRoot, ran: records.length, records },
      records
        .filter((r) => r.exitCode !== 0)
        .map(
          (r) =>
            `Task ${r.taskId} failed (exit=${r.exitCode}): ${r.stderr.slice(0, STDERR_NEXT_ACTIONS_TRUNCATE_CHARS)}`
        ),
      [
        `Ran ${records.length} task(s); ${records.filter((r) => r.exitCode === 0).length} succeeded.`
      ]
    ),
    options.json
  );
  if (records.some((r) => r.exitCode !== 0)) process.exitCode = 1;
}
