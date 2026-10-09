// src/cli/commands/cron-scheduler-shared.ts
//
// What every `peaks cron-scheduler *` verb shares: the tick period, the pid
// file, and the two questions asked of it (is there a pid, is it alive) plus
// where the detached child's entry shim lives. Split out of
// `cron-scheduler-commands.ts`; every path, probe and constant is unchanged.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEDULER_TICK_MS = 60_000; // 1 minute
export const PID_FILENAME = 'scheduler.pid';

export function schedulerPidPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', 'cron', PID_FILENAME);
}

export function readSchedulerPid(projectRoot: string): number | null {
  const p = schedulerPidPath(projectRoot);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, 'utf8').trim();
  const pid = Number.parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return pid;
}

export function isPidAlive(pid: number): boolean {
  try {
    // `process.kill(pid, 0)` does not actually kill; it just
    // checks if the process exists. ESRCH means no such pid;
    // EPERM means it exists but we don't have permission to
    // signal it (still alive).
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === 'EPERM';
  }
}

export function findSchedulerEntryPoint(): string {
  // The peaks-cron-scheduler.js entry shim lives in bin/ (not
  // dist/, so the pnpm build does not overwrite it). It forwards
  // to dist/cli/commands/cron-scheduler-commands.js with
  // PEAKS_CRON_SCHEDULER_DAEMON=1 set; the CLI detects the env
  // and runs runSchedulerLoop directly.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/cli/commands/cron-scheduler-commands.js → bin/peaks-cron-scheduler.js
  return resolve(here, '..', '..', '..', 'bin', 'peaks-cron-scheduler.js');
}
