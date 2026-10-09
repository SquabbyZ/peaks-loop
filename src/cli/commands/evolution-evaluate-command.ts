/**
 * `peaks evolution evaluate` — M4 / spec §6 / §7.4.
 * Split out of `evolution-commands.ts`: the option surface, the
 * envelope keys, the error codes and the exit-code sites are
 * unchanged.
 */
import type { Command } from 'commander';
import {
  EvolutionIntegrityError,
  type EvolutionService
} from '../../services/evolution/evolution-service.js';
import {
  type EvolutionEvaluation,
  type IndependentEvaluatorResult
} from '../../services/evolution/evolution-types.js';
import { runIndependentEvaluator } from '../../services/evolution/independent-evaluator-runner.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';
import {
  collectRepeatable,
  isScoreInRange,
  proposalNotFoundFailure,
  reportFailure,
  reportIntegrityFailure,
  scoreRangeFailure,
  withEvolutionDbAsync
} from './evolution-command-shared.js';

const EVALUATE_DESCRIPTION =
  "M4: score a proposal with an independent evaluator (AC-12/AC-13) and a regression skeptic (AC-14). The result is the FINAL verdict: 'keep' (after user confirmation), 'revert' (skeptic blocker or score delta below threshold), or 'needs-user-decision'.";

/** The `--options` Commander hands to the `evaluate` action. */
export interface EvaluateOptions {
  proposal: string;
  evaluator: string;
  skeptic: string;
  evaluatorScore: string;
  refuteParagraph?: string;
  riskTag: string[];
  briefPointer?: string;
  project?: string;
  json?: boolean;
}

/** The `svc.score(...)` argument object, built from the CLI flags. */
function evaluateScoreArgs(
  options: EvaluateOptions,
  evaluatorResult: IndependentEvaluatorResult
): Parameters<EvolutionService['score']>[1] {
  return {
    evaluator_id: options.evaluator,
    skeptic_id: options.skeptic,
    evaluator_result: evaluatorResult,
    skeptic_result: {
      driftRisks: [],
      overfitRisks: [],
      safetyRegressionRisks: []
    },
    ...(options.briefPointer !== undefined ? { brief_pointer: options.briefPointer } : {})
  };
}

/** The `nextActions` the final verdict implies (unchanged wording). */
function evaluateNextActions(evaluation: EvolutionEvaluation): string[] {
  if (evaluation.verdict === 'needs-user-decision') {
    return [
      `User confirmation required. Run \`peaks evolution mark-keep --proposal ${evaluation.id} --user-confirmation <ptr> --json\` after the user picks "keep", OR \`peaks evolution revert --proposal ${evaluation.id} --json\`.`
    ];
  }
  if (evaluation.verdict === 'revert') {
    return [
      'Proposal reverted. Investigate the skeptic blocker or the score delta below threshold.'
    ];
  }
  return [
    'Proposal kept. The target asset remains unchanged on disk; full promotion lands in a later slice.'
  ];
}

/** The `ok(...)` `data` payload for a completed evaluation. */
function evaluateEnvelopeData(evaluation: EvolutionEvaluation): Record<string, unknown> {
  return {
    proposalId: evaluation.id,
    verdict: evaluation.verdict,
    evaluator_id: evaluation.evaluator_id,
    skeptic_id: evaluation.skeptic_id,
    evaluator_result: evaluation.evaluator_result,
    skeptic_result: evaluation.skeptic_result,
    score_delta: evaluation.proposal.score_delta,
    score_delta_min: evaluation.proposal.score_delta_min,
    after_score: evaluation.proposal.after_score,
    nextActions: evaluateNextActions(evaluation)
  };
}

