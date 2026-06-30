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
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from '../../shared/result.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

const VALID_EVALUATORS: ReadonlySet<EvaluatorKind> = new Set<EvaluatorKind>([
  'karpathy',
  'code-review',
  'security-review',
  'perf-baseline',
  'verdict-aggregate'
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
      .option('--project <path>', 'project root (default: cwd)')
      .option('--scope <scope>', 'optional scope expression (forwarded to the evaluator)')
      .option('--threshold <threshold>', 'optional SLA threshold (evaluator-specific)')
  ).action((rid: string, options: { evaluator: string; project?: string; scope?: string; threshold?: string; json?: boolean }) => {
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
}