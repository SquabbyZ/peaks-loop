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
 *   - `lease-gc-daily` — runs `peaks worktree gc --all-sessions
 *     --project .` once every 24h. Cleans up orphan leases that
 *     leaked past their auto-release hook (Part 3.A) — the
 *     safety net for the safety net.
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
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

const SCHEDULE_VERSION = 1 as const;
const SCHEDULE_FILENAME = 'schedule.json';
const HISTORY_FILENAME = 'history.jsonl';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24h

export type ScheduleEntry = {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly intervalMs: number;
  readonly lastRunAt: number | null;
  readonly enabled: boolean;
  readonly createdAt: number;
};

export type ScheduleFile = {
  readonly version: typeof SCHEDULE_VERSION;
  readonly entries: ReadonlyArray<ScheduleEntry>;
};

export type RunRecord = {
  readonly id: string;
  readonly taskId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly exitCode: number;
  readonly stderr: string;
};

function cronDir(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'cron');
}

function schedulePath(projectRoot: string): string {
  return join(cronDir(projectRoot), SCHEDULE_FILENAME);
}

function historyPath(projectRoot: string): string {
  return join(cronDir(projectRoot), HISTORY_FILENAME);
}

export function readSchedule(projectRoot: string): ScheduleFile {
  const path = schedulePath(projectRoot);
  if (!existsSync(path)) return { version: SCHEDULE_VERSION, entries: [] };
  const raw = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`schedule.json malformed: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('schedule.json root must be an object');
  }
  const obj = parsed as { version?: number; entries?: ReadonlyArray<unknown> };
  if (obj.version !== SCHEDULE_VERSION) {
    throw new Error(`schedule.json version mismatch (got ${String(obj.version)}, expected ${SCHEDULE_VERSION})`);
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error('schedule.json entries must be an array');
  }
  const entries: ScheduleEntry[] = [];
  for (const e of obj.entries) {
    if (typeof e !== 'object' || e === null) continue;
    const ent = e as Record<string, unknown>;
    if (typeof ent.id !== 'string' || typeof ent.name !== 'string' || typeof ent.command !== 'string') continue;
    if (!Array.isArray(ent.args) || !ent.args.every((a) => typeof a === 'string')) continue;
    if (typeof ent.intervalMs !== 'number' || typeof ent.createdAt !== 'number') continue;
    entries.push({
      id: ent.id,
      name: ent.name,
      command: ent.command,
      args: ent.args as ReadonlyArray<string>,
      intervalMs: ent.intervalMs,
      lastRunAt: typeof ent.lastRunAt === 'number' ? ent.lastRunAt : null,
      enabled: ent.enabled !== false,
      createdAt: ent.createdAt
    });
  }
  return { version: SCHEDULE_VERSION, entries };
}

function writeSchedule(projectRoot: string, file: ScheduleFile): void {
  const dir = cronDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(schedulePath(projectRoot), `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

export function appendHistory(projectRoot: string, record: RunRecord): void {
  const dir = cronDir(projectRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = historyPath(projectRoot);
  const line = `${JSON.stringify(record)}\n`;
  if (!existsSync(path)) {
    writeFileSync(path, line, 'utf8');
  } else {
    // Append — small file, OK to read+write
    const existing = readFileSync(path, 'utf8');
    writeFileSync(path, existing + line, 'utf8');
  }
}

function ensureLeaseGcEntry(file: ScheduleFile): ScheduleFile {
  if (file.entries.some((e) => e.id === 'lease-gc-daily')) return file;
  const entry: ScheduleEntry = {
    id: 'lease-gc-daily',
    name: 'Daily lease listing — refresh the alive-lease set; operators run peaks worktree gc --lease-id <id> manually on stale entries',
    command: 'worktree',
    args: ['list'],
    intervalMs: DEFAULT_INTERVAL_MS,
    lastRunAt: null,
    enabled: true,
    createdAt: Date.now()
  };
  return { version: SCHEDULE_VERSION, entries: [...file.entries, entry] };
}

export function runTask(projectRoot: string, task: ScheduleEntry): RunRecord {
  const id = randomUUID();
  const startedAt = Date.now();
  let exitCode = 0;
  let stderr = '';
  try {
    execSync(`peaks ${task.command} ${task.args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 5 * 60_000
    });
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    exitCode = typeof e.status === 'number' ? e.status : 1;
    stderr = (e.stderr ?? getErrorMessage(err)).slice(0, 2000);
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

export function listDueTasks(projectRoot: string, now: number = Date.now()): ReadonlyArray<ScheduleEntry> {
  const file = readSchedule(projectRoot);
  return file.entries.filter((e) => {
    if (!e.enabled) return false;
    if (e.lastRunAt === null) return true;
    return now - e.lastRunAt >= e.intervalMs;
  });
}

export function registerCronCommand(program: Command, io: ProgramIO): void {
  const cmd = program
    .command('cron')
    .description('Persistent scheduled tasks (Part 14; companion to peaks worktree / peaks container).');

  addJsonOption(
    cmd.command('init')
      .description('Create .peaks/cron/schedule.json with the built-in tasks (currently: lease-gc-daily). Idempotent.')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => {
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
          { projectRoot, schedulePath: schedulePath(projectRoot), totalEntries: updated.entries.length, added },
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
        fail('cron.init', 'CRON_INIT_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
          'Verify the project root is a peaks-loop project (.peaks/ exists).',
          'Check filesystem permissions.'
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('list')
      .description('List all registered cron tasks + their due status (relative to now).')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { project?: string; json?: boolean }) => {
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
        ok('cron.list', { projectRoot, schedulePath: schedulePath(projectRoot), entries: annotated }, [], [
          `${annotated.length} task(s); ${annotated.filter((e) => e.due).length} due now.`
        ]),
        options.json
      );
    } catch (err) {
      printResult(
        io,
        fail('cron.list', 'CRON_LIST_FAILED', getErrorMessage(err), { projectRoot: options.project }, [
          "If schedule.json is missing, run 'peaks cron init' first."
        ]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    cmd.command('run')
      .description('Run the specified task (by id) immediately, update lastRunAt, append a history record.')
      .option('--id <taskId>', 'task id to run (default: all due tasks)')
      .option('--project <path>', 'project root (default: findProjectRoot(cwd))')
  ).action((options: { id?: string; project?: string; json?: boolean }) => {
    try {
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
      const records: RunRecord[] = [];
      const updatedEntries: ScheduleEntry[] = [];
      const now = Date.now();
      for (const task of file.entries) {
        if (!targets.some((t) => t.id === task.id)) {
          updatedEntries.push(task);
          continue;
        }
        const record = runTask(projectRoot, task);
        records.push(record);
        updatedEntries.push({ ...task, lastRunAt: record.finishedAt });
      }
      writeSchedule(projectRoot, { version: SCHEDULE_VERSION, entries: updatedEntries });
      printResult(
        io,
        ok(
          'cron.run',
          { projectRoot, ran: records.length, records },
          records.filter((r) => r.exitCode !== 0).map((r) => `Task ${r.taskId} failed (exit=${r.exitCode}): ${r.stderr.slice(0, 200)}`),
          [`Ran ${records.length} task(s); ${records.filter((r) => r.exitCode === 0).length} succeeded.`]
        ),
        options.json
      );
      if (records.some((r) => r.exitCode !== 0)) process.exitCode = 1;
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
  });
}
