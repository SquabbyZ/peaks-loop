// `peaks loop spec show|bootstrap|lint` — the loop spec's read/bootstrap/validate
// surface. Split out of the loop-eval registrar; the option surface is unchanged.
import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import {
  resolveLoopSpec,
  persistSpec,
  buildSpec,
  lintLoopSpec,
  specPath,
  MONOTONIC_TERMINATION,
  DEFAULT_MAX_CYCLES,
  type LoopSpec,
  type SpecEvaluatorEntry,
  type SpecSlaEntry,
  type SpecTermination,
  type SpecTerminationStrategy
} from '../../services/loop/spec-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { loopSpecParent } from './loop-eval-parents.js';

interface LoopSpecShowOptions {
  session: string;
  project?: string;
  json?: boolean;
}

interface LoopSpecBootstrapOptions {
  session: string;
  project?: string;
  strategy: string;
  maxCycles: string;
  force?: boolean;
  json?: boolean;
}

interface SpecBootstrapDataContext {
  rid: string;
  sessionId: string;
  projectRoot: string;
  path: string;
  force?: boolean;
}

export function registerLoopSpecCommands(program: Command, io: ProgramIO): void {
  // peaks loop spec <rid> — Slice E.2: read or bootstrap the
  // project-level `.peaks/_runtime/<sid>/loop/<rid>/spec.yaml`. When
  // `--bootstrap` is set, a default spec is written; otherwise the
  // existing spec is read (or `{kind:'missing'}` is returned).
  const spec = loopSpecParent(program);

  addJsonOption(
    spec
      .command('show')
      .description('Slice E.2: print the resolved spec for a rid.')
      .argument('<rid>', 'request id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((rid: string, options: LoopSpecShowOptions) => runLoopSpecShow(rid, options, io));

  addJsonOption(
    spec
      .command('bootstrap')
      .description(
        'Slice E.2: write a default spec.yaml for a rid at `.peaks/_runtime/<sid>/loop/<rid>/spec.yaml`. Refuses to overwrite an existing spec without --force (P1 from dogfood audit: bootstrap is destructive on re-run).'
      )
      .argument('<rid>', 'request id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
      .option(
        '--strategy <strategy>',
        `termination strategy (manual|max-cycles|${MONOTONIC_TERMINATION})`,
        MONOTONIC_TERMINATION
      )
      .option(
        '--max-cycles <n>',
        `max-cycles (only when strategy=max-cycles; default ${DEFAULT_MAX_CYCLES})`,
        String(DEFAULT_MAX_CYCLES)
      )
      .option(
        '--force',
        'overwrite an existing spec.yaml (without --force, bootstrap refuses with SPEC_EXISTS_NEEDS_FORCE)',
        false
      )
  ).action((rid: string, options: LoopSpecBootstrapOptions) =>
    runLoopSpecBootstrap(rid, options, io)
  );
}

function reportLoopSpecShowFailure(
  io: ProgramIO,
  error: unknown,
  rid: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('loop.spec.show', 'LOOP_SPEC_SHOW_FAILED', getErrorMessage(error), { rid }, [
      'Verify the rid and session binding.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function runLoopSpecShow(rid: string, options: LoopSpecShowOptions, io: ProgramIO): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const resolved = resolveLoopSpec(projectRoot, options.session, rid);
    if (resolved.spec === null) {
      printResult(
        io,
        fail(
          'loop.spec.show',
          'SPEC_NOT_FOUND',
          `no spec.yaml at ${resolved.origin && resolved.origin.kind === 'missing' ? `.peaks/_runtime/${options.session}/loop/${rid}/spec.yaml` : 'unknown'}`,
          { rid, sessionId: options.session },
          [
            `Create one via \`peaks loop spec bootstrap ${rid} --session ${options.session} --project ${projectRoot}\`.`
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    const report = lintLoopSpec(resolved.spec);
    printResult(
      io,
      ok(
        'loop.spec.show',
        {
          rid,
          sessionId: options.session,
          projectRoot,
          origin: resolved.origin,
          spec: resolved.spec,
          lint: { ok: report.ok, errors: report.errors, warnings: report.warnings }
        },
        [],
        [
          `Edit \`${typeof resolved.origin === 'object' && resolved.origin.kind === 'project' ? resolved.origin.path : '<spec>'}\` and re-run \`peaks loop spec lint <file>\`.`
        ]
      ),
      options.json
    );
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    reportLoopSpecShowFailure(io, error, rid, options.json);
  }
}

function resolveBootstrapTermination(options: LoopSpecBootstrapOptions): SpecTermination {
  const strategyRaw = options.strategy as SpecTerminationStrategy;
  const strategy: SpecTerminationStrategy =
    strategyRaw === 'max-cycles' ||
    strategyRaw === MONOTONIC_TERMINATION ||
    strategyRaw === 'manual'
      ? strategyRaw
      : MONOTONIC_TERMINATION;
  return strategy === 'max-cycles'
    ? {
        strategy,
        maxCycles: Math.max(1, Math.floor(Number(options.maxCycles) || DEFAULT_MAX_CYCLES))
      }
    : { strategy };
}

function defaultSpecEvaluators(): SpecEvaluatorEntry[] {
  return [
    { kind: 'karpathy', gate: 'Gate B3', scope: 'src/' },
    { kind: 'code-review', gate: 'Gate B3', scope: 'src/' },
    { kind: 'security-review', gate: 'Gate B4', scope: 'src/' },
    { kind: 'perf-baseline', gate: 'Gate B4', scope: 'src/' },
    { kind: 'monotonic-improvement', gate: 'Gate D1' }
  ];
}

function defaultSpecSla(): SpecSlaEntry[] {
  return [
    { evaluator: 'karpathy', maxScore: 0.7 },
    { evaluator: 'code-review', maxScore: 0.7 },
    { evaluator: 'security-review', maxScore: 0.7 },
    { evaluator: 'perf-baseline', maxScore: 0.7 },
    { evaluator: 'monotonic-improvement', maxScore: 0.5 }
  ];
}

function specExistsFailure(rid: string, sessionId: string, path: string): ReturnType<typeof fail> {
  return fail(
    'loop.spec.bootstrap',
    'SPEC_EXISTS_NEEDS_FORCE',
    `spec.yaml already exists at ${path}; re-run with --force to overwrite`,
    { rid, sessionId, path },
    [
      `Re-run with \`peaks loop spec bootstrap ${rid} --session ${sessionId} --force\` to overwrite.`,
      `Or edit \`${path}\` directly.`
    ]
  );
}

function specLintFailure(
  rid: string,
  report: ReturnType<typeof lintLoopSpec>
): ReturnType<typeof fail> {
  return fail(
    'loop.spec.bootstrap',
    'SPEC_LINT_FAILED',
    report.errors.join('; '),
    { rid, report },
    ['Verify the strategy flag.']
  );
}

function specBootstrapData(
  context: SpecBootstrapDataContext,
  specObj: LoopSpec,
  report: ReturnType<typeof lintLoopSpec>
): Record<string, unknown> {
  return {
    rid: context.rid,
    sessionId: context.sessionId,
    projectRoot: context.projectRoot,
    path: context.path,
    spec: specObj,
    lint: { ok: report.ok, errors: report.errors, warnings: report.warnings },
    overwritten: context.force === true && existsSync(context.path)
  };
}

function specBootstrapActions(rid: string, sessionId: string, writtenPath: string): string[] {
  return [
    `Run \`peaks loop spec lint ${writtenPath}\` to re-validate.`,
    `Then run \`peaks loop run ${rid} --session ${sessionId}\` to execute the loop.`
  ];
}

function reportLoopSpecBootstrapFailure(
  io: ProgramIO,
  error: unknown,
  rid: string,
  asJson?: boolean
): void {
  printResult(
    io,
    fail('loop.spec.bootstrap', 'LOOP_SPEC_BOOTSTRAP_FAILED', getErrorMessage(error), { rid }, [
      'Verify the rid, session, and strategy flag.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function runLoopSpecBootstrap(rid: string, options: LoopSpecBootstrapOptions, io: ProgramIO): void {
  try {
    const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const path = specPath(projectRoot, options.session, rid);
    // P1二次保护:spec.yaml 已存在且未带 --force → SPEC_EXISTS_NEEDS_FORCE
    if (existsSync(path) && options.force !== true) {
      const failure = specExistsFailure(rid, options.session, path);
      printResult(io, failure, options.json);
      process.exitCode = 1;
      return;
    }
    const termination = resolveBootstrapTermination(options);
    const evaluators: SpecEvaluatorEntry[] = defaultSpecEvaluators();
    const sla: SpecSlaEntry[] = defaultSpecSla();
    const specObj: LoopSpec = buildSpec({ rid, evaluators, sla, termination }, rid);
    const report = lintLoopSpec(specObj);
    if (!report.ok) {
      const failure = specLintFailure(rid, report);
      printResult(io, failure, options.json);
      process.exitCode = 1;
      return;
    }
    const writtenPath = persistSpec(projectRoot, options.session, specObj);
    const writeCtx = {
      rid,
      sessionId: options.session,
      projectRoot,
      path: writtenPath,
      ...(options.force !== undefined ? { force: options.force } : {})
    };
    const data = specBootstrapData(writeCtx, specObj, report);
    const actions = specBootstrapActions(rid, options.session, writtenPath);
    printResult(io, ok('loop.spec.bootstrap', data, [], actions), options.json);
  } catch (error) {
    reportLoopSpecBootstrapFailure(io, error, rid, options.json);
  }
}
