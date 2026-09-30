/**
 * The schedule model half of `peaks cron` (Part 14) — moved VERBATIM out of
 * `cron-commands.ts` (job strict-remediation-abc, slice c1-eslint-family-sweep,
 * leaf c3w1-cron-commands) so that file clears the 300-line cap and the
 * `complexity` finding on `readSchedule` falls.
 *
 * NOTHING was restructured: same branch order, same predicates, same throw
 * points, same message text, same on-disk bytes. `readSchedule` was split into
 * `assertScheduleRoot` + `toScheduleEntry` + `isStringArray` only to shed the
 * complexity finding; every check still runs in the original order with the
 * original short-circuits.
 *
 * `runTask` (and its exec-timeout + record-truncation constants) deliberately
 * stays in `cron-commands.ts`: that file carries the baseline `no-magic-numbers`
 * warning on the timeout constant, and a new sibling must be clean outright.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEDULE_VERSION = 1 as const;
const SCHEDULE_FILENAME = 'schedule.json';
const HISTORY_FILENAME = 'history.jsonl';
/**
 * PRD-002b slice 2 — extract cron-orchestration magic numbers (24h
 * default interval, 5-minute exec timeout, stderr-message truncation
 * lengths in the renderer). The exec-timeout constant itself stayed in
 * `cron-commands.ts` with `runTask`.
 */
export const MS_PER_SECOND = 1_000;
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_MINUTE = 60;
const HOURS_PER_DAY = 24;
const DEFAULT_INTERVAL_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

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

export function schedulePath(projectRoot: string): string {
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
  const obj = assertScheduleRoot(parsed);
  if (!Array.isArray(obj.entries)) {
    throw new Error('schedule.json entries must be an array');
  }
  const entries: ScheduleEntry[] = [];
  for (const e of obj.entries) {
    const entry = toScheduleEntry(e);
    if (entry !== null) entries.push(entry);
  }
  return { version: SCHEDULE_VERSION, entries };
}

function assertScheduleRoot(parsed: unknown): {
  version?: number;
  entries?: ReadonlyArray<unknown>;
} {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('schedule.json root must be an object');
  }
  const obj = parsed as { version?: number; entries?: ReadonlyArray<unknown> };
  if (obj.version !== SCHEDULE_VERSION) {
    throw new Error(
      `schedule.json version mismatch (got ${String(obj.version)}, expected ${SCHEDULE_VERSION})`
    );
  }
  return obj;
}

function toScheduleEntry(e: unknown): ScheduleEntry | null {
  if (typeof e !== 'object' || e === null) return null;
  const ent = e as Record<string, unknown>;
  if (typeof ent.id !== 'string' || typeof ent.name !== 'string' || typeof ent.command !== 'string')
    return null;
  if (
    !isStringArray(ent.args) ||
    typeof ent.intervalMs !== 'number' ||
    typeof ent.createdAt !== 'number'
  )
    return null;
  return {
    id: ent.id,
    name: ent.name,
    command: ent.command,
    args: ent.args,
    intervalMs: ent.intervalMs,
    lastRunAt: typeof ent.lastRunAt === 'number' ? ent.lastRunAt : null,
    enabled: ent.enabled !== false,
    createdAt: ent.createdAt
  };
}

function isStringArray(a: unknown): a is ReadonlyArray<string> {
  return Array.isArray(a) && a.every((s) => typeof s === 'string');
}

export function writeSchedule(projectRoot: string, file: ScheduleFile): void {
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

export function ensureLeaseGcEntry(file: ScheduleFile): ScheduleFile {
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

export function listDueTasks(
  projectRoot: string,
  now: number = Date.now()
): ReadonlyArray<ScheduleEntry> {
  const file = readSchedule(projectRoot);
  return file.entries.filter((e) => {
    if (!e.enabled) return false;
    if (e.lastRunAt === null) return true;
    return now - e.lastRunAt >= e.intervalMs;
  });
}
