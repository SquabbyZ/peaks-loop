// `peaks code gate-step-08` — the mechanical PreToolUse gate for Step 0.8, whose
// exit code is the load-bearing contract: exit 0 = allow, exit 2 = block.
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
import { readActiveSid } from './code-runtime-session.js';

interface CodeGateStep08Opts {
  project: string;
  sessionId?: string;
  prompt?: string;
  json?: boolean;
}

type GateStep08AllowJobVerdict = Extract<Step08Verdict, { kind: 'allow-job' }>;
type GateStep08BlockMissingDecisionVerdict = Extract<
  Step08Verdict,
  { kind: 'block-missing-decision' }
>;

interface GateStep08Context {
  result: EvaluateStep08Result;
  hintActions: string[];
}

export function registerCodeGateStep08Command(code: Command, io: ProgramIO): void {
  // v3.1.2 Step 0.8 — Mechanical PreToolUse gate.
  // Wire-installed by `peaks workspace init` (extends the existing hook
  // installer). Exit code is the load-bearing contract:
  //   exit 0 → allow (with structured stdout describing the decision)
  //   exit 2 → block (stderr contains the BLOCKED: ... reason)
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
        'explicit prompt text (default: read last-prompt.txt; stdin ignored)'
      )
  ).action((opts: CodeGateStep08Opts) => runGateStep08(opts, io));
}

function runGateStep08(opts: CodeGateStep08Opts, io: ProgramIO): void {
  try {
    const sessionId = opts.sessionId ?? readActiveSid(opts.project);
    if (sessionId === null) {
      // No session binding — treat as allow (single-rid mode). The
      // LLM has not yet anchored; we have nothing to gate against.
      printGateStep08NoSession(io, opts.json);
      return;
    }
    const context = resolveGateStep08Context(opts, sessionId);
    const verdict = context.result.verdict;
    if (verdict.kind === 'allow-job') {
      printGateStep08AllowJob(verdict, context, io, opts.json);
      return;
    }
    if (verdict.kind === 'allow-single') {
      printGateStep08AllowSingle(context, io, opts.json);
      return;
    }
    // block-missing-decision
    if (verdict.promptHit) {
      // Block: backup regex hit. Exit code 2 is the load-bearing
      // signal for the PreToolUse hook.
      printGateStep08Blocked(verdict, context, io, opts.json);
      return;
    }
    // No decision + no regex hit → allow.
    printGateStep08Undecided(verdict, context, io, opts.json);
  } catch (err) {
    reportGateStep08Failure(io, err, opts.json);
  }
}

function resolveGateStep08Context(opts: CodeGateStep08Opts, sessionId: string): GateStep08Context {
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
  const evalInput: { projectRoot: string; sessionId: string; prompt?: string } = {
    projectRoot: opts.project,
    sessionId
  };
  if (opts.prompt !== undefined) evalInput.prompt = opts.prompt;
  const result = evaluateStep08(evalInput);
  return { result, hintActions };
}

function printGateStep08NoSession(io: ProgramIO, json?: boolean): void {
  const envelope = ok(
    'code.gate-step-08',
    {
      allow: true,
      mode: 'no-session',
      decision: null,
      nextSlice: null
    },
    [],
    ['No active session id; gate passes through (single-rid mode).']
  );
  printResult(io, envelope, json);
}

function printGateStep08AllowJob(
  verdict: GateStep08AllowJobVerdict,
  context: GateStep08Context,
  io: ProgramIO,
  json?: boolean
): void {
  const result = context.result;
  const envelope = ok(
    'code.gate-step-08',
    {
      allow: true,
      mode: 'job',
      decision: verdict.decision,
      progress: verdict.progress,
      nextSlice: result.nextSliceLine
    },
    [],
    [...(result.nextSliceLine !== null ? [result.nextSliceLine] : []), ...context.hintActions]
  );
  printResult(io, envelope, json);
}

function printGateStep08AllowSingle(
  context: GateStep08Context,
  io: ProgramIO,
  json?: boolean
): void {
  const envelope = ok(
    'code.gate-step-08',
    {
      allow: true,
      mode: 'single',
      decision: null,
      nextSlice: null
    },
    [],
    ['job-shape.json says isJob=false; single-rid mode (gate allows).', ...context.hintActions]
  );
  printResult(io, envelope, json);
}

function printGateStep08Blocked(
  verdict: GateStep08BlockMissingDecisionVerdict,
  context: GateStep08Context,
  io: ProgramIO,
  json?: boolean
): void {
  const blockMessage =
    'BLOCKED: prompt looks Job-shaped but peaks code detect-job has not been called. Run `peaks code detect-job --is-job true ...` to record your Job-shape verdict, then retry.';
  const envelope = fail(
    'code.gate-step-08',
    'STEP_08_BLOCKED',
    blockMessage,
    {
      promptSource: verdict.promptSource,
      backupRegex: STEP_08_BACKUP_REGEX.toString()
    },
    [
      'Run `peaks code detect-job --is-job true --rationale <text> --suggested-job-id <slug>` to record the Job-shape verdict.',
      'Then re-run the Bash tool call.',
      ...context.hintActions
    ]
  );
  io.stderr(`${blockMessage}\n`);
  printResult(io, envelope, json);
  process.exitCode = 2;
}

function printGateStep08Undecided(
  verdict: GateStep08BlockMissingDecisionVerdict,
  context: GateStep08Context,
  io: ProgramIO,
  json?: boolean
): void {
  const envelope = ok(
    'code.gate-step-08',
    {
      allow: true,
      mode: 'undecided-no-regex-hit',
      decision: null,
      nextSlice: null,
      promptSource: verdict.promptSource
    },
    [],
    [
      'No job-shape.json AND no backup-regex match on prompt → allow (most prompts are not Job-shaped).',
      ...context.hintActions
    ]
  );
  printResult(io, envelope, json);
}

function reportGateStep08Failure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    fail('code.gate-step-08', 'GATE_STEP_08_FAILED', getErrorMessage(err), null, [
      'Verify the project path and try again'
    ]),
    json
  );
  process.exitCode = 1;
}
