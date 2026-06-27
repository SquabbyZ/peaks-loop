import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface RuntimeSessionInfo {
  sid: string;
  mtimeMs: number;
  ageHours: number;
}

export interface CleanupOptions {
  olderThanHours: number;
  graceHours: number;
}

export interface CleanupResult {
  deleted: string[];
  skipped: { sid: string; reason: string }[];
}

const RUNTIME_DIR = '_runtime';

export function runtimeDirPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', RUNTIME_DIR);
}

export function listRuntimeSessions(projectRoot: string): RuntimeSessionInfo[] {
  const dir = runtimeDirPath(projectRoot);
  if (!existsSync(dir)) return [];
  const now = Date.now();
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const sid = e.name;
      const fullPath = join(dir, sid);
      const stat = statSync(fullPath);
      const ageHours = (now - stat.mtimeMs) / (1000 * 3600);
      return { sid, mtimeMs: stat.mtimeMs, ageHours };
    });
}

export function planRuntimeCleanup(
  sessions: RuntimeSessionInfo[],
  options: CleanupOptions
): { eligible: string[]; skipped: { sid: string; reason: string }[] } {
  const eligible: string[] = [];
  const skipped: { sid: string; reason: string }[] = [];
  const cutoffHours = options.olderThanHours + options.graceHours;
  for (const s of sessions) {
    if (s.ageHours >= cutoffHours) {
      eligible.push(s.sid);
    } else {
      skipped.push({ sid: s.sid, reason: `fresh: age=${s.ageHours.toFixed(1)}h < cutoff=${cutoffHours}h` });
    }
  }
  return { eligible, skipped };
}

export function executeRuntimeCleanup(
  projectRoot: string,
  options: CleanupOptions & { apply: boolean }
): CleanupResult {
  const sessions = listRuntimeSessions(projectRoot);
  const plan = planRuntimeCleanup(sessions, options);
  if (options.apply) {
    const dir = runtimeDirPath(projectRoot);
    for (const sid of plan.eligible) {
      rmSync(join(dir, sid), { recursive: true, force: true });
    }
  }
  return { deleted: plan.eligible, skipped: plan.skipped };
}