/**
 * v2.11.0 Group F (Tier 9) — D7: post-compact auto-resume detector.
 *
 * Per `.peaks/memory/2026-06-26-v2-11-post-compact-resume.md` §D7.a,
 * post-compact auto-resume triggers when ALL of the following hold:
 *
 *   1. `.peaks/_runtime/<sessionId>/` is bound
 *   2. Latest checkpoint mtime is from today (UTC date)
 *   3. Latest checkpoint has a parseable `mode` field
 *   4. The peak-code skill is the active skill
 *   5. Exactly one session has a today's checkpoint (no ambiguity)
 *
 * On a hit, the LLM MUST auto-resume (D7.b override of "never silently
 * auto-resume") and emit a one-line log entry. On any miss, fall
 * through to the normal Step 0.7 flow.
 *
 * Karpathy §3: the detector is the only place that decides "is this
 * a post-compact resume?" — no inline `isPostCompact()` checks
 * scattered across SKILL.md or other services.
 *
 * IO: readdir + readFile on `.peaks/_runtime/<sid>/checkpoints/`.
 * No writes (caller logs the decision via the auto-decisions channel).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getSkillPresence } from '../skills/skill-presence-service.js';
import type { SkillPresenceMode } from '../skills/skill-presence-service.js';

import { emitObservabilityEvent } from '../observability/observability-service.js';

import { isCodeMode, type CodeMode } from './mode-gate.js';

export type PostCompactResumeReason =
  | 'post-compact-match'
  | 'sid-unbound'
  | 'runtime-dir-missing'
  | 'no-checkpoint-today'
  | 'no-mode-field'
  | 'stale-checkpoint'
  | 'multiple-checkpoints-ambiguous'
  | 'active-skill-mismatch'
  | 'checkpoint-read-failed';

export const POST_COMPACT_RESUME_REASONS: readonly PostCompactResumeReason[] = [
  'post-compact-match',
  'sid-unbound',
  'runtime-dir-missing',
  'no-checkpoint-today',
  'no-mode-field',
  'stale-checkpoint',
  'multiple-checkpoints-ambiguous',
  'active-skill-mismatch',
  'checkpoint-read-failed'
] as const;

export interface PostCompactResumeProbe {
  readonly shouldAutoResume: boolean;
  readonly reason: PostCompactResumeReason;
  readonly mode?: CodeMode;
  readonly checkpointPath?: string;
  readonly checkpointMtime?: string;
  readonly task?: string;
  readonly openQuestions?: readonly string[];
  readonly recentDecisions?: readonly string[];
  readonly warnings: readonly string[];
}

export interface DetectPostCompactResumeOptions {
  readonly sessionId: string;
  readonly projectRoot: string;
  /** Injectable clock for deterministic tests; defaults to `new Date()`. */
  readonly now?: (() => Date) | undefined;
  /** Override the active-skill check (test seam; defaults to read presence). */
  readonly activeSkill?: string | undefined;
  /** Override mode read from presence (test seam). */
  readonly presenceModeOverride?: SkillPresenceMode | undefined;
}

const CHECKPOINTS_DIR = 'checkpoints';
const CHECKPOINT_EXT = '.json';

interface CheckpointFile {
  readonly path: string;
  readonly mtime: Date;
  readonly content: CheckpointContent;
}

interface CheckpointContent {
  readonly currentPlan?: string;
  readonly openQuestions?: readonly string[];
  readonly recentDecisions?: readonly string[];
  readonly mode?: string;
}

