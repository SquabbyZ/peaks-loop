/**
 * v3.1.2 Step 0.8 — Mechanical PreToolUse gate.
 *
 * Wire-installed by `peaks workspace init` (extends the existing hook
 * installer; does NOT replace the Write|Edit|MultiEdit fact-forcing
 * bypass). The hook runs `peaks code gate-step-08 --project .` before
 * every Bash tool call. Exit code is the load-bearing contract:
 *
 *   exit 0 → allow (with structured stdout describing the decision)
 *   exit 2 → block (stderr contains the BLOCKED: ... reason)
 *
 * Three decision paths:
 *
 *   1. `job-shape.json` exists with `decision.isJob === true`.
 *      → allow, print `{ ok, allow, mode: 'job', decision }`. When a
 *        matching `job/<jid>/progress.json` exists, also print
 *        `Next: slice #<N+1> of <M> (<currentSlice>)` so the LLM sees
 *        its resume context BEFORE any Bash call lands.
 *   2. `job-shape.json` exists with `decision.isJob === false`.
 *      → allow, print `{ ok, allow, mode: 'single' }`.
 *   3. `job-shape.json` is MISSING — fail-closed guard. The LLM is the
 *      source of truth, but if it never recorded a decision we run a
 *      lightweight backup regex against the user's prompt:
 *        /until|全部|until all done|disavow cost|不用考虑费用|all of them/i
 *      match → block (exit 2) with the BLOCKED: stderr message.
 *      no match → allow (exit 0) — most prompts are not Job-shaped.
 *
 * Karpathy §2 (Simplicity First): ~120 lines, no LLM call inside. The
 * regex is the FIRST time peaks-loop accepts hardcoded keywords —
 * explicitly scoped as a *fail-closed backup* (case 3), NOT a primary
 * judgement. The LLM still owns the semantic call via
 * `peaks code detect-job`. The regex is a safety net for the v3.1.1
 * incident class (LLM under load never records the decision at all).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  readJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED
} from './job-shape-decision.js';

export const STEP_08_GATE_FILE_NAME = 'job-shape.json' as const;
export const STEP_08_PROGRESS_FILE_NAME = 'progress.json' as const;

/**
 * Fail-closed backup regex — see module docstring case 3 for why this
 * exists. Kept short and explicit; if the prompt mentions any of these
 * triggers and `job-shape.json` is missing, the LLM is treated as
 * having skipped `peaks code detect-job` and the gate blocks.
 *
 * The list mirrors the v3.1.0 / v3.1.1 incident triggers verbatim:
 *   继续执行下个 slice (until next slice) → until / 直到
 *   全部添加完 / all of them            → 全部 / all of them
 *   不用考虑费用                        → 不用考虑费用 / disavow cost
 *   until all done                      → until all done
 */
export const STEP_08_BACKUP_REGEX = /直到|全部|until all done|disavow cost|不用考虑费用|all of them/i;

export interface Step08Progress {
  readonly jobId: string;
  readonly done: number;
  readonly total: number;
  readonly currentSlice: string;
  readonly lastCommitSha: string | null;
  readonly updatedAt: string;
}

export type Step08Verdict =
  | { readonly kind: 'allow-job'; readonly decision: import('./job-shape-decision.js').JobShapeDecision; readonly progress: Step08Progress | null }
  | { readonly kind: 'allow-single' }
  | { readonly kind: 'block-missing-decision'; readonly promptHit: boolean; readonly promptSource: 'flag' | 'last-prompt-file' | 'stdin-empty' };

export function runtimeSessionDir(projectRoot: string, sessionId: string): string {
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

function readProgressIfAny(projectRoot: string, sessionId: string, jid: string): Step08Progress | null {
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
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function readPromptFromLastPromptFile(projectRoot: string, sessionId: string): string {
  const path = join(runtimeSessionDir(projectRoot, sessionId), 'txt', 'last-prompt.txt');
  if (!existsSync(path)) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

export interface EvaluateStep08Input {
  readonly projectRoot: string;
  readonly sessionId: string;
  /**
   * Explicit prompt text. When omitted, falls back to
   * `.peaks/_runtime/<sid>/txt/last-prompt.txt`, then to stdin (the
   * caller passes stdin verbatim — usually empty in tests).
   */
  readonly prompt?: string;
}

export interface EvaluateStep08Result {
  readonly allow: boolean;
  readonly verdict: Step08Verdict;
  readonly nextSliceLine: string | null;
}

/**
 * Pure evaluator — does NOT write, does NOT exit. CLI wrapper in
 * `src/cli/commands/code-commands.ts` reads `allow` to set the process
 * exit code (0 allow / 2 block) and prints the structured envelope.
 */
export function evaluateStep08(input: EvaluateStep08Input): EvaluateStep08Result {
  try {
    const record = readJobShapeDecision(input.projectRoot, input.sessionId);
    if (record.decision.isJob) {
      const progress = readProgressIfAny(input.projectRoot, input.sessionId, record.decision.suggestedJobId);
      const nextSliceLine = progress !== null
        ? `Next: slice #${progress.done + 1} of ${progress.total} (${progress.currentSlice})`
        : null;
      return {
        allow: true,
        verdict: { kind: 'allow-job', decision: record.decision, progress },
        nextSliceLine
      };
    }
    return { allow: true, verdict: { kind: 'allow-single' }, nextSliceLine: null };
  } catch (err) {
    if (err instanceof JobShapeDecisionError && err.code === JOB_SHAPE_NOT_DECIDED) {
      const promptText = input.prompt ?? readPromptFromLastPromptFile(input.projectRoot, input.sessionId);
      const hit = promptText.length > 0 && STEP_08_BACKUP_REGEX.test(promptText);
      const source: 'flag' | 'last-prompt-file' | 'stdin-empty' =
        input.prompt !== undefined ? 'flag' : promptText.length > 0 ? 'last-prompt-file' : 'stdin-empty';
      if (hit) {
        return { allow: false, verdict: { kind: 'block-missing-decision', promptHit: true, promptSource: source }, nextSliceLine: null };
      }
      return { allow: true, verdict: { kind: 'block-missing-decision', promptHit: false, promptSource: source }, nextSliceLine: null };
    }
    throw err;
  }
}