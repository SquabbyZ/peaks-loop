/**
 * `peaks workspace consolidate` — slice 011.
 *
 * Cross-date session consolidation. For each `_runtime/<sessionId>/` whose
 * `session.json` `lastActivity` is older than `--older-than <days>` (default
 * 1, i.e. cross-date), move it to `_archive/retrospective-<YYYY-MM-DD>/<sessionId>/`
 * with a `manifest.json` describing what was moved. Atomic per-session: a
 * failure mid-move leaves the source untouched and no partial target.
 *
 * Designed for skill-level invocation, not direct user calls (NG1). The
 * dry-run by default mirrors the skill-first / CLI-auxiliary decision
 * template — the skill prompts the user before committing.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { isValidSessionId } from './sid-naming-guard.js';

const RUNTIME_DIR = '_runtime';
const ARCHIVE_DIR = '_archive';
const RETROSPECTIVE_PREFIX = 'retrospective-';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_OLDER_THAN_DAYS = 1;
const MANIFEST_FILENAME = 'manifest.json';

export interface ConsolidateOptions {
  apply: boolean;
  keep: ReadonlySet<string>;
  olderThanDays: number;
  /** Injectable for deterministic tests. ISO `YYYY-MM-DD`. */
  today: string;
}

export interface ConsolidatePlanEntry {
  sessionId: string;
  sourcePath: string;
  targetPath: string;
  lastActivity: string | null;
  reason: 'cross-date' | 'kept' | 'fresh' | 'invalid-sid' | 'missing-lastActivity' | 'no-source';
}

export interface ConsolidatePlan {
  dryRun: boolean;
  today: string;
  olderThanDays: number;
  keep: string[];
  candidates: ConsolidatePlanEntry[];
  moves: ConsolidatePlanEntry[];
  skipped: ConsolidatePlanEntry[];
}

export interface ConsolidateMoveResult {
  sessionId: string;
  from: string;
  to: string;
  manifestPath: string;
  filesMoved: number;
}

export interface ConsolidateResult {
  plan: ConsolidatePlan;
  moved: ConsolidateMoveResult[];
  rolledBack: string[];
  errors: Array<{ sessionId: string; error: string }>;
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function retrospectiveDir(projectRoot: string, today: string): string {
  return join(projectRoot, '.peaks', ARCHIVE_DIR, `${RETROSPECTIVE_PREFIX}${today}`);
}

function runtimeDirPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', RUNTIME_DIR);
}

function targetPath(projectRoot: string, today: string, sid: string): string {
  return join(retrospectiveDir(projectRoot, today), sid);
}

interface SessionJsonShape {
  sessionId?: string;
  lastActivity?: string;
  createdAt?: string;
}

async function readSessionJson(sidPath: string): Promise<SessionJsonShape | null> {
  const sessionJsonPath = join(sidPath, 'session.json');
  if (!existsSync(sessionJsonPath)) return null;
  try {
    const raw = await readFile(sessionJsonPath, 'utf8');
    return JSON.parse(raw) as SessionJsonShape;
  } catch {
    return null;
  }
}

function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later}T00:00:00Z`);
  const b = Date.parse(`${earlier}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((a - b) / MS_PER_DAY);
}

function listRuntimeSessionDirs(projectRoot: string): Array<{ sid: string; path: string }> {
  const dir = runtimeDirPath(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ sid: e.name, path: join(dir, e.name) }));
}

export async function planConsolidate(
  projectRoot: string,
  options: ConsolidateOptions
): Promise<ConsolidatePlan> {
  const keep = options.keep;
  const olderThanDays = options.olderThanDays;
  const today = options.today;
  const entries = listRuntimeSessionDirs(projectRoot);
  const candidates: ConsolidatePlanEntry[] = [];
  const moves: ConsolidatePlanEntry[] = [];
  const skipped: ConsolidatePlanEntry[] = [];

  for (const entry of entries) {
    const sourcePath = toPosix(entry.path);
    if (keep.has(entry.sid)) {
      const plan: ConsolidatePlanEntry = {
        sessionId: entry.sid,
        sourcePath,
        targetPath: toPosix(targetPath(projectRoot, today, entry.sid)),
        lastActivity: null,
        reason: 'kept'
      };
      candidates.push(plan);
      skipped.push(plan);
      continue;
    }
    if (!isValidSessionId(entry.sid)) {
      const plan: ConsolidatePlanEntry = {
        sessionId: entry.sid,
        sourcePath,
        targetPath: toPosix(targetPath(projectRoot, today, entry.sid)),
        lastActivity: null,
        reason: 'invalid-sid'
      };
      candidates.push(plan);
      skipped.push(plan);
      continue;
    }
    const meta = await readSessionJson(entry.path);
    if (!meta || typeof meta.lastActivity !== 'string') {
      const plan: ConsolidatePlanEntry = {
        sessionId: entry.sid,
        sourcePath,
        targetPath: toPosix(targetPath(projectRoot, today, entry.sid)),
        lastActivity: meta?.lastActivity ?? null,
        reason: 'missing-lastActivity'
      };
      candidates.push(plan);
      skipped.push(plan);
      continue;
    }
    const ageDays = daysBetween(today, meta.lastActivity.slice(0, 10));
    const lastActivity = meta.lastActivity;
    if (ageDays < olderThanDays) {
      const plan: ConsolidatePlanEntry = {
        sessionId: entry.sid,
        sourcePath,
        targetPath: toPosix(targetPath(projectRoot, today, entry.sid)),
        lastActivity,
        reason: 'fresh'
      };
      candidates.push(plan);
      skipped.push(plan);
      continue;
    }
    const plan: ConsolidatePlanEntry = {
      sessionId: entry.sid,
      sourcePath,
      targetPath: toPosix(targetPath(projectRoot, today, entry.sid)),
      lastActivity,
      reason: 'cross-date'
    };
    candidates.push(plan);
    moves.push(plan);
  }

  return {
    dryRun: !options.apply,
    today,
    olderThanDays,
    keep: Array.from(keep).sort(),
    candidates,
    moves,
    skipped
  };
}

