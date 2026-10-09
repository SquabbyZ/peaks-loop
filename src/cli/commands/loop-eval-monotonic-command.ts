// `peaks loop check-monotonic <rid>` — compare adjacent cycles' per-evaluator scores
// and reject a regression past the threshold. Split out of the loop-eval registrar.
import type { Command } from 'commander';
import { DEFAULT_MONOTONIC_THRESHOLD } from '../../services/loop/monotonic-guard.js';
import {
  runMonotonicCheck,
  resolveMonotonicContext
} from '../../services/loop/monotonic-runner.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { loopCommandParent } from './loop-eval-parents.js';

interface MonotonicOptions {
  session: string;
  project?: string;
  threshold?: string;
  persist?: boolean;
  json?: boolean;
}

export function registerLoopCheckMonotonicCommand(program: Command, io: ProgramIO): void {
  const loop = loopCommandParent(program);

  // peaks loop check-monotonic <rid>
  // Slice C: compare adjacent cycles' per-evaluator scores; reject
  // score regression > threshold with `MONOTONICITY_VIOLATION`.
  addJsonOption(
    loop
      .command('check-monotonic')
      .description(
        'Slice C.2: compare adjacent cycles of evaluator scores for a rid. Reject (exit 1) when an evaluator score regresses beyond the configured threshold.'
      )
      .argument('<rid>', 'request id (e.g. 2026-06-30-...)')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
      .option(
        '--threshold <threshold>',
        `maximum allowed score regression on the 0..1 scale (default: ${DEFAULT_MONOTONIC_THRESHOLD} = 5%)`
      )
      .option('--no-persist', 'skip persisting the current cycle score rows to disk')
  ).action((rid: string, options: MonotonicOptions) => runCheckMonotonic(rid, options, io));
}

function reportMonotonicFailure(
  io: ProgramIO,
  error: unknown,
  rid: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('loop.check-monotonic', 'LOOP_CHECK_MONOTONIC_FAILED', getErrorMessage(error), { rid }, [
      'Verify the rid and session binding.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function monotonicResultData(
  rid: string,
  sid: string,
  projectRoot: string,
  result: ReturnType<typeof runMonotonicCheck>
): Record<string, unknown> {
  return {
    rid,
    sessionId: sid,
    projectRoot,
    currentCycle: result.currentCycle,
    previousCycle: result.previousCycle,
    persistedAt: result.persistedAt,
    rows: result.rows,
    threshold: result.report.threshold,
    status: result.report.status,
    code: result.report.code,
    monotonicityViolation: result.report.monotonicityViolation,
    regressions: result.report.regressions,
    reason: result.report.reason
  };
}

function monotonicNextActions(rid: string, result: ReturnType<typeof runMonotonicCheck>): string[] {
  return result.report.monotonicityViolation
    ? [
        'Investigate which evaluator regressed most and the previous cycle threshold.',
        `Inspect ${result.persistedAt ?? 'the persisted cycle row at .peaks/_runtime/<sid>/loop/<rid>/cycle-N.json'}.`
      ]
    : result.report.status === 'skip'
      ? [
          'Cycle is the first run or incomparable; monotonicity guard is a no-op.',
          'A future cycle will surface a violation if any evaluator regresses.'
        ]
      : [
          'All evaluators held or improved.',
          `Verifier verdict-aggregate can consume this envelope via \`peaks verdict aggregate --from-rid ${rid}\`.`
        ];
}

function runCheckMonotonic(rid: string, options: MonotonicOptions, io: ProgramIO): void {
  try {
    const { projectRoot, sid } = resolveMonotonicContext({
      ...(options.project !== undefined ? { project: options.project } : {}),
      session: options.session,
      rid
    });
    const persist = options.persist !== false;
    const thresholdNum =
      options.threshold !== undefined ? Number(options.threshold) : DEFAULT_MONOTONIC_THRESHOLD;
    if (
      options.threshold !== undefined &&
      (!Number.isFinite(thresholdNum) || thresholdNum < 0 || thresholdNum > 1)
    ) {
      printResult(
        io,
        fail(
          'loop.check-monotonic',
          'INVALID_THRESHOLD',
          `threshold must be a finite number in [0,1] (got "${options.threshold}")`,
          { rid },
          [`Pass --threshold ${DEFAULT_MONOTONIC_THRESHOLD} (default) or any number in [0,1].`]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const result = runMonotonicCheck({
      projectRoot,
      sid,
      rid,
      threshold: thresholdNum,
      persist
    });
    const exitCode = result.report.monotonicityViolation ? 1 : 0;
    const data = monotonicResultData(rid, sid, projectRoot, result);
    const actions = monotonicNextActions(rid, result);
    printResult(io, ok('loop.check-monotonic', data, [], actions), options.json);
    process.exitCode = exitCode;
  } catch (error) {
    reportMonotonicFailure(io, error, rid, options.json);
  }
}
