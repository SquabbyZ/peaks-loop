/**
 * peaks-workflow v3.0.0 — Slice A.3 + Slice B.2
 *
 * CLI surface for the workflow primitive + the loop evaluator dispatcher.
 *
 * New commands (added under the existing `peaks workflow` group and the
 * existing `peaks loop` group — never as new top-level commands, per the
 * peaks-cli add-a-new-subcommand-check-for-existing-top-level-first rule):
 *
 *   peaks workflow run <id> --session <sid> --project <repo> --json
 *   peaks workflow plan <id> --session <sid> --json   (dry-run)
 *   peaks workflow lint <id> --session <sid> --json
 *   peaks loop eval <rid> --evaluator <name> [--project <repo>] [--json]
 *
 * Karpathy §2: separate file from workflow-commands.ts to stay under
 * the 800-line budget.
 */
import { Command } from 'commander';
import { resolveWorkflow, planWorkflow, planWorkflowRun } from '../../services/workflow/workflow-loader.js';
import { lintWorkflowSpec, type WorkflowSpec } from '../../services/workflow/workflow-spec.js';
import { dispatchEvaluator, type EvaluatorVerdictEnvelope } from '../../services/loop/evaluator-dispatcher.js';
import type { EvaluatorKind } from '../../services/workflow/workflow-spec.js';
import { DEFAULT_MONOTONIC_THRESHOLD } from '../../services/loop/monotonic-guard.js';
import {
  runMonotonicCheck,
  resolveMonotonicContext
} from '../../services/loop/monotonic-runner.js';
import {
  resolveLoopSpec,
  persistSpec,
  buildSpec,
  lintLoopSpec,
  lintSpecFile,
  type LoopSpec,
  type SpecEvaluatorEntry,
  type SpecSlaEntry,
  type SpecTermination,
  type SpecTerminationStrategy
} from '../../services/loop/spec-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

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

