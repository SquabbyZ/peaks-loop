// `peaks loop run <rid>` — the closed-loop driver that consumes
// `termination.strategy` and aborts on a monotonicity violation. Split out of the
// loop-eval registrar; the option surface and envelope are unchanged.
import type { Command } from 'commander';
import {
  MONOTONIC_TERMINATION,
  DEFAULT_MAX_CYCLES,
  type SpecTerminationStrategy
} from '../../services/loop/spec-service.js';
import {
  runLoop,
  resolveRunContext,
  type RunDriverResult
} from '../../services/loop/run-driver.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { loopCommandParent } from './loop-eval-parents.js';
import { mapRunDriverCodeToExit, nextActionsForCode } from './loop-eval-run-code.js';

interface LoopRunOptions {
  session: string;
  project?: string;
  strategy?: string;
  maxCycles?: string;
  threshold?: string;
  persist?: boolean;
  json?: boolean;
}

export function registerLoopRunCommand(program: Command, io: ProgramIO): void {
  const loop = loopCommandParent(program);

  // peaks loop run <rid> — Slice F.1 (P0 closure): the closed-loop
  // driver that actually consumes `termination.strategy` (previously
  // declared-and-validated but never consumed — dogfood audit #2).
  addJsonOption(
    loop
      .command('run')
      .description(
        `Slice F.1: drive the closed loop for <rid> per .peaks/_runtime/<sid>/loop/<rid>/spec.yaml. Consumes termination.strategy (${MONOTONIC_TERMINATION} | max-cycles | manual); aborts on MONOTONICITY_VIOLATION.`
      )
      .argument('<rid>', 'request id (e.g. 2026-06-30-...)')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
      .option(
        '--strategy <strategy>',
        `override termination.strategy (allowed: ${MONOTONIC_TERMINATION}, max-cycles, manual)`
      )
      .option('--max-cycles <n>', `override termination.maxCycles (default ${DEFAULT_MAX_CYCLES})`)
      .option('--threshold <t>', 'monotonic threshold (0..1); default 0.05')
      .option('--no-persist', 'skip writing cycle-N.json + summary to disk')
  ).action((rid: string, options: LoopRunOptions) => runLoopDriver(rid, options, io));
}

function reportLoopRunFailure(io: ProgramIO, error: unknown, rid: string, asJson?: boolean): void {
  printResult(
    io,
    fail('loop.run', 'RUN_FAILED', getErrorMessage(error), { rid }, [
      'Verify the rid and session binding.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function loopRunInvalidThresholdFailure(rid: string, threshold?: string): ReturnType<typeof fail> {
  return fail(
    'loop.run',
    'INVALID_THRESHOLD',
    `threshold must be finite in [0,1] (got "${threshold}")`,
    { rid },
    [`Pass --threshold 0.05 (default) or any number in [0,1].`]
  );
}

function loopRunOkData(
  result: RunDriverResult,
  rid: string,
  sid: string,
  projectRoot: string
): Record<string, unknown> {
  return {
    rid,
    sessionId: sid,
    projectRoot,
    code: result.code,
    strategy: result.strategy,
    maxCycles: result.maxCycles,
    cycles: result.cycles.map((c) => ({
      cycle: c.cycle,
      rows: c.rows,
      persistedAt: c.persistedAt,
      monotonicReport: c.monotonicReport
    })),
    finalReport: result.finalReport,
    finalReportCode: result.finalReport?.code ?? null,
    summary: result.summary
  };
}

function loopRunFailData(
  result: RunDriverResult,
  rid: string,
  sid: string,
  projectRoot: string
): Record<string, unknown> {
  return {
    rid,
    sessionId: sid,
    projectRoot,
    code: result.code,
    strategy: result.strategy,
    maxCycles: result.maxCycles,
    cycles: result.cycles,
    finalReport: result.finalReport,
    finalReportCode: result.finalReport?.code ?? null,
    summary: result.summary
  };
}

function loopRunNextActions(result: RunDriverResult): string[] {
  return result.code === 'RUN_OK'
    ? [
        `Loop completed ${result.summary.totalCycles} cycle(s) with ${result.summary.regressionCount} regression(s).`
      ]
    : [`Run driver exited with ${result.code}: ${result.message}`];
}

function loopRunEnvelope(
  result: RunDriverResult,
  rid: string,
  sid: string,
  projectRoot: string
): ReturnType<typeof ok> {
  return result.ok
    ? ok('loop.run', loopRunOkData(result, rid, sid, projectRoot), [], loopRunNextActions(result))
    : fail(
        'loop.run',
        result.code,
        result.message,
        loopRunFailData(result, rid, sid, projectRoot),
        nextActionsForCode(result.code, rid, sid, result.summary)
      );
}

function runLoopDriver(rid: string, options: LoopRunOptions, io: ProgramIO): void {
  try {
    const {
      projectRoot,
      sid,
      rid: r2
    } = resolveRunContext({
      ...(options.project !== undefined ? { project: options.project } : {}),
      session: options.session,
      rid
    });
    const threshold = options.threshold !== undefined ? Number(options.threshold) : undefined;
    if (
      threshold !== undefined &&
      (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    ) {
      const failure = loopRunInvalidThresholdFailure(r2, options.threshold);
      printResult(io, failure, options.json);
      process.exitCode = 1;
      return;
    }
    const maxCycles =
      options.maxCycles !== undefined
        ? Math.max(1, Math.floor(Number(options.maxCycles) || DEFAULT_MAX_CYCLES))
        : undefined;
    const strategyOverride = options.strategy as SpecTerminationStrategy | undefined;
    const result: RunDriverResult = runLoop({
      projectRoot,
      sid,
      rid: r2,
      ...(threshold !== undefined ? { threshold } : {}),
      ...(maxCycles !== undefined ? { maxCyclesOverride: maxCycles } : {}),
      ...(strategyOverride !== undefined ? { strategyOverride } : {}),
      persist: options.persist !== false
    });
    const exitCode = mapRunDriverCodeToExit(result.code);
    const envelope = loopRunEnvelope(result, r2, sid, projectRoot);
    printResult(io, envelope, options.json);
    process.exitCode = exitCode;
  } catch (error) {
    reportLoopRunFailure(io, error, rid, options.json);
  }
}
