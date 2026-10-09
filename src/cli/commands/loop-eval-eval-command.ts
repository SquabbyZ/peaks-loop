// `peaks loop eval <rid> --evaluator <name>` — invoke one native evaluator and return
// its verdict envelope, optionally persisting the score row the run-driver reads back.
// Split out of the loop-eval registrar; the option surface and envelope are unchanged.
import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { type EvaluatorKind } from '../../services/workflow/workflow-spec.js';
import {
  dispatchEvaluator,
  type EvaluatorVerdictEnvelope
} from '../../services/loop/evaluator-dispatcher.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { loopCommandParent } from './loop-eval-parents.js';
import { nextEvalCaptureIndex } from './loop-eval-capture-index.js';

const VALID_EVALUATORS: ReadonlySet<EvaluatorKind> = new Set<EvaluatorKind>([
  'karpathy',
  'code-review',
  'security-review',
  'perf-baseline',
  'verdict-aggregate',
  'monotonic-improvement',
  'impact-scan',
  'smoke-run',
  'canary-watch'
]);

interface LoopEvalOptions {
  evaluator: string;
  session?: string;
  project?: string;
  scope?: string;
  threshold?: string;
  captureScore?: boolean;
  json?: boolean;
}

type EvalCapture = { score: number; persistedAt: string | null };

export function registerLoopEvalCommand(program: Command, io: ProgramIO): void {
  const loop = loopCommandParent(program);

  // peaks loop eval <rid> --evaluator <name>
  addJsonOption(
    loop
      .command('eval')
      .description(
        'Slice B.2: invoke a native evaluator directly. The runtime calls the evaluator (no LLM scheduling) and returns a verdict envelope compatible with peaks verdict aggregate. Pass --capture-score to also persist the score row to .peaks/_runtime/<sid>/loop/<rid>/cycles/cycle-N.json (P0 closure: this is the score the run-driver reads back).'
      )
      .argument('<rid>', 'request id (e.g. 2026-06-30-...)')
      .requiredOption('--evaluator <name>', `evaluator: ${[...VALID_EVALUATORS].join(', ')}`)
      .option(
        '--session <sid>',
        'session id (required by --evaluator monotonic-improvement; also required by --capture-score)'
      )
      .option('--project <path>', 'project root (default: cwd)')
      .option('--scope <scope>', 'optional scope expression (forwarded to the evaluator)')
      .option('--threshold <threshold>', 'optional SLA threshold (evaluator-specific)')
      .option(
        '--capture-score',
        'persist the verdict score to .peaks/_runtime/<sid>/loop/<rid>/cycles/cycle-N.json (requires --session); adds data.score',
        false
      )
  ).action((rid: string, options: LoopEvalOptions) => runLoopEval(rid, options, io));
}

function evalUnknownEvaluatorFailure(rid: string, evaluator: string): ReturnType<typeof fail> {
  return fail(
    'loop.eval',
    'UNKNOWN_EVALUATOR',
    `evaluator "${evaluator}" is not a native evaluator (allowed: ${[...VALID_EVALUATORS].join(', ')})`,
    { rid },
    [`Use one of: ${[...VALID_EVALUATORS].join(', ')}`]
  );
}

function evalMissingSessionFailure(rid: string): ReturnType<typeof fail> {
  return fail(
    'loop.eval',
    'CAPTURE_SCORE_NEEDS_SESSION',
    '--capture-score requires --session <sid>',
    { rid },
    ['Pass --session <sid> alongside --capture-score.']
  );
}

function evalCapturePathFailure(rid: string, sid: string): ReturnType<typeof fail> | null {
  if (isUnsafePathInput(sid)) {
    return fail(
      'loop.eval',
      'INVALID_SESSION_ID',
      `Invalid session id: ${sid} (must be a single path segment)`,
      { provided: sid },
      ['Pass a session id that is a single path segment']
    );
  }
  if (isUnsafePathInput(rid)) {
    return fail(
      'loop.eval',
      'INVALID_REQUEST_ID',
      `Invalid request id: ${rid} (must be a single path segment)`,
      { provided: rid },
      ['Pass a request id that is a single path segment']
    );
  }
  return null;
}

function reportEvalFailure(
  io: ProgramIO,
  failure: ReturnType<typeof fail>,
  asJson?: boolean
): void {
  printResult(io, failure, asJson);
  process.exitCode = 1;
}