function listRelativeFiles(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const stack: string[] = [''];
  while (stack.length > 0) {
    const rel = stack.pop();
    if (rel === undefined) break;
    const abs = join(dir, rel);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      for (const name of readdirSync(abs)) {
        stack.push(join(rel, name));
      }
    } else if (stat.isFile()) {
      out.push(rel.split(sep).join('/'));
    }
  }
  void prefix;
  return out.sort();
}

async function moveSessionAtomic(
  projectRoot: string,
  entry: ConsolidatePlanEntry,
  today: string,
  reason: string
): Promise<ConsolidateMoveResult> {
  const target = targetPath(projectRoot, today, entry.sessionId);
  const parent = join(target, '..');
  mkdirSync(parent, { recursive: true });
  // Pre-rename guard (plan-3a Task 4.6): on Windows, MoveFileExW will
  // replace an existing non-directory at `target` with the source
  // directory, silently losing whatever was at `target`. POSIX
  // rename(2) throws EEXIST in the same situation. We want identical
  // semantics on every host: a non-directory at the target path is a
  // hard collision — surface it as an explicit error so the source is
  // left untouched and the catch block above rolls back, rather than
  // silently destroying whatever was at `target`.
  if (existsSync(target) && !statSync(target).isDirectory()) {
    throw new Error(
      `consolidate target collision: ${target} exists and is not a directory; refusing to overwrite`
    );
  }
  renameSync(entry.sourcePath, target);
  try {
    const fileList = listRelativeFiles(target, '');
    const manifest = {
      sessionId: entry.sessionId,
      originalLastActivity: entry.lastActivity,
      originalCreatedAt: null as string | null,
      archivedAt: `${today}T00:00:00Z`,
      archiveReason: reason,
      reason: 'cross-date consolidate',
      fileCount: fileList.length,
      fileList
    };
    const sessionJsonPath = join(target, 'session.json');
    if (existsSync(sessionJsonPath)) {
      try {
        const raw = await readFile(sessionJsonPath, 'utf8');
        const parsed = JSON.parse(raw) as { createdAt?: string };
        if (typeof parsed.createdAt === 'string') {
          manifest.originalCreatedAt = parsed.createdAt;
        }
      } catch {
        // Non-fatal: manifest is informational.
      }
    }
    const manifestPath = join(target, MANIFEST_FILENAME);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return {
      sessionId: entry.sessionId,
      from: entry.sourcePath,
      to: toPosix(target),
      manifestPath: toPosix(manifestPath),
      filesMoved: fileList.length
    };
  } catch (error) {
    try {
      renameSync(target, entry.sourcePath);
    } catch {
      try {
        rmSync(target, { recursive: true, force: true });
      } catch {
        // Last-resort cleanup; surface the original error.
      }
    }
    throw error;
  }
}

export async function executeConsolidate(
  projectRoot: string,
  options: ConsolidateOptions
): Promise<ConsolidateResult> {
  const plan = await planConsolidate(projectRoot, options);
  const moved: ConsolidateMoveResult[] = [];
  const rolledBack: string[] = [];
  const errors: Array<{ sessionId: string; error: string }> = [];

  if (!options.apply) {
    return { plan, moved, rolledBack, errors };
  }

  mkdirSync(retrospectiveDir(projectRoot, options.today), { recursive: true });

  for (const entry of plan.moves) {
    try {
      const result = await moveSessionAtomic(projectRoot, entry, options.today, entry.reason);
      moved.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ sessionId: entry.sessionId, error: message });
      if (existsSync(entry.sourcePath)) {
        rolledBack.push(entry.sessionId);
      }
    }
  }

  return { plan, moved, rolledBack, errors };
}

export const CONSOLIDATE_CONSTANTS = {
  RUNTIME_DIR,
  ARCHIVE_DIR,
  RETROSPECTIVE_PREFIX,
  DEFAULT_OLDER_THAN_DAYS,
  MANIFEST_FILENAME
} as const;