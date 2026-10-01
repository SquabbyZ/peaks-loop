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

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { getErrorMessage } from 'peaks-loop-shared/result';

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
 * `execSync(…, { timeout })`, so a task child that stalls is reaped within five
 * minutes rather than inherited. Fixed in rid 2026-10-01-cron-exec-timeout-01:
 * this constant previously read `5 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE *
 * MS_PER_SECOND`, and `MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND`
 * is one HOUR, so the value was 18,000,000 ms (5 h) — five times too long,
 * contradicting the name and the intent. See backlog §2.21.
 */
export const EXEC_TIMEOUT_MS = 5 * SECONDS_PER_MINUTE * MS_PER_SECOND;
const STDERR_RECORD_TRUNCATE_BYTES = 2000;

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
  let exitCode = 0;
  let stderr = '';
  try {
    execSync(
      `peaks ${task.command} ${task.args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`,
      {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: timeoutMs,
        windowsHide: true
      }
    );
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    exitCode = typeof e.status === 'number' ? e.status : 1;
    stderr = (e.stderr ?? getErrorMessage(err)).slice(0, STDERR_RECORD_TRUNCATE_BYTES);
  }
  const record: RunRecord = {
    id,
    taskId: task.id,
    startedAt,
    finishedAt: Date.now(),
    exitCode,
    stderr
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