function reportLoopEvalFailure(
  io: ProgramIO,
  error: unknown,
  data: { rid: string; evaluator: string },
  asJson?: boolean
): void {
  printResult(
    io,
    fail('loop.eval', 'LOOP_EVAL_FAILED', getErrorMessage(error), data, [
      'Verify the rid and evaluator name.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function captureEvalScore(
  rid: string,
  sid: string,
  projectRoot: string,
  envelope: EvaluatorVerdictEnvelope
): EvalCapture {
  const score = envelope.degraded
    ? 0.25
    : envelope.gateAction === 'pass'
      ? 1.0
      : envelope.gateAction === 'warn'
        ? 0.5
        : 0.0;
  const dir = join(projectRoot, '.peaks', '_runtime', sid, 'loop', rid, 'cycles');
  const n = nextEvalCaptureIndex(projectRoot, sid, rid);
  const path = join(dir, `cycle-${n}.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        cycle: n,
        rid,
        sid,
        persistedAt: new Date().toISOString(),
        scores: [
          {
            evaluator: envelope.kind,
            score,
            gateAction: envelope.gateAction,
            degraded: envelope.degraded,
            observedAt: new Date().toISOString()
          }
        ]
      }),
      'utf8'
    );
    return { score, persistedAt: path };
  } catch {
    return { score, persistedAt: null };
  }
}

function evalResultData(
  rid: string,
  envelope: EvaluatorVerdictEnvelope,
  capture: EvalCapture | null
): Record<string, unknown> {
  return {
    rid,
    evaluator: envelope.kind,
    verdict: envelope.gateAction,
    passed: envelope.passed,
    violations: envelope.violations,
    summary: envelope.summary,
    wallSeconds: envelope.wallSeconds,
    degraded: envelope.degraded,
    ...(capture !== null ? { score: capture.score, capture } : {})
  };
}

function evalNextActions(rid: string, envelope: EvaluatorVerdictEnvelope): string[] {
  return envelope.degraded
    ? [
        'Evaluator ran in degraded mode (peaks CLI unavailable). Verify the verdict by running `peaks verdict aggregate --from-rid ' +
          rid +
          '`.',
        'Re-run on a fully-installed peaks-loop environment for a real verdict.'
      ]
    : [
        `Verifier verdict-aggregate can consume this envelope via \`peaks verdict aggregate --from-rid ${rid}\`.`
      ];
}

function runLoopEval(rid: string, options: LoopEvalOptions, io: ProgramIO): void {
  try {
    if (!VALID_EVALUATORS.has(options.evaluator as EvaluatorKind)) {
      const failure = evalUnknownEvaluatorFailure(rid, options.evaluator);
      printResult(io, failure, options.json);
      process.exitCode = 1;
      return;
    }
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const envelope: EvaluatorVerdictEnvelope = dispatchEvaluator(
      options.evaluator as EvaluatorKind,
      {
        projectRoot,
        rid,
        ...(options.session !== undefined ? { sessionId: options.session } : {}),
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
        ...(options.threshold !== undefined ? { threshold: options.threshold } : {})
      }
    );
    const exitCode = envelope.gateAction === 'block' ? 1 : 0;
    // --capture-score path: persist a single-row cycle-N.json to
    // the run-driver's cycles dir. Mirrors the scoring convention
    // of monotonic-guard (pass=1.0, warn=0.5, block=0.0; degraded=0.25).
    let capture: EvalCapture | null = null;
    if (options.captureScore === true) {
      // Sid axis AND rid axis — the join below takes TWO ids, not one.
      // covers "the whole `--capture-score` write path". The security audit of
      // the `--session` guard passed and the `rid` slot escaped:
      // `peaks loop eval '../../../../…/EVILCYC' --capture-score --session
      // <legal>` created `<projectRoot>/../EVILCYC/cycles/cycle-1.json` under
      // an `ok: true` envelope. The rid is the CLI positional and has no pinned
      // format, so the segment check is the control for that axis.
      const sid = options.session;
      if (sid === undefined || sid.length === 0) {
        reportEvalFailure(io, evalMissingSessionFailure(rid), options.json);
        return;
      }
      const pathFailure = evalCapturePathFailure(rid, sid);
      if (pathFailure !== null) {
        reportEvalFailure(io, pathFailure, options.json);
        return;
      }
      capture = captureEvalScore(rid, sid, projectRoot, envelope);
    }
    const data = evalResultData(rid, envelope, capture);
    const actions = evalNextActions(rid, envelope);
    printResult(io, ok('loop.eval', data, [], actions), options.json);
    process.exitCode = exitCode;
  } catch (error) {
    reportLoopEvalFailure(io, error, { rid, evaluator: options.evaluator }, options.json);
  }
}
