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
 *      Before any of a–c, one exemption: when the hook payload's command is a
 *      real `peaks code detect-job` invocation, the gate allows with
 *      `allow-remedy-command`. The printed remedy is itself a Bash call, so a
 *      gate that blocks it deadlocks the session that needs it. The parse is
 *      narrow — a leading env assignment is allowed, the executable tokens
 *      must be `peaks`, `code`, `detect-job` in order, and a compound line is
 *      not the remedy. A command that only MENTIONS the verb in a quoted
 *      string, a comment, or a here-document is not an invocation.
 *
 * Karpathy §2 (Simplicity First): no LLM call inside. The regex is the FIRST
 * time peaks-loop accepts hardcoded keywords — explicitly scoped as a
 * *fail-closed backup* (case 3), NOT a primary judgement. The LLM still owns
 * the semantic call via `peaks code detect-job`.
 */

import {
  readJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED
} from './job-shape-decision.js';
import { describeNextSlice } from '../job/job-progress-store.js';
import {
  ledgerJobIds,
  readProgressIfAny,
  readPromptFromLastPromptFile,
  type Step08Progress
} from './step-08-session-readers.js';

export const STEP_08_GATE_FILE_NAME = 'job-shape.json' as const;

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

export type Step08PromptSource = 'flag' | 'last-prompt-file' | 'stdin-empty';

export type Step08Verdict =
  | {
      readonly kind: 'allow-job';
      readonly decision: import('./job-shape-decision.js').JobShapeDecision;
      readonly progress: Step08Progress | null;
    }
  | { readonly kind: 'allow-single' }
  | {
      /**
       * The Bash command being gated IS the remedy this gate prints. Named
       * separately so the transcript cannot confuse it with a command in a
       * session that had already recorded a decision.
       */
      readonly kind: 'allow-remedy-command';
      readonly reason: string;
    }
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

export interface EvaluateStep08Input {
  readonly projectRoot: string;
  readonly sessionId: string;
  /**
   * Explicit prompt text. When omitted, falls back to
   * `.peaks/_runtime/<sid>/txt/last-prompt.txt`. Stdin carries the PreToolUse
   * payload, not the prompt, and is read only when this is omitted.
   */
  readonly prompt?: string;
  /**
   * The Bash command the PreToolUse payload carried, when one was supplied.
   * Used only for the remedy exemption — it never feeds the prompt regex.
   */
  readonly command?: string;
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
    '`peaks code detect-job --is-job false --rationale <text>` (its id defaults to ' +
    '`single-task`), or `peaks code detect-job --is-job true --rationale <text> ' +
    '--suggested-job-id <slug>`, then retry.'
  );
}

const DETECT_JOB_TOKENS = ['peaks', 'code', 'detect-job'] as const;
const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

const REMEDY_COMMAND_REASON =
  'The Bash command being run IS the `peaks code detect-job` remedy this gate asks ' +
  'for when a Job ledger exists without a recorded decision. Allowing it breaks the ' +
  'deadlock: the remedy is a Bash call and this hook sees every one.';

/** Quotes group; a separator (`;`, `&`, `|`, `<`, `>`, newline) stands alone. */
const SHELL_TOKEN_RE = /'[^']*'|"[^"]*"|[^\s;|&<>\n]+|[;|&<>\n]/g;

/**
 * Whether the command the hook is gating is the remedy this gate prints.
 * Narrow on purpose — no shell parsing: the executable tokens must be
 * `peaks code detect-job`, optionally behind a simple `NAME=value` env
 * assignment. A quoted mention is not an invocation, and neither is a
 * compound line, a comment, a here-document body, or anything carrying a
 * backtick or `$(` — command substitution could run a different command
 * inside what looks like the remedy, so it keeps the gate closed.
 *
 * LIMIT: an env assignment whose value is itself quoted
 * (`A="a b" peaks code detect-job`) is not recognised; the flat tokeniser
 * splits it and the exemption fails closed. A bare `A=b` prefix works.
 */
function isDetectJobInvocation(command: string): boolean {
  if (command.includes('`') || command.includes('$(')) return false;
  const tokens: string[] = [];
  for (const match of command.trim().matchAll(SHELL_TOKEN_RE)) {
    const token = match[0];
    if (token === '\n' || (token.length === 1 && ';|&<>'.includes(token))) return false;
    tokens.push(token.replace(/^(['"])(.*)\1$/, '$2'));
  }
  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT_RE.test(tokens[index] ?? '')) index += 1;
  return DETECT_JOB_TOKENS.every((token, offset) => tokens[index + offset] === token);
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
  if (input.command !== undefined && isDetectJobInvocation(input.command)) {
    return {
      allow: true,
      verdict: { kind: 'allow-remedy-command', reason: REMEDY_COMMAND_REASON },
      nextSliceLine: null
    };
  }
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
