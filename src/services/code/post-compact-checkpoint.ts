/**
 * `src/services/code/post-compact-checkpoint.ts`
 *
 * The checkpoint read layer behind the post-compact auto-resume detector
 * (`post-compact-detector.ts`): the two directory/name constants, the
 * checkpoint record shapes, the same-day test, and the defensive single-file
 * read. Moved verbatim (wave 3, file-size cap campaign) so the detector stays
 * under the 300 raw-line cap — no detection decision lives here. These names
 * were module-private to the detector before the move and stay private to it
 * in effect: the detector imports them and does not re-export them, so the
 * module's public surface is unchanged.
 */

import { readFileSync, statSync } from 'node:fs';

import { isExpectedFsMiss } from '../../shared/fs-utils.js';

export const CHECKPOINTS_DIR = 'checkpoints';
export const CHECKPOINT_EXT = '.json';

export interface CheckpointFile {
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

export function isToday(d: Date, now: Date): boolean {
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

export function safeReadCheckpoint(absPath: string): CheckpointFile | null {
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
  } catch (err) {
    // P1 site (S6, 2026-09-15). The TODO(g2) marker this replaces said the
    // catch "narrows to IO errors only" — it did not. It rethrew the two JS
    // error classes it happened to name and swallowed everything else,
    // including the ReferenceError an ESM `require()` bug produces on the one
    // platform this file's whole defence exists for. Corrupt JSON stays loud
    // (we cannot read a checkpoint we cannot parse); every non-fs-miss error
    // now propagates. See `isExpectedFsMiss`.
    if (err instanceof SyntaxError) throw err;
    if (!isExpectedFsMiss(err)) throw err;
    return null;
  }
}
