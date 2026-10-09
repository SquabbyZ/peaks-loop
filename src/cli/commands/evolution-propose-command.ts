/**
 * `peaks evolution propose` — M4 / spec §4.4 / §6.1 #5. Split out of
 * `evolution-commands.ts`: the option surface, the envelope keys and
 * the exit-code sites are unchanged.
 */
import type { Command } from 'commander';
import { EvolutionIntegrityError } from '../../services/evolution/evolution-service.js';
import {
  type EvolutionProposal,
  type EvolutionProposalInput
} from '../../services/evolution/evolution-types.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import {
  deltaMinFailure,
  invalidTargetFailure,
  isScoreInRange,
  parseTargetFlag,
  reportFailure,
  reportIntegrityFailure,
  scoreRangeFailure,
  type EvolutionTarget,
  withEvolutionDb
} from './evolution-command-shared.js';

const PROPOSE_DESCRIPTION =
  "M4: persist a new evolution proposal. Enforces AC-8 (single object + single dimension). The proposal's verdict starts at 'needs-user-decision' until the scoring + skeptic step lands.";

/** The `--options` Commander hands to the `propose` action. */
export interface ProposeOptions {
  target: string;
  dimension: string;
  beforeScore: string;
  afterScore: string;
  deltaMin: string;
  author: string;
  briefPointer?: string;
  project?: string;
  json?: boolean;
}

/** The validated propose inputs, or the envelope to print instead. */
type ProposePreparation =
  | { ok: true; target: EvolutionTarget; before: number; after: number; deltaMin: number }
  | { ok: false; failure: ResultEnvelope<unknown> };

/**
 * Validate `--target`, `--before-score`, `--after-score` and
 * `--delta-min` in that order, returning the first failure envelope
 * the original action would have printed.
 */
function preparePropose(options: ProposeOptions): ProposePreparation {
  const target = parseTargetFlag(options.target);
  if (!target)
    return { ok: false, failure: invalidTargetFailure('evolution.propose', options.target) };

  const before = Number(options.beforeScore);
  if (!isScoreInRange(before)) {
    return {
      ok: false,
      failure: scoreRangeFailure({
        command: 'evolution.propose',
        code: 'EVOLUTION_INVALID_BEFORE_SCORE',
        label: 'before_score',
        flag: '--before-score',
        key: 'beforeScore',
        raw: options.beforeScore
      })
    };
  }

  const after = Number(options.afterScore);
  if (!isScoreInRange(after)) {
    return {
      ok: false,
      failure: scoreRangeFailure({
        command: 'evolution.propose',
        code: 'EVOLUTION_INVALID_AFTER_SCORE',
        label: 'after_score',
        flag: '--after-score',
        key: 'afterScore',
        raw: options.afterScore
      })
    };
  }

  const deltaMin = Number(options.deltaMin);
  if (!Number.isFinite(deltaMin) || deltaMin < 0) {
    return { ok: false, failure: deltaMinFailure('evolution.propose', options.deltaMin) };
  }

  return { ok: true, target, before, after, deltaMin };
}

/** The `EvolutionProposalInput` the service receives. */
function proposeInput(
  prep: Extract<ProposePreparation, { ok: true }>,
  options: ProposeOptions
): EvolutionProposalInput {
  return {
    target_kind: prep.target.kind,
    target_release_id: prep.target.id,
    optimization_dimension: options.dimension,
    before_snapshot: {},
    after_snapshot: { after_score: prep.after },
    diff: {},
    before_score: prep.before,
    after_score: prep.after,
    score_delta_min: prep.deltaMin,
    author_id: options.author,
    single_object: true,
    single_optimization_dimension: true,
    rubric: {},
    red_lines: [],
    source_traces: []
  };
}

/** The `ok(...)` `data` payload for a freshly created proposal. */
function proposeEnvelopeData(
  proposal: EvolutionProposal,
  options: ProposeOptions
): Record<string, unknown> {
  return {
    proposal: {
      id: proposal.id,
      target_kind: proposal.target_kind,
      target_release_id: proposal.target_release_id,
      optimization_dimension: proposal.optimization_dimension,
      before_score: proposal.before_score,
      after_score: proposal.after_score,
      score_delta: proposal.score_delta,
      score_delta_min: proposal.score_delta_min,
      author_id: proposal.author_id,
      verdict: 'needs-user-decision',
      ...(options.briefPointer !== undefined ? { brief_pointer: options.briefPointer } : {})
    },
    nextActions: [
      `Run \`peaks evolution evaluate --proposal ${proposal.id} --evaluator <id> --skeptic <id> --evaluator-score <n> --json\` to score the proposal.`
    ]
  };
}

/** Print the propose failure envelope for `err` and set exit code 1. */
function reportProposeFailure(io: ProgramIO, err: unknown, options: ProposeOptions): void {
  if (err instanceof EvolutionIntegrityError) {
    reportIntegrityFailure({
      io,
      command: 'evolution.propose',
      error: err,
      nextActions: [
        'Re-shape the proposal per spec §6: single object, single dimension, separate scorer.',
        'If you intended a multi-object change, split it into multiple rounds.'
      ],
      asJson: options.json
    });
    return;
  }
  reportFailure({
    io,
    command: 'evolution.propose',
    code: 'EVOLUTION_PROPOSE_FAILED',
    error: err,
    data: {},
    nextActions: ['Verify the target flag and dimension.'],
    asJson: options.json
  });
}

/** The `propose` action body. */
export function runPropose(options: ProposeOptions, io: ProgramIO): void {
  try {
    const prep = preparePropose(options);
    if (!prep.ok) {
      printResult(io, prep.failure, options.json);
      process.exitCode = 1;
      return;
    }
    const input = proposeInput(prep, options);
    const proposal = withEvolutionDb(options.project, (svc) => svc.createProposal(input));
    printResult(
      io,
      ok('evolution.propose', proposeEnvelopeData(proposal, options), [], []),
      options.json
    );
  } catch (err) {
    reportProposeFailure(io, err, options);
  }
}

/** Register `peaks evolution propose` on the `evolution` parent. */
export function registerProposeCommand(evolution: Command, io: ProgramIO): void {
  addJsonOption(
    evolution
      .command('propose')
      .description(PROPOSE_DESCRIPTION)
      .requiredOption(
        '--target <kind:id>',
        "target asset, e.g. 'loop:loop-onboarding-research' or 'bee:42'"
      )
      .requiredOption('--dimension <name>', "single optimization dimension (e.g. 'clarity')")
      .requiredOption('--before-score <n>', 'score on the 0..10 scale BEFORE the change')
      .requiredOption(
        '--after-score <n>',
        'score on the 0..10 scale AFTER the change (LLM-claimed)'
      )
      .option(
        '--delta-min <n>',
        `minimum score delta for promotion (default: 1.0; spec §6.1 #5)`,
        '1.0'
      )
      .requiredOption('--author <id>', 'author agent id (the LLM proposing the change)')
      .option(
        '--brief-pointer <ptr>',
        'pointer to the evidence brief used in the recommendation (spec §4.7 / §4.4)'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: ProposeOptions) => runPropose(options, io));
}