function isToday(d: Date, now: Date): boolean {
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function safeReadCheckpoint(absPath: string): CheckpointFile | null {
  try {
    const stat = statSync(absPath);
    const raw = readFileSync(absPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const mutable: {
      currentPlan?: string;
      openQuestions?: readonly string[];
      recentDecisions?: readonly string[];
      mode?: string;
    } = {};
    if (typeof parsed['currentPlan'] === 'string') {
      mutable.currentPlan = parsed['currentPlan'];
    }
    if (Array.isArray(parsed['openQuestions'])) {
      mutable.openQuestions = (parsed['openQuestions'] as unknown[]).filter(
        (q): q is string => typeof q === 'string'
      );
    }
    if (Array.isArray(parsed['recentDecisions'])) {
      mutable.recentDecisions = (parsed['recentDecisions'] as unknown[]).filter(
        (d): d is string => typeof d === 'string'
      );
    }
    if (typeof parsed['mode'] === 'string') {
      mutable.mode = parsed['mode'];
    }
    const content: CheckpointContent = mutable;
    return { path: absPath, mtime: stat.mtime, content };
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function readLatestTodayCheckpoint(
  runtimeDir: string,
  now: Date
): { found: 'none' } | { found: 'today'; file: CheckpointFile } | { found: 'multiple'; files: readonly CheckpointFile[] } {
  const dir = join(runtimeDir, CHECKPOINTS_DIR);
  if (!existsSync(dir)) {
    return { found: 'none' };
  }
  const todayFiles: CheckpointFile[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(CHECKPOINT_EXT)) continue;
    const abs = join(dir, entry);
    const file = safeReadCheckpoint(abs);
    if (file === null) continue;
    if (isToday(file.mtime, now)) {
      todayFiles.push(file);
    }
  }
  if (todayFiles.length === 0) {
    return { found: 'none' };
  }
  if (todayFiles.length > 1) {
    todayFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const newest = todayFiles[0];
    if (newest === undefined) {
      return { found: 'none' };
    }
    const tieCount = todayFiles.filter((f) => f.mtime.getTime() === newest.mtime.getTime()).length;
    if (tieCount > 1) {
      return { found: 'multiple', files: todayFiles };
    }
    return { found: 'today', file: newest };
  }
  const only = todayFiles[0];
  if (only === undefined) {
    return { found: 'none' };
  }
  return { found: 'today', file: only };
}

/**
 * Detect whether the current invocation is a same-day post-compact
 * resume. The LLM-side caller invokes this in Step 0.7 / Step 0.75
 * after anchoring. Pure-ish: only filesystem reads of the checkpoint
 * dir; no LLM calls.
 */
export async function detectPostCompactResume(
  opts: DetectPostCompactResumeOptions
): Promise<PostCompactResumeProbe> {
  const now = opts.now ?? ((): Date => new Date());
  const warnings: string[] = [];

  if (!opts.sessionId || opts.sessionId.trim().length === 0) {
    return { shouldAutoResume: false, reason: 'sid-unbound', warnings };
  }

  const runtimeDir = join(opts.projectRoot, '.peaks', '_runtime', opts.sessionId);
  if (!existsSync(runtimeDir)) {
    return { shouldAutoResume: false, reason: 'runtime-dir-missing', warnings };
  }

  const probe = readLatestTodayCheckpoint(runtimeDir, now());
  if (probe.found === 'multiple') {
    return {
      shouldAutoResume: false,
      reason: 'multiple-checkpoints-ambiguous',
      warnings: [`${probe.files.length} sessions have today's checkpoint; ambiguous`]
    };
  }
  if (probe.found === 'none') {
    return { shouldAutoResume: false, reason: 'no-checkpoint-today', warnings };
  }

  const file = probe.file;
  const checkpointMode = file.content.mode;
  if (checkpointMode === undefined) {
    return {
      shouldAutoResume: false,
      reason: 'no-mode-field',
      checkpointPath: file.path,
      checkpointMtime: file.mtime.toISOString(),
      warnings
    };
  }

  // Active skill check (D7.a.4). Defaults to reading from skill presence.
  const expectedActiveSkill = 'peaks-code';
  const observedActiveSkill = opts.activeSkill ?? readActiveSkillName(opts.projectRoot);
  if (observedActiveSkill !== expectedActiveSkill) {
    return {
      shouldAutoResume: false,
      reason: 'active-skill-mismatch',
      checkpointPath: file.path,
      checkpointMtime: file.mtime.toISOString(),
      warnings: [`active skill "${observedActiveSkill ?? 'unset'}" is not peaks-code`]
    };
  }

  // Mode: prefer the checkpoint's mode; fall back to the presence override
  // (test seam) or to a fresh skill-presence read.
  let mode: CodeMode | undefined;
  if (isCodeMode(checkpointMode)) {
    mode = checkpointMode;
  } else if (opts.presenceModeOverride !== undefined) {
    mode = opts.presenceModeOverride;
  } else {
    try {
      const presence = getSkillPresence(opts.projectRoot);
      const presenceMode = presence?.mode;
      if (presenceMode !== undefined && isCodeMode(presenceMode)) {
        mode = presenceMode;
      }
    } catch (err) {
      warnings.push(`presence read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (mode === undefined) {
    return {
      shouldAutoResume: false,
      reason: 'no-mode-field',
      checkpointPath: file.path,
      checkpointMtime: file.mtime.toISOString(),
      warnings
    };
  }

  const successProbe: PostCompactResumeProbe = {
    shouldAutoResume: true,
    reason: 'post-compact-match',
    mode,
    checkpointPath: file.path,
    checkpointMtime: file.mtime.toISOString(),
    ...(file.content.currentPlan !== undefined ? { task: file.content.currentPlan } : {}),
    ...(file.content.openQuestions !== undefined ? { openQuestions: file.content.openQuestions } : {}),
    ...(file.content.recentDecisions !== undefined ? { recentDecisions: file.content.recentDecisions } : {}),
    warnings
  };
  emitPostCompactEvent({ projectRoot: opts.projectRoot, sessionId: opts.sessionId, probe: successProbe });
  return successProbe;
}

// Slice C of v2.11.1 — observability hook #6/7. Fire-and-forget per
// PRD Q4. The synchronous emit never throws and never blocks the
// detector return value.
function emitPostCompactEvent(opts: {
  projectRoot: string;
  sessionId: string;
  probe: PostCompactResumeProbe;
}): void {
  emitObservabilityEvent({
    schemaVersion: 1,
    ts: new Date().toISOString(),
    sessionId: opts.sessionId,
    category: 'post-compact',
    detail: {
      shouldAutoResume: opts.probe.shouldAutoResume,
      reason: opts.probe.reason,
      ...(opts.probe.mode !== undefined ? { mode: opts.probe.mode } : {}),
      ...(opts.probe.checkpointPath !== undefined ? { checkpointPath: opts.probe.checkpointPath } : {})
    }
  }, { projectRoot: opts.projectRoot });
}

function readActiveSkillName(projectRoot: string): string | undefined {
  try {
    const presence = getSkillPresence(projectRoot);
    return presence?.skill;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return undefined;
  }
}

/**
 * One-line auto-decisions log entry. Pure formatter; no IO. The LLM
 * appends to `.peaks/_runtime/<sessionId>/txt/auto-decisions.md` so
 * the existing audit channel picks it up (D7.e).
 */
export function formatPostCompactResumeLogLine(probe: PostCompactResumeProbe): string {
  if (!probe.shouldAutoResume) {
    return `post-compact skip: reason=${probe.reason}`;
  }
  return `post-compact resume: ${probe.task ?? 'unspecified'} mode=${probe.mode ?? 'unknown'} checkpoint=${probe.checkpointPath ?? 'unknown'}`;
}
