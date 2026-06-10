import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isBareSid, isValidSessionId } from './sid-naming-guard.js';

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

// Placeholder for sub-agents clean — implemented in Task 7
export interface SubAgentInvalidPlan {
  invalid: string[];
  invalidSidFormat: string[];
}

const SUBAGENT_DIR = '_sub_agents';
const INVALID_ARCHIVE = '_archive/invalid-sids';

export function subAgentDirPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', SUBAGENT_DIR);
}

export function invalidSidsArchivePath(projectRoot: string): string {
  return join(projectRoot, '.peaks', INVALID_ARCHIVE);
}

export function listInvalidSubAgentSids(projectRoot: string): string[] {
  const dir = subAgentDirPath(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => isBareSid(name) || !isValidSessionId(name));
}

export function executeSubAgentClean(
  projectRoot: string,
  options: { apply: boolean }
): { moved: string[]; skipped: string[] } {
  const invalid = listInvalidSubAgentSids(projectRoot);
  const moved: string[] = [];
  if (options.apply && invalid.length > 0) {
    const archiveDir = invalidSidsArchivePath(projectRoot);
    mkdirSync(archiveDir, { recursive: true });
    for (const sid of invalid) {
      const from = join(subAgentDirPath(projectRoot), sid);
      const to = join(archiveDir, sid);
      if (existsSync(to)) {
        // collision — append timestamp suffix
        const stamped = `${sid}-${Date.now()}`;
        renameSync(from, join(archiveDir, stamped));
      } else {
        renameSync(from, to);
      }
      moved.push(sid);
    }
  }
  return { moved: options.apply ? moved : invalid, skipped: [] };
}