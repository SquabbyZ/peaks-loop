// `peaks code gate-step-08` — the mechanical PreToolUse gate for Step 0.8:
// exit 0 = allow, exit 2 = block.
//
// STDOUT IS THE HOOK CONTRACT. The installed entry has no `--json`, so this
// command's DEFAULT stdout is what Claude Code validates on every Bash call.
// `printResult(io, envelope, false)` flattens `data` to the ROOT and appends
// `next: ...` prose there — which put the gate's own `decision` in the ROOT
// `decision` slot the host owns ({approve, block} only) and made stdout two
// documents. So every allow path uses `emitResultDocument`; the test file
// records the measurement and the rejected alternatives.
import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  evaluateStep08,
  STEP_08_BACKUP_REGEX,
  type EvaluateStep08Result,
  type Step08Verdict
} from '../../services/code/step-08-gate.js';
import { buildContextAuditHint } from '../../services/context/context-audit-hint.js';
import { resolveOuterSessionId } from '../../services/session/binding-status-service.js';
import { emitBlock, emitHint, emitResultDocument } from '../../services/hooks/output.js';
import { printGateStep08RemedyCommand, readHookCommand } from './code-gate-step-08-remedy.js';
import { readActiveSid } from './code-runtime-session.js';

interface CodeGateStep08Opts {
  project: string;
  sessionId?: string;
  prompt?: string;
  json?: boolean;
}

interface GateStep08Context {
  result: EvaluateStep08Result;
  hintActions: string[];
}

const GATE = 'code.gate-step-08';
const EXIT_2_NOTE =
  "This gate blocks with exit 2; a harness that reports it as non-blocking has overridden the hook's exit code.";
const DETECT_JOB_HINT =
  'Run `peaks code detect-job --is-job true --rationale <text> --suggested-job-id <slug>` (or `--is-job false --rationale <text>`, whose id defaults to `single-task`) to record the Job-shape verdict.';
const BLOCK_MISSING = `BLOCKED: prompt looks Job-shaped but peaks code detect-job has not been called. ${DETECT_JOB_HINT} Then retry.`;

export function registerCodeGateStep08Command(code: Command, io: ProgramIO): void {
  // v3.1.2 Step 0.8 — Mechanical PreToolUse gate.
  // Wire-installed by `peaks workspace init`. Exit code is the load-bearing
  // contract: 0 → allow (with the envelope on stdout), 2 → block (with the
  // host's deny document on stdout and the reason on stderr).
  addJsonOption(
    code
      .command('gate-step-08')
      .description(
        'v3.1.2: PreToolUse gate for Step 0.8 — allow when job-shape.json exists; ' +
          'fail-closed backup regex when missing. Exit 0 = allow, exit 2 = block. ' +
          'When the decision says isJob=true AND progress.json exists, the stdout ' +
          'also carries `Next: slice #N+1 of M (<currentSlice>)` so the LLM cannot ' +
          'wake up cold. When the context ratio is ≥ 0.70 the stdout gains ONE more ' +
          'line naming the largest context consumer (audit cached ≥ 5 min; fail-soft).'
      )
      .requiredOption(
        '--project <path>',
        'target project root (the hook passes "." so resolveCanonicalProjectRoot promotes it to the git root)'
      )
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option(
        '--prompt <text>',
        'explicit prompt text (default: read last-prompt.txt; also skips the stdin hook-payload read)'
      )
  ).action((opts: CodeGateStep08Opts) => runGateStep08(opts, io));
}

async function runGateStep08(opts: CodeGateStep08Opts, io: ProgramIO): Promise<void> {
  try {
    const sessionId = opts.sessionId ?? readActiveSid(opts.project);
    if (sessionId === null) {
      // No session binding — treat as allow (single-rid mode). The LLM has not
      // yet anchored; we have nothing to gate against.
      printAllow(io, { mode: 'no-session', decision: null, nextSlice: null }, [
        'No active session id; gate passes through (single-rid mode).'
      ]);
      return;
    }
    const command = opts.prompt === undefined ? await readHookCommand() : undefined;
    dispatchVerdict(resolveGateStep08Context(opts, sessionId, command), io, opts.json);
  } catch (err) {
    reportGateStep08Failure(io, err, opts.json);
  }
}

/**
 * Allow — ONE document (the `--json` envelope) on stdout, advice on stderr.
 * `--json` no longer selects a second shape: two shapes for one command is what
 * let the installed hook entry drift out of the host's contract.
 */
function printAllow(
  io: ProgramIO,
  data: Record<string, unknown>,
  actions: readonly string[]
): void {
  emitResultDocument(io, ok(GATE, { allow: true, ...data }, [], [...actions]));
}

/** The fields every Step 0.8 deny envelope carries. */
function denyData(extra: Record<string, unknown>): Record<string, unknown> {
  return { backupRegex: STEP_08_BACKUP_REGEX.toString(), exitCode: 2, ...extra };
}