/** Print the evaluate failure envelope for `err` and set exit code 1. */
function reportEvaluateFailure(io: ProgramIO, err: unknown, options: EvaluateOptions): void {
  if (err instanceof EvolutionIntegrityError) {
    reportIntegrityFailure({
      io,
      command: 'evolution.evaluate',
      error: err,
      nextActions: [
        'Re-shape per spec §6: evaluator and skeptic MUST be separate from the author; the score delta MUST be >= score_delta_min for keep.'
      ],
      asJson: options.json
    });
    return;
  }
  reportFailure({
    io,
    command: 'evolution.evaluate',
    code: 'EVOLUTION_EVALUATE_FAILED',
    error: err,
    data: { proposalId: options.proposal },
    nextActions: ['Verify the proposal id and the evaluator / skeptic ids.'],
    asJson: options.json
  });
}

/** The service-side half of the `evaluate` action, inside the open DB scope. */
async function evaluateWithinService(
  svc: EvolutionService,
  options: EvaluateOptions,
  score: number,
  io: ProgramIO
): Promise<void> {
  const evaluation = svc.read(options.proposal);
  if (!evaluation) {
    printResult(
      io,
      proposalNotFoundFailure('evolution.evaluate', options.proposal, [
        'Verify the proposal id and that you have run `peaks evolution propose` first.'
      ]),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  // The CLI runs the deterministic LLM stubs (no live LLM in M4).
  // Real LLM wiring lands in M5.
  const evaluatorResult = await runIndependentEvaluator(evaluation.proposal);
  // Force the CLI-supplied --evaluator-score to be the final score;
  // the LLM stub's score is informational.
  evaluatorResult.score = score;
  if (options.refuteParagraph && options.refuteParagraph.length > 0) {
    evaluatorResult.refuteParagraph = options.refuteParagraph;
  }
  if (Array.isArray(options.riskTag) && options.riskTag.length > 0) {
    evaluatorResult.riskTags = [...evaluatorResult.riskTags, ...options.riskTag];
  }

  const scored = svc.score(options.proposal, evaluateScoreArgs(options, evaluatorResult));
  printResult(io, ok('evolution.evaluate', evaluateEnvelopeData(scored), [], []), options.json);
  if (scored.verdict === 'revert') process.exitCode = 1;
}

/** The `evaluate` action body. */
export async function runEvaluate(options: EvaluateOptions, io: ProgramIO): Promise<void> {
  try {
    const score = Number(options.evaluatorScore);
    if (!isScoreInRange(score)) {
      printResult(
        io,
        scoreRangeFailure({
          command: 'evolution.evaluate',
          code: 'EVOLUTION_INVALID_EVALUATOR_SCORE',
          label: 'evaluator-score',
          flag: '--evaluator-score',
          key: 'evaluatorScore',
          raw: options.evaluatorScore
        }),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    await withEvolutionDbAsync(options.project, (svc) =>
      evaluateWithinService(svc, options, score, io)
    );
  } catch (err) {
    reportEvaluateFailure(io, err, options);
  }
}

/** Register `peaks evolution evaluate` on the `evolution` parent. */
export function registerEvaluateCommand(evolution: Command, io: ProgramIO): void {
  addJsonOption(
    evolution
      .command('evaluate')
      .description(EVALUATE_DESCRIPTION)
      .requiredOption('--proposal <id>', 'proposal id returned by `peaks evolution propose`')
      .requiredOption(
        '--evaluator <id>',
        'independent scorer id (MUST differ from --author; AC-10)'
      )
      .requiredOption(
        '--skeptic <id>',
        'regression skeptic id (MUST differ from --evaluator and --author; AC-12/AC-14)'
      )
      .requiredOption(
        '--evaluator-score <n>',
        "the independent scorer's score on the 0..10 scale (LLM-derived; NOT the author's after_score)"
      )
      .option(
        '--refute-paragraph <text>',
        "the independent scorer's one-paragraph refute (LLM-authored)",
        ''
      )
      .option(
        '--risk-tag <tag>',
        'add a risk tag emitted by the evaluator (repeatable)',
        collectRepeatable,
        [] as string[]
      )
      .option('--brief-pointer <ptr>', 'pointer to the evidence brief (spec §4.7 / §4.4)')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: EvaluateOptions) => runEvaluate(options, io));
}
