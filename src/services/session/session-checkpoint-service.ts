/**
 * `peaks session checkpoint` — slice 011.
 *
 * Writes a JSON snapshot of the current session's state to
 * `_runtime/<sessionId>/checkpoints/<iso-timestamp>.json`. Idempotent —
 * any number of checkpoints may exist; the service prunes the oldest
 * beyond `MAX_CHECKPOINTS` so the directory does not grow without bound.
 *
 * Designed for skill-level invocation (NG1). The LLM is the only one
 * that knows when context pressure is high; the CLI is the muscle.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { emitObservabilityEvent } from '../observability/observability-service.js';

const CHECKPOINTS_DIR = 'checkpoints';
const CHECKPOINT_FILENAME_EXT = '.json';
const MAX_CHECKPOINTS = 10;

export type CheckpointReason =
  | 'context-fill'
  | 'periodic'
  | 'artifact-written'
  | 'user-pause'
  | 'user-close';

export const CHECKPOINT_REASONS: readonly CheckpointReason[] = [
  'context-fill',
  'periodic',
  'artifact-written',
  'user-pause',
  'user-close'
] as const;

export interface CheckpointSnapshot {
  sessionId: string;
  lastActivity: string;
  currentPlan: string;
  openQuestions: string[];
  recentDecisions: string[];
  recentArtifactPaths: string[];
  gitStatus: string;
  skillsActive: string[];
  todoState: string[];
  reason: CheckpointReason;
  createdAt: string;
}

export interface CheckpointOptions {
  sessionId: string;
  reason: CheckpointReason;
  /** Injectable clock for deterministic tests. Returns ISO timestamp. */
  now?: () => Date;
  currentPlan?: string;
  openQuestions?: string[];
  recentDecisions?: string[];
  recentArtifactPaths?: string[];
  gitStatus?: string;
  skillsActive?: string[];
  todoState?: string[];
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function checkpointsDirPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId, CHECKPOINTS_DIR);
}

function isoTimestamp(d: Date): string {
  // Replace colons with dashes for filesystem safety. The full ISO is
  // preserved inside the JSON content; the filename uses a
  // filesystem-friendly form.
  return d.toISOString().replace(/[:.]/g, '-');
}

export function isValidCheckpointReason(value: string): value is CheckpointReason {
  return (CHECKPOINT_REASONS as readonly string[]).includes(value);
}

function readSessionLastActivity(projectRoot: string, sessionId: string): string {
  const sessionJsonPath = join(projectRoot, '.peaks', '_runtime', sessionId, 'session.json');
  if (!existsSync(sessionJsonPath)) return '';
  try {
    const raw = readFileSync(sessionJsonPath, 'utf8');
    const parsed = JSON.parse(raw) as { lastActivity?: string };
    return typeof parsed.lastActivity === 'string' ? parsed.lastActivity : '';
  } catch {
    return '';
  }
}

interface CheckpointListItem {
  path: string;
  createdAt: string;
  mtimeMs: number;
}

function listCheckpoints(dir: string): CheckpointListItem[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(CHECKPOINT_FILENAME_EXT))
    .map((e) => {
      const path = join(dir, e.name);
      const mtimeMs = statSync(path).mtimeMs;
      const stem = e.name.slice(0, -CHECKPOINT_FILENAME_EXT.length);
      return { path, createdAt: stem, mtimeMs };
    });
}

function pruneOldest(dir: string): string[] {
  const all = listCheckpoints(dir);
  if (all.length <= MAX_CHECKPOINTS) return [];
  all.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toRemove = all.slice(MAX_CHECKPOINTS);
  const removed: string[] = [];
  for (const item of toRemove) {
    rmSync(item.path, { force: true });
    removed.push(toPosix(item.path));
  }
  return removed;
}

export interface CheckpointWriteResult {
  path: string;
  sessionId: string;
  reason: CheckpointReason;
  createdAt: string;
  pruned: string[];
  totalRetained: number;
}

export function writeCheckpoint(
  projectRoot: string,
  options: CheckpointOptions
): CheckpointWriteResult {
  const now = (options.now ?? (() => new Date()))();
  const createdAt = now.toISOString();
  const lastActivity = readSessionLastActivity(projectRoot, options.sessionId) || createdAt;
  const dir = checkpointsDirPath(projectRoot, options.sessionId);
  mkdirSync(dir, { recursive: true });

  const snapshot: CheckpointSnapshot = {
    sessionId: options.sessionId,
    lastActivity,
    currentPlan: options.currentPlan ?? '',
    openQuestions: options.openQuestions ?? [],
    recentDecisions: options.recentDecisions ?? [],
    recentArtifactPaths: options.recentArtifactPaths ?? [],
    gitStatus: options.gitStatus ?? '',
    skillsActive: options.skillsActive ?? [],
    todoState: options.todoState ?? [],
    reason: options.reason,
    createdAt
  };

  const filename = `${isoTimestamp(now)}${CHECKPOINT_FILENAME_EXT}`;
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  // Slice C of v2.11.1 — observability hook #3/7. Fire-and-forget
  // per PRD Q4. The synchronous emit never throws.
  emitObservabilityEvent({
    schemaVersion: 1,
    ts: snapshot.createdAt,
    sessionId: snapshot.sessionId,
    category: 'checkpoint',
    detail: {
      reason: snapshot.reason,
      checkpointPath: toPosix(path),
      currentPlanLength: snapshot.currentPlan.length,
      openQuestionsCount: snapshot.openQuestions.length,
      recentDecisionsCount: snapshot.recentDecisions.length
    }
  }, { projectRoot });

  const pruned = pruneOldest(dir);
  const totalRetained = listCheckpoints(dir).length;

  return {
    path: toPosix(path),
    sessionId: options.sessionId,
    reason: options.reason,
    createdAt,
    pruned,
    totalRetained
  };
}

export function readCheckpoint(path: string): CheckpointSnapshot {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as CheckpointSnapshot;
}

export function listCheckpointPaths(projectRoot: string, sessionId: string): string[] {
  return listCheckpoints(checkpointsDirPath(projectRoot, sessionId))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((c) => toPosix(c.path));
}

export function latestCheckpointPath(projectRoot: string, sessionId: string): string | null {
  const paths = listCheckpointPaths(projectRoot, sessionId);
  return paths.length > 0 ? paths[0] ?? null : null;
}

export const CHECKPOINT_CONSTANTS = {
  CHECKPOINTS_DIR,
  CHECKPOINT_FILENAME_EXT,
  MAX_CHECKPOINTS
} as const;