/**
 * Block — the half a fix must not weaken. Hook mode (no `--json`) emits the
 * host's canonical deny document and exits 2; `--json` mode keeps the failure
 * envelope on stdout (a committed integration test pins that shape). Both
 * exit 2, which is the load-bearing block signal.
 */
function printBlock(
  io: ProgramIO,
  denied: { code: string; message: string; data: Record<string, unknown> },
  hints: readonly string[],
  json?: boolean
): void {
  const envelope = fail(GATE, denied.code, denied.message, denied.data, [
    DETECT_JOB_HINT,
    'Then re-run the Bash tool call.',
    ...hints
  ]);
  if (json === true) {
    io.stderr(`${denied.message}\n${EXIT_2_NOTE}\n`);
    printResult(io, envelope, true);
  } else {
    emitBlock(io, denied.message);
    emitHint(io, EXIT_2_NOTE);
    for (const action of envelope.nextActions) emitHint(io, `- ${action}`);
  }
  process.exitCode = 2;
}

/** The Step 0.8 verdicts that let the call through, and those that refuse it. */
type AllowVerdict = Extract<Step08Verdict, { kind: `allow-${string}` }>;
type BlockVerdict = Exclude<Step08Verdict, AllowVerdict>;

/** One branch per Step 0.8 verdict; every branch prints exactly one answer. */
function dispatchVerdict(context: GateStep08Context, io: ProgramIO, json?: boolean): void {
  const verdict = context.result.verdict;
  if (
    verdict.kind === 'block-missing-decision' ||
    verdict.kind === 'block-no-decision-with-ledger'
  ) {
    printBlockedVerdict(verdict, context, io, json);
    return;
  }
  printAllowedVerdict(verdict, context, io);
}

/** Block: the two refusal verdicts differ only in code, message and one field. */
function printBlockedVerdict(
  verdict: BlockVerdict,
  context: GateStep08Context,
  io: ProgramIO,
  json?: boolean
): void {
  const missing = verdict.kind === 'block-missing-decision';
  printBlock(
    io,
    {
      code: missing ? 'STEP_08_BLOCKED' : 'STEP_08_BLOCKED_WITH_LEDGER',
      message: missing ? BLOCK_MISSING : `BLOCKED: ${verdict.reason}`,
      data: denyData(
        missing ? { promptSource: verdict.promptSource } : { ledgerJobIds: verdict.ledgerJobIds }
      )
    },
    context.hintActions,
    json
  );
}

/** Allow: the job verdict, the single-rid pass-through, the remedy, the undecided case. */
function printAllowedVerdict(
  verdict: AllowVerdict,
  context: GateStep08Context,
  io: ProgramIO
): void {
  const hints = context.hintActions;
  const nextLine = context.result.nextSliceLine;
  switch (verdict.kind) {
    case 'allow-job':
      printAllow(
        io,
        {
          mode: 'job',
          decision: verdict.decision,
          progress: verdict.progress,
          nextSlice: nextLine
        },
        [...(nextLine !== null ? [nextLine] : []), ...hints]
      );
      return;
    case 'allow-single':
      printAllow(io, { mode: 'single', decision: null, nextSlice: null }, [
        'job-shape.json says isJob=false; single-rid mode (gate allows).',
        ...hints
      ]);
      return;
    case 'allow-remedy-command':
      printGateStep08RemedyCommand(verdict, hints, io);
      return;
    default:
      // allow-no-decision-recorded — no decision and no ledger. This is a
      // normal non-Job session and the gate must let it through.
      printAllow(
        io,
        {
          mode: 'undecided-no-regex-hit',
          decision: null,
          nextSlice: null,
          promptSource: verdict.promptSource
        },
        [verdict.reason, ...hints]
      );
  }
}

function resolveGateStep08Context(
  opts: CodeGateStep08Opts,
  sessionId: string,
  command: string | undefined
): GateStep08Context {
  // hint. Runs ONLY when the window is ≥ 0.70 full, caches the audit
  // result for ≥ 5 min so the transcript is scanned at most once per
  // TTL window, and is fail-soft (null → no extra line). It never
  // changes the exit code and never blocks.
  const hintLine = buildContextAuditHint({
    projectRoot: opts.project,
    sessionId,
    outerSessionId: resolveOuterSessionId(opts.project, sessionId)
  });
  const hintActions = hintLine === null ? [] : [hintLine];
  const evalInput: {
    projectRoot: string;
    sessionId: string;
    prompt?: string;
    command?: string;
  } = {
    projectRoot: opts.project,
    sessionId
  };
  if (opts.prompt !== undefined) evalInput.prompt = opts.prompt;
  if (command !== undefined) evalInput.command = command;
  const result = evaluateStep08(evalInput);
  return { result, hintActions };
}

function reportGateStep08Failure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    fail(GATE, 'GATE_STEP_08_FAILED', getErrorMessage(err), null, [
      'Verify the project path and try again'
    ]),
    json
  );
  process.exitCode = 1;
}
