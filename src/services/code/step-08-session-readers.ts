/**
 * Step 0.8 gate — the session's on-disk inputs.
 *
 * Extracted from `step-08-gate.ts` when the remedy exemption pushed that file
 * past the 300-line cap. Each reader answers ONE question about the session
 * directory; the gate keeps the decision.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isExpectedFsMiss } from '../../shared/fs-utils.js';

const STEP_08_PROGRESS_FILE_NAME = 'progress.json' as const;

export interface Step08Progress {
  readonly jobId: string;
  readonly done: number;
  readonly total: number;
  readonly currentSlice: string;
  readonly lastCommitSha: string | null;
  readonly updatedAt: string;
}

function runtimeSessionDir(projectRoot: string, sessionId: string): string {
  return join(projectRoot, '.peaks', '_runtime', sessionId);
}

function progressPath(projectRoot: string, sessionId: string, jid: string): string {
  // The progress file lives under job/<jid>/progress.json. The jid
  // comes from job-shape.json (decision.suggestedJobId) — there is
  // exactly one canonical jid per session under Job mode, so we read
  // the matching path directly rather than enumerating the job/ dir.
  // (Rotating mode spawns new jids but only one is "active" at a time;
  // the active jid is the latest write to job-shape.json.)
  return join(runtimeSessionDir(projectRoot, sessionId), 'job', jid, STEP_08_PROGRESS_FILE_NAME);
}

export function readProgressIfAny(
  projectRoot: string,
  sessionId: string,
  jid: string
): Step08Progress | null {
  const path = progressPath(projectRoot, sessionId, jid);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Step08Progress>;
    if (
      typeof parsed.jobId === 'string' &&
      typeof parsed.done === 'number' &&
      typeof parsed.total === 'number' &&
      typeof parsed.currentSlice === 'string' &&
      typeof parsed.updatedAt === 'string'
    ) {
      return {
        jobId: parsed.jobId,
        done: parsed.done,
        total: parsed.total,
        currentSlice: parsed.currentSlice,
        lastCommitSha: typeof parsed.lastCommitSha === 'string' ? parsed.lastCommitSha : null,
        updatedAt: parsed.updatedAt
      };
    }
    return null;
  } catch (err) {
    // P1 site (S6, 2026-09-15) — same correction as `readPromptFromLastPromptFile`
    // below: corrupt progress.json stays loud, and a failure that is not an
    // fs miss (module-load ReferenceError, TypeError from a bad field, …)
    // propagates instead of reading as "no progress yet".
    if (err instanceof SyntaxError) throw err;
    if (!isExpectedFsMiss(err)) throw err;
    return null;
  }
}

export function readPromptFromLastPromptFile(projectRoot: string, sessionId: string): string {
  const path = join(runtimeSessionDir(projectRoot, sessionId), 'txt', 'last-prompt.txt');
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    // P1 site (S6, 2026-09-15). This catch was bare — it bound nothing and
    // swallowed every error class. The sibling reads in this file had been
    // narrowed; this one had not, so the ONE path that feeds the step-08
    // backup regex was also the one that could not tell "no prompt file" from
    // "the module is broken". On the platform this gate exists for, that is
    // the difference between blocking a disavowal prompt and silently
    // allowing it. Missing/unreadable text is an empty prompt; anything else
    // propagates.
    if (!isExpectedFsMiss(err)) throw err;
    return '';
  }
}

/**
 * Job ids this session owns a ledger for, sorted.
 *
 * A ledger is `job/<jid>/state.json`, which only `peaks job init` writes, and
 * `job-shape.json` is written by `peaks code detect-job` and by nothing else —
 * so a ledger with no decision is the decision step having been skipped.
 */
export function ledgerJobIds(projectRoot: string, sessionId: string): string[] {
  const jobDir = join(runtimeSessionDir(projectRoot, sessionId), 'job');
  if (!existsSync(jobDir)) return [];
  let names: string[];
  try {
    names = readdirSync(jobDir);
  } catch (err) {
    if (!isExpectedFsMiss(err)) throw err;
    return [];
  }
  return names
    .filter((name) => existsSync(join(jobDir, name, 'state.json')))
    .sort((left, right) => left.localeCompare(right));
}
