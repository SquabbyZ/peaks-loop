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
 *        matching `job/<jid>/progress.json` exists, also print the
 *        next-slice sentence from `describeNextSlice` — `Next: slice #N of M
 *        (<label>)` while a slice is pending, the `add-slice` remedy when none is
 *        — so the LLM sees its resume context BEFORE any Bash call lands.
 *   2. `job-shape.json` exists with `decision.isJob === false`.
 *      → allow, print `{ ok, allow, mode: 'single' }`.
 *   3. `job-shape.json` is MISSING. Every answer here is about the decision
 *      that was never recorded, not about the prompt:
 *        a. the backup regex matches the prompt → block (exit 2) with the
 *           BLOCKED: stderr message.
 *        b. no regex match, but the session owns a Job ledger
 *           (`job/<jid>/state.json` exists) → block (exit 2). `peaks job
 *           init` ran and `peaks code detect-job` did not.
 *        c. no regex match and no ledger → allow (exit 0), reporting that NO
 *           decision was recorded. The absence of a judgement is stated as an
 *           absence, not as a judgement that the prompt is not Job-shaped.
 *      The gate never blocks on the ABSENCE of a decision alone: it runs on
 *      every Bash call in every session, so a normal non-Job session must
 *      keep passing through case (c).
 *
 * Karpathy §2 (Simplicity First): no LLM call inside. The regex is the FIRST
 * time peaks-loop accepts hardcoded keywords — explicitly scoped as a
 * *fail-closed backup* (case 3), NOT a primary judgement. The LLM still owns
 * the semantic call via `peaks code detect-job`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  readJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED
} from './job-shape-decision.js';
import { describeNextSlice } from '../job/job-progress-store.js';
import { isExpectedFsMiss } from '../../shared/fs-utils.js';

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
export const STEP_08_BACKUP_REGEX =
  /直到|全部|until all done|disavow cost|不用考虑费用|all of them/i;

export interface Step08Progress {
  readonly jobId: string;
  readonly done: number;
  readonly total: number;
  readonly currentSlice: string;
  readonly lastCommitSha: string | null;
  readonly updatedAt: string;
}

export type Step08PromptSource = 'flag' | 'last-prompt-file' | 'stdin-empty';

export type Step08Verdict =
  | {
      readonly kind: 'allow-job';
      readonly decision: import('./job-shape-decision.js').JobShapeDecision;
      readonly progress: Step08Progress | null;
    }
  | { readonly kind: 'allow-single' }
  | {
      readonly kind: 'block-missing-decision';
      readonly promptSource: Step08PromptSource;
    }
  | {
      readonly kind: 'allow-no-decision-recorded';
      readonly promptSource: Step08PromptSource;
      readonly reason: string;
    }
  | {
      readonly kind: 'block-no-decision-with-ledger';
      readonly ledgerJobIds: readonly string[];
      readonly reason: string;
    };

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

function readProgressIfAny(
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

function readPromptFromLastPromptFile(projectRoot: string, sessionId: string): string {
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
function ledgerJobIds(projectRoot: string, sessionId: string): string[] {
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
 * The reason a Job ledger with no decision is refused — it names both commands,
 * so the reader sees WHICH step was skipped.
 */
function noDecisionWithLedgerReason(ledger: readonly string[]): string {
  const paths = ledger.map((jid) => `job/${jid}/state.json`).join(', ');
  return (
    `No Job-shape decision was recorded for this session, but it owns a Job ledger (${paths}). ` +
    'That means `peaks job init` ran and `peaks code detect-job` did not, so every ' +
    'Job-mode step this gate keys on was skipped. Record the verdict with ' +
    '`peaks code detect-job --is-job true|false ...`, then retry.'
  );
}

/** Pure evaluator — does NOT write, does NOT exit. The CLI wrapper reads `allow`. */
export function evaluateStep08(input: EvaluateStep08Input): EvaluateStep08Result {
  try {
    const record = readJobShapeDecision(input.projectRoot, input.sessionId);
    if (record.decision.isJob) {
      const progress = readProgressIfAny(
        input.projectRoot,
        input.sessionId,
        record.decision.suggestedJobId
      );
      const nextSliceLine =
        progress !== null ? `Next: ${describeNextSlice(progress, progress.jobId)}` : null;
      return {
        allow: true,
        verdict: { kind: 'allow-job', decision: record.decision, progress },
        nextSliceLine
      };
    }
    return { allow: true, verdict: { kind: 'allow-single' }, nextSliceLine: null };
  } catch (err) {
    if (err instanceof JobShapeDecisionError && err.code === JOB_SHAPE_NOT_DECIDED) {
      return decideWithoutJobShapeDecision(input);
    }
    throw err;
  }
}

/** `job-shape.json` is missing — see the module header for the three answers. */
function decideWithoutJobShapeDecision(input: EvaluateStep08Input): EvaluateStep08Result {
  const promptText =
    input.prompt ?? readPromptFromLastPromptFile(input.projectRoot, input.sessionId);
  const promptSource: Step08PromptSource =
    input.prompt !== undefined
      ? 'flag'
      : promptText.length > 0
        ? 'last-prompt-file'
        : 'stdin-empty';
  if (promptText.length > 0 && STEP_08_BACKUP_REGEX.test(promptText)) {
    return {
      allow: false,
      verdict: { kind: 'block-missing-decision', promptSource },
      nextSliceLine: null
    };
  }
  const ledger = ledgerJobIds(input.projectRoot, input.sessionId);
  if (ledger.length > 0) {
    return {
      allow: false,
      verdict: {
        kind: 'block-no-decision-with-ledger',
        ledgerJobIds: ledger,
        reason: noDecisionWithLedgerReason(ledger)
      },
      nextSliceLine: null
    };
  }
  return {
    allow: true,
    verdict: {
      kind: 'allow-no-decision-recorded',
      promptSource,
      reason:
        'No Job-shape decision was recorded for this session and no Job ledger exists, ' +
        'so this gate has no Job-shape judgement to report. It allows, and names the ' +
        'absence of the decision rather than claiming the prompt is not Job-shaped.'
    },
    nextSliceLine: null
  };
}
