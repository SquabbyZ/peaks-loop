/**
 * `peaks cron` — slice 2026-07-29-worktree-l2-extended Part 14.
 *
 * Persistent scheduled-task system. Stores a JSON schedule at
 * `.peaks/cron/schedule.json` and lets the LLM-side runner
 * trigger tasks synchronously (`peaks cron run <id>`) or
 * register a built-in periodic lease gc that the runbook
 * (`skills/peaks-code/`) checks on every session start.
 *
 * Built-in tasks (the only ones auto-registered today):
 *   - `lease-gc-daily` — runs `peaks worktree list` once every 24h. This is a
 *     daily lease LISTING that refreshes the alive-lease set; operators prune
 *     a specific stale lease on demand with `peaks worktree gc --lease-id
 *     <id>`. (Fixed in rid 2026-10-01-cron-exec-timeout-01 §2.22: this header
 *     previously claimed the task ran `peaks worktree gc --all-sessions`,
 *     which is not what `cron-commands-schedule.ts` registers — the code and
 *     the entry's own name say `list`.)
 *
 * Why a JSON file (not a real cron daemon): peaks-loop is a CLI
 * tool, not a service. The schedule is best-effort: the runbook
 * checks it on session start and surfaces overdue tasks. A
 * proper system cron / systemd timer is the production
 * deployment story; this CLI is the portable fallback.
 *
 * File layout:
 *   .peaks/cron/schedule.json — registered tasks with their
 *     interval + lastRunAt
 *   .peaks/cron/history.jsonl — append-only run history
 *
 * Module layout (wave 3 split, job strict-remediation-abc, slice
 * c1-eslint-family-sweep): the schedule model lives in
 * `cron-commands-schedule.ts` and the three action handlers in
 * `cron-commands-actions.ts`. Every name exported from this path before the
 * split is still importable from here. `runTask` stays here together with
 * its exec-timeout constant (that constant carries this file's baseline
 * `no-magic-numbers` warning; new siblings must be clean outright).
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import {
  appendHistory,
  MS_PER_SECOND,
  SECONDS_PER_MINUTE,
  type RunRecord,
  type ScheduleEntry
} from './cron-commands-schedule.js';
import { handleCronInit, handleCronList, handleCronRun } from './cron-commands-actions.js';

export { readSchedule, appendHistory, listDueTasks } from './cron-commands-schedule.js';
export type { ScheduleEntry, ScheduleFile, RunRecord } from './cron-commands-schedule.js';

/**
 * PRD-002b slice 2 — cron-orchestration magic numbers, exec half. The
 * interval/truncation constants live with the code that renders them
 * (`cron-commands-schedule.ts` / `cron-commands-actions.ts`).
 *
 * Per-task exec timeout — FIVE MINUTES (300,000 ms). `runTask` hands this to
 * `spawnSync(…, { timeout })`, which — with no shell in the way, see
 * `resolveTaskEntry` — kills THE TASK PROCESS itself, so a task child that
 * stalls is reaped within five minutes rather than inherited. Fixed in rid
 * 2026-10-01-cron-exec-timeout-01: this constant previously read `5 *
 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND`, and `MINUTES_PER_HOUR
 * * SECONDS_PER_MINUTE * MS_PER_SECOND` is one HOUR, so the value was 18,000,000
 * ms (5 h) — five times too long, contradicting the name and the intent. See
 * backlog §2.21.
 */
export const EXEC_TIMEOUT_MS = 5 * SECONDS_PER_MINUTE * MS_PER_SECOND;
const STDERR_RECORD_TRUNCATE_BYTES = 2000;

/**
 * The exit code recorded when there is no child status to record (killed, or
 * never spawned) — the same value the pre-fix `err.status ?? 1` collapsed to.
 */
const NO_CHILD_STATUS_EXIT_CODE = 1;

/**
 * What a task run produced, before it is folded into a `RunRecord`.
 * `killed` is deliberately a plain boolean here and an ABSENT key on the
 * record: `history.jsonl` rows that did not time out keep the exact byte shape
 * they had before rid 2026-10-01-cron-task-tree-kill-01.
 */
type TaskRun = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly killed: boolean;
};

function truncateStderr(text: string): string {
  return text.slice(0, STDERR_RECORD_TRUNCATE_BYTES);
}

/**
 * A `bin/peaks.js` can boot only if the build it imports is there: the shim does
 * `await import('../dist/cli/index.js')` relative to ITSELF (see `bin/peaks.js`).
 * Every git worktree and bare checkout has the entry WITHOUT that build, so an
 * existence test alone selects an entry that answers
 * `exitCode 1 / "peaks-loop: internal module not found — the local build is
 * stale or incomplete"` on every fire. Measured in
 * `tests/unit/cli/commands/cron-task-tree-kill.test.ts` (F1, repair cycle 1 of
 * rid 2026-10-01-cron-task-tree-kill-01).
 */
function isBootableTaskEntry(entry: string): boolean {
  return existsSync(entry) && existsSync(resolve(dirname(entry), '..', 'dist', 'cli', 'index.js'));
}

/**
 * The JS entry a task runs through.
 *
 * Two candidates, in this order, each a JS file spawned via `process.execPath`
 * with an argv ARRAY — never a shell. The pre-fix shape was
 * `execSync(\`peaks ${command} "${arg}"\`)`, which (a) put `cmd.exe` between the
 * scheduler and the task, so `execSync`'s timeout killed the SHELL and orphaned
 * the node grandchild (backlog §2.23, measured in diagnosis §9), and (b) relied
 * on hand-quoting arguments because `shell: true` concatenates rather than
 * escapes. This is the same shape `slice-check-service.ts` and
 * `npx-resolver.ts` settled on after measuring that a `.cmd` shim cannot be
 * spawned without a shell at all (EINVAL, Node 20+).
 *
 * The project's own entry wins so a task runs against the project it was
 * scheduled for; when the project root is not a BUILT peaks package
 * (`isBootableTaskEntry`) the running package's own entry takes the task, which
 * is what the pre-fix PATH `peaks` shim resolved to. `null` means neither can
 * boot — a loud fail-closed run, never work scheduled into a broken entry.
 */