export function registerWorkflowEvalCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `workflow` and `loop` parents created by
  // `registerWorkflowCommands` / `registerLoopCommands` (program-level
  // command conflicts would otherwise throw per Commander's
  // add-a-new-subcommand-check-for-existing-top-level-first rule).
  const existingWorkflow = program.commands.find((c) => c.name() === 'workflow');
  const existingLoop = program.commands.find((c) => c.name() === 'loop');
  const workflow = existingWorkflow ?? program.command('workflow').description('Workflow primitive (run / plan / lint)');
  const loop = existingLoop ?? program.command('loop').description('Loop primitive (eval)');

  // peaks workflow run <id>
  addJsonOption(
    workflow
      .command('run')
      .description('Slice A.3: replay a captured workflow (.peaks/workflows/<id>.yaml) deterministically. Returns the run-plan order + per-phase status without re-deriving the phase plan.')
      .argument('<id>', 'workflow id (matches .peaks/workflows/<id>.yaml)')
      .requiredOption('--session <sid>', 'session id (from peaks workspace init)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((id: string, options: { session: string; project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const resolved = resolveWorkflow(projectRoot, id);
      if (resolved.source.kind === 'missing') {
        printResult(io, fail('workflow.run', 'WORKFLOW_NOT_FOUND', `workflow "${id}" not found`, { sessionId: options.session }, [`peaks workflow lint ${id} --session ${options.session} --json`]), options.json);
        process.exitCode = 1;
        return;
      }
      if (!resolved.lint.ok) {
        printResult(io, fail('workflow.run', 'WORKFLOW_LINT_FAILED', `workflow "${id}" has ${resolved.lint.errors.length} lint error(s): ${resolved.lint.errors.join('; ')}`, resolved.lint, [`peaks workflow lint ${id} --session ${options.session} --json`]), options.json);
        process.exitCode = 1;
        return;
      }
      const runPlan = planWorkflowRun(resolved.spec);
      printResult(io, ok('workflow.run', {
        sessionId: options.session,
        workflow: { id: resolved.spec.id, label: resolved.spec.label, source: resolved.source },
        runPlan,
        lintWarnings: resolved.lint.warnings
      }, [], [`Run \`peaks workflow plan ${id} --session ${options.session} --json\` to preview the graph.`]), options.json);
    } catch (error) {
      printResult(io, fail('workflow.run', 'WORKFLOW_RUN_FAILED', getErrorMessage(error), { sessionId: options.session }, ['Verify the workflow id and session binding.']), options.json);
      process.exitCode = 1;
    }
  });

  // peaks workflow graph <id>  (dry-run graph render)
  // Renamed from `plan` to `graph` to avoid collision with the existing
  // `peaks workflow plan <read|refresh|detect-trigger>` family registered
  // by workflow-plan-commands.ts (slice 025).
  addJsonOption(
    workflow
      .command('graph')
      .description('Slice A.3 dry-run: render the workflow graph (phases + parallel groups + evaluators + budget). No phase is executed.')
      .argument('<id>', 'workflow id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((id: string, options: { session: string; project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const resolved = resolveWorkflow(projectRoot, id);
      if (resolved.source.kind === 'missing') {
        printResult(io, fail('workflow.graph', 'WORKFLOW_NOT_FOUND', `workflow "${id}" not found`, { sessionId: options.session }, [`Create .peaks/workflows/${id}.yaml or use the bundled default-fullauto-md.`]), options.json);
        process.exitCode = 1;
        return;
      }
      if (!resolved.lint.ok) {
        printResult(io, fail('workflow.graph', 'WORKFLOW_LINT_FAILED', `workflow "${id}" has ${resolved.lint.errors.length} lint error(s): ${resolved.lint.errors.join('; ')}`, resolved.lint, [`peaks workflow lint ${id} --session ${options.session} --json`]), options.json);
        process.exitCode = 1;
        return;
      }
      const graph = planWorkflow(resolved.spec, resolved.source);
      printResult(io, ok('workflow.graph', {
        sessionId: options.session,
        graph,
        lintWarnings: resolved.lint.warnings
      }, [], [`Run \`peaks workflow run ${id} --session ${options.session} --json\` to materialize the run-plan order.`]), options.json);
    } catch (error) {
      printResult(io, fail('workflow.graph', 'WORKFLOW_GRAPH_FAILED', getErrorMessage(error), { sessionId: options.session }, ['Verify the workflow id and session binding.']), options.json);
      process.exitCode = 1;
    }
  });

  // peaks workflow lint <id>
  addJsonOption(
    workflow
      .command('lint')
      .description('Slice A.3: validate a workflow spec (phases / gates / evaluators / parallel groups / budget).')
      .argument('<id>', 'workflow id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((id: string, options: { session: string; project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const resolved = resolveWorkflow(projectRoot, id);
      if (resolved.source.kind === 'missing') {
        printResult(io, fail('workflow.lint', 'WORKFLOW_NOT_FOUND', `workflow "${id}" not found`, { sessionId: options.session }, [`Create .peaks/workflows/${id}.yaml`]), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('workflow.lint', {
        sessionId: options.session,
        source: resolved.source,
        lint: resolved.lint
      }, [], []), options.json);
      if (!resolved.lint.ok) process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('workflow.lint', 'WORKFLOW_LINT_FAILED', getErrorMessage(error), { sessionId: options.session }, ['Verify the workflow file syntax.']), options.json);
      process.exitCode = 1;
    }
  });

  // peaks loop eval <rid> --evaluator <name>
  addJsonOption(
    loop
      .command('eval')
      .description('Slice B.2: invoke a native evaluator directly. The runtime calls the evaluator (no LLM scheduling) and returns a verdict envelope compatible with peaks verdict aggregate.')
      .argument('<rid>', 'request id (e.g. 2026-06-30-...)')
      .requiredOption('--evaluator <name>', `evaluator: ${[...VALID_EVALUATORS].join(', ')}`)
      .option('--session <sid>', 'session id (required by --evaluator monotonic-improvement; ignored otherwise)')
      .option('--project <path>', 'project root (default: cwd)')
      .option('--scope <scope>', 'optional scope expression (forwarded to the evaluator)')
      .option('--threshold <threshold>', 'optional SLA threshold (evaluator-specific)')
  ).action((rid: string, options: { evaluator: string; session?: string; project?: string; scope?: string; threshold?: string; json?: boolean }) => {
    try {
      if (!VALID_EVALUATORS.has(options.evaluator as EvaluatorKind)) {
        printResult(io, fail('loop.eval', 'UNKNOWN_EVALUATOR', `evaluator "${options.evaluator}" is not a native evaluator (allowed: ${[...VALID_EVALUATORS].join(', ')})`, { rid }, [`Use one of: ${[...VALID_EVALUATORS].join(', ')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const envelope: EvaluatorVerdictEnvelope = dispatchEvaluator(options.evaluator as EvaluatorKind, {
        projectRoot,
        rid,
        ...(options.session !== undefined ? { sessionId: options.session } : {}),
        ...(options.scope !== undefined ? { scope: options.scope } : {}),
        ...(options.threshold !== undefined ? { threshold: options.threshold } : {})
      });
      const verdict = envelope.gateAction;
      const exitCode = envelope.gateAction === 'block' ? 1 : 0;
      printResult(io, ok('loop.eval', {
        rid,
        evaluator: envelope.kind,
        verdict,
        passed: envelope.passed,
        violations: envelope.violations,
        summary: envelope.summary,
        wallSeconds: envelope.wallSeconds,
        degraded: envelope.degraded
      }, [], envelope.degraded
        ? ['Evaluator ran in degraded mode (peaks CLI unavailable). Verify the verdict by running `peaks verdict aggregate --from-rid ' + rid + '`.',
           'Re-run on a fully-installed peaks-cli environment for a real verdict.']
        : [`Verifier verdict-aggregate can consume this envelope via \`peaks verdict aggregate --from-rid ${rid}\`.`]
      ), options.json);
      process.exitCode = exitCode;
    } catch (error) {
      printResult(io, fail('loop.eval', 'LOOP_EVAL_FAILED', getErrorMessage(error), { rid, evaluator: options.evaluator }, ['Verify the rid and evaluator name.']), options.json);
      process.exitCode = 1;
    }
  });

  // peaks loop check-monotonic <rid>
  // Slice C: compare adjacent cycles' per-evaluator scores; reject
  // score regression > threshold with `MONOTONICITY_VIOLATION`.
  addJsonOption(
    loop
      .command('check-monotonic')
      .description('Slice C.2: compare adjacent cycles of evaluator scores for a rid. Reject (exit 1) when an evaluator score regresses beyond the configured threshold.')
      .argument('<rid>', 'request id (e.g. 2026-06-30-...)')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
      .option('--threshold <threshold>', `maximum allowed score regression on the 0..1 scale (default: ${DEFAULT_MONOTONIC_THRESHOLD} = 5%)`)
      .option('--no-persist', 'skip persisting the current cycle score rows to disk')
  ).action((rid: string, options: { session: string; project?: string; threshold?: string; persist?: boolean; json?: boolean }) => {
    try {
      const { projectRoot, sid } = resolveMonotonicContext({ ...(options.project !== undefined ? { project: options.project } : {}), session: options.session, rid });
      const persist = options.persist !== false;
      const thresholdNum = options.threshold !== undefined ? Number(options.threshold) : DEFAULT_MONOTONIC_THRESHOLD;
      if (options.threshold !== undefined && (!Number.isFinite(thresholdNum) || thresholdNum < 0 || thresholdNum > 1)) {
        printResult(io, fail('loop.check-monotonic', 'INVALID_THRESHOLD', `threshold must be a finite number in [0,1] (got "${options.threshold}")`, { rid }, [`Pass --threshold ${DEFAULT_MONOTONIC_THRESHOLD} (default) or any number in [0,1].`]), options.json);
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
      printResult(io, ok('loop.check-monotonic', {
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
      }, [],
        result.report.monotonicityViolation
          ? ['Investigate which evaluator regressed most and the previous cycle threshold.', `Inspect ${result.persistedAt ?? 'the persisted cycle row at .peaks/_runtime/<sid>/loop/<rid>/cycle-N.json'}.`]
          : (result.report.status === 'skip'
              ? ['Cycle is the first run or incomparable; monotonicity guard is a no-op.', 'A future cycle will surface a violation if any evaluator regresses.']
              : ['All evaluators held or improved.', `Verifier verdict-aggregate can consume this envelope via \`peaks verdict aggregate --from-rid ${rid}\`.`]
            )
      ), options.json);
      process.exitCode = exitCode;
    } catch (error) {
      printResult(io, fail('loop.check-monotonic', 'LOOP_CHECK_MONOTONIC_FAILED', getErrorMessage(error), { rid }, ['Verify the rid and session binding.']), options.json);
      process.exitCode = 1;
    }
  });

  // peaks loop spec <rid> — Slice E.2: read or bootstrap the
  // project-level `.peaks/_runtime/<sid>/loop/<rid>/spec.yaml`. When
  // `--bootstrap` is set, a default spec is written; otherwise the
  // existing spec is read (or `{kind:'missing'}` is returned).
  const spec = loop.command('spec')
    .description('Slice E.2: read or bootstrap the spec for a rid. Defaults to read; pass --bootstrap to write a default spec.');

  addJsonOption(
    spec
      .command('show')
      .description('Slice E.2: print the resolved spec for a rid.')
      .argument('<rid>', 'request id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((rid: string, options: { session: string; project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const resolved = resolveLoopSpec(projectRoot, options.session, rid);
      if (resolved.spec === null) {
        printResult(io, fail('loop.spec.show', 'SPEC_NOT_FOUND', `no spec.yaml at ${resolved.origin && resolved.origin.kind === 'missing' ? `.peaks/_runtime/${options.session}/loop/${rid}/spec.yaml` : 'unknown'}`, { rid, sessionId: options.session }, [
          `Create one via \`peaks loop spec bootstrap ${rid} --session ${options.session} --project ${projectRoot}\`.`
        ]), options.json);
        process.exitCode = 1;
        return;
      }
      const report = lintLoopSpec(resolved.spec);
      printResult(io, ok('loop.spec.show', {
        rid,
        sessionId: options.session,
        projectRoot,
        origin: resolved.origin,
        spec: resolved.spec,
        lint: { ok: report.ok, errors: report.errors, warnings: report.warnings }
      }, [], [
        `Edit \`${typeof resolved.origin === 'object' && resolved.origin.kind === 'project' ? resolved.origin.path : '<spec>'}\` and re-run \`peaks loop spec lint <file>\`.`
      ]), options.json);
      if (!report.ok) process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('loop.spec.show', 'LOOP_SPEC_SHOW_FAILED', getErrorMessage(error), { rid }, ['Verify the rid and session binding.']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    spec
      .command('bootstrap')
      .description('Slice E.2: write a default spec.yaml for a rid at `.peaks/_runtime/<sid>/loop/<rid>/spec.yaml`.')
      .argument('<rid>', 'request id')
      .requiredOption('--session <sid>', 'session id')
      .option('--project <path>', 'project root (default: cwd)')
      .option('--strategy <strategy>', 'termination strategy (manual|max-cycles|monotonic-violation)', 'monotonic-violation')
      .option('--max-cycles <n>', 'max-cycles (only when strategy=max-cycles)', '3')
  ).action((rid: string, options: { session: string; project?: string; strategy: string; maxCycles: string; json?: boolean }) => {
    try {
      const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
      const strategyRaw = options.strategy as SpecTerminationStrategy;
      const strategy: SpecTerminationStrategy = (strategyRaw === 'max-cycles' || strategyRaw === 'monotonic-violation' || strategyRaw === 'manual') ? strategyRaw : 'monotonic-violation';
      const termination: SpecTermination = strategy === 'max-cycles'
        ? { strategy, maxCycles: Math.max(1, Math.floor(Number(options.maxCycles) || 3)) }
        : { strategy };
      const evaluators: SpecEvaluatorEntry[] = [
        { kind: 'karpathy', gate: 'Gate B3', scope: 'src/' },
        { kind: 'code-review', gate: 'Gate B3', scope: 'src/' },
        { kind: 'security-review', gate: 'Gate B4', scope: 'src/' },
        { kind: 'perf-baseline', gate: 'Gate B4', scope: 'src/' },
        { kind: 'monotonic-improvement', gate: 'Gate D1' }
      ];
      const sla: SpecSlaEntry[] = [
        { evaluator: 'karpathy', maxScore: 0.7 },
        { evaluator: 'code-review', maxScore: 0.7 },
        { evaluator: 'security-review', maxScore: 0.7 },
        { evaluator: 'perf-baseline', maxScore: 0.7 },
        { evaluator: 'monotonic-improvement', maxScore: 0.5 }
      ];
      const specObj: LoopSpec = buildSpec({ rid, evaluators, sla, termination }, rid);
      const report = lintLoopSpec(specObj);
      if (!report.ok) {
        printResult(io, fail('loop.spec.bootstrap', 'SPEC_LINT_FAILED', report.errors.join('; '), { rid, report }, ['Verify the strategy flag.']), options.json);
        process.exitCode = 1;
        return;
      }
      const path = persistSpec(projectRoot, options.session, specObj);
      printResult(io, ok('loop.spec.bootstrap', {
        rid,
        sessionId: options.session,
        projectRoot,
        path,
        spec: specObj,
        lint: { ok: report.ok, errors: report.errors, warnings: report.warnings }
      }, [], [
        `Run \`peaks loop spec lint ${path}\` to re-validate.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('loop.spec.bootstrap', 'LOOP_SPEC_BOOTSTRAP_FAILED', getErrorMessage(error), { rid }, ['Verify the rid, session, and strategy flag.']), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    spec
      .command('lint')
      .description('Slice E.2: schema-validate a spec.yaml file (path required).')
      .argument('<file>', 'path to spec.yaml')
      .option('--rid <rid>', 'override the rid embedded in the spec (default: inferred from path)')
  ).action((file: string, options: { rid?: string; json?: boolean }) => {
    try {
      const result = lintSpecFile(file, options.rid);
      if (result.spec === null) {
        printResult(io, fail('loop.spec.lint', 'SPEC_LINT_FAILED', result.report.errors.join('; '), { file, raw: result.raw.slice(0, 200) }, ['Verify the file path and YAML syntax.']), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('loop.spec.lint', {
        file,
        spec: result.spec,
        lint: { ok: result.report.ok, errors: result.report.errors, warnings: result.report.warnings }
      }, [], []), options.json);
      if (!result.report.ok) process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('loop.spec.lint', 'LOOP_SPEC_LINT_FAILED', getErrorMessage(error), { file }, ['Verify the file path and rid flag.']), options.json);
      process.exitCode = 1;
    }
  });
}