function resolveTaskEntry(projectRoot: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [
    join(projectRoot, 'bin', 'peaks.js'),
    // dist/cli/commands/cron-commands.js → <package root>/bin/peaks.js
    resolve(here, '..', '..', '..', 'bin', 'peaks.js')
  ]) {
    if (isBootableTaskEntry(candidate)) return candidate;
  }
  return null;
}

/**
 * Fails CLOSED. There is no safe fallback spawn shape left to try: a `.cmd`
 * shim needs a shell, and a shell re-introduces the orphan this slice removes.
 * An entry that is missing OR unbuildable is therefore a loud non-zero run with
 * a naming stderr, never a task silently skipped.
 */
function unresolvedEntryRun(): TaskRun {
  return {
    exitCode: NO_CHILD_STATUS_EXIT_CODE,
    stderr: truncateStderr(
      'task not run: no bootable `bin/peaks.js` (one needs its `dist/cli/index.js`) in the project root or in this CLI package root'
    ),
    killed: false
  };
}

function isTimeoutError(err: Error): boolean {
  return (err as { code?: string }).code === 'ETIMEDOUT';
}

/**
 * Map a spawn outcome onto the record fields.
 *
 * A timeout is its OWN branch. The pre-fix code read `err.status ?? 1` and
 * `err.stderr ?? ''`, so a timed-out task — whose status is null — was recorded
 * as `exitCode 1, stderr ''`: a definite failure for work that, because the
 * shell had been killed and the task process left running, might still succeed.
 * `history.jsonl` consumers read `exitCode` + `stderr`, and both now say what
 * actually happened.
 */
function toTaskRun(result: SpawnSyncReturns<string>, timeoutMs: number): TaskRun {
  const childStderr = truncateStderr(result.stderr ?? '');
  const err = result.error;
  if (err !== undefined) {
    if (isTimeoutError(err)) {
      return {
        exitCode: NO_CHILD_STATUS_EXIT_CODE,
        stderr: truncateStderr(
          `killed: task exceeded its ${String(timeoutMs)} ms exec timeout and its process was killed${childStderr}`
        ),
        killed: true
      };
    }
    return {
      exitCode: NO_CHILD_STATUS_EXIT_CODE,
      stderr: truncateStderr(`${err.message}${childStderr}`),
      killed: false
    };
  }
  if (typeof result.status === 'number') {
    return {
      exitCode: result.status,
      stderr: result.status === 0 ? '' : childStderr,
      killed: false
    };
  }
  // No status and no timeout error ⇒ the task died on a signal from somewhere
  // else. That is still "killed", not "failed with exit 1".
  return {
    exitCode: NO_CHILD_STATUS_EXIT_CODE,
    stderr: truncateStderr(`killed: task died on signal ${String(result.signal)}`),
    killed: true
  };
}

export function runTask(
  projectRoot: string,
  task: ScheduleEntry,
  // Test seam only: defaults to EXEC_TIMEOUT_MS so every production caller
  // (`runTargets`, the scheduler loop) is byte-identical. This is NOT a
  // per-entry `timeoutMs` (deferred follow-up) and is not read from config;
  // it exists so a test can inject a short timeout and prove a stalled
  // child is reaped rather than inherited.
  timeoutMs: number = EXEC_TIMEOUT_MS
): RunRecord {
  const id = randomUUID();
  const startedAt = Date.now();
  const entry = resolveTaskEntry(projectRoot);
  const run =
    entry === null
      ? unresolvedEntryRun()
      : toTaskRun(
          spawnSync(process.execPath, [entry, task.command, ...task.args], {
            cwd: projectRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            timeout: timeoutMs,
            // The contract of this slice is that the task is GONE when
            // `runTask` returns; a kill signal the task can ignore would
            // reintroduce the ownerless survivor.
            killSignal: 'SIGKILL',
            windowsHide: true
          }),
          timeoutMs
        );
  const record: RunRecord = {
    id,
    taskId: task.id,
    startedAt,
    finishedAt: Date.now(),
    exitCode: run.exitCode,
    stderr: run.stderr,
    ...(run.killed ? { killed: true } : {})
  };
  appendHistory(projectRoot, record);
  return record;
}

export function registerCronCommand(program: Command, io: ProgramIO): void {
  const cmd = program
    .command('cron')
    .description(
      'Persistent scheduled tasks (Part 14; companion to peaks worktree / peaks container).'
    );

  addJsonOption(
    cmd
      .command('init')
      .description(
        'Create .peaks/cron/schedule.json with the built-in tasks (currently: lease-gc-daily). Idempotent.'
      )
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => handleCronInit(io, options));

  addJsonOption(
    cmd
      .command('list')
      .description('List all registered cron tasks + their due status (relative to now).')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => handleCronList(io, options));

  addJsonOption(
    cmd
      .command('run')
      .description(
        'Run the specified task (by id) immediately, update lastRunAt, append a history record.'
      )
      .option('--id <taskId>', 'task id to run (default: all due tasks)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { id?: string; project?: string; json?: boolean }) =>
    handleCronRun(io, options)
  );
}
