// src/cli/commands/asset-crystallize-payload.ts
//
// The `asset.crystallize` payload and success envelope: the options shape the
// verb's registration fills in, the three builders that turn it into the
// service argument, and the printer for a completed crystallization. Split out
// of `asset-crystallize-command.ts` so no single module carries both halves.

import type {
  CrystallizationService,
  CrystallizationTrigger,
  EvidenceBrief
} from '../../services/crystallization/index.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';

export type CrystallizeOptions = {
  fromTask: string;
  loopId: string;
  loopName: string;
  loopScenario: string;
  loopTriggerPolicy: string;
  loopInteractionPolicy: string;
  loopFeedbackPolicy: string;
  loopEvolutionPolicy: string;
  loopSuccessCriterion: string[];
  loopEvaluatorPolicy: string[];
  loopVersion: string;
  beeName: string;
  beeVersion: string;
  beeDescription: string;
  beeRelationReason: string;
  briefWhatHappened: string;
  briefWhyItMatters: string;
  briefWhatLearned: string;
  briefWhatAction: string;
  briefBullet: string[];
  sourceTrace: string[];
  evaluatorSummary?: string;
  userDecisionSummary?: string;
  beeIntentRaw?: string;
  beeParentVersion?: string;
  beeChangelog?: string;
  trigger: string;
  project?: string;
  json?: boolean;
};

/** The four brief sections as the caller supplied them. */
export function briefFromOptions(options: CrystallizeOptions): Record<string, string> {
  return {
    what_happened: options.briefWhatHappened,
    why_it_matters: options.briefWhyItMatters,
    what_learned: options.briefWhatLearned,
    what_action: options.briefWhatAction
  };
}

function buildLoopInput(
  options: CrystallizeOptions
): Parameters<CrystallizationService['crystallize']>[0]['loop_input'] {
  return {
    id: options.loopId,
    name: options.loopName,
    scenario: options.loopScenario,
    trigger_policy: options.loopTriggerPolicy,
    success_criteria: options.loopSuccessCriterion,
    interaction_policy: options.loopInteractionPolicy,
    feedback_policy: options.loopFeedbackPolicy,
    evolution_policy: options.loopEvolutionPolicy,
    evaluator_policy: options.loopEvaluatorPolicy,
    linked_bees: [],
    run_history: [],
    crystallization_evidence: [],
    lifecycle_status: 'candidate',
    version: options.loopVersion
  };
}

function buildBeeInput(
  options: CrystallizeOptions
): Parameters<CrystallizationService['crystallize']>[0]['bee_input'] {
  return {
    bee_name: options.beeName,
    version: options.beeVersion,
    description: options.beeDescription,
    ...(options.beeIntentRaw !== undefined ? { user_intent_raw: options.beeIntentRaw } : {}),
    ...(options.beeParentVersion !== undefined ? { parent_version: options.beeParentVersion } : {}),
    ...(options.beeChangelog !== undefined ? { changelog: options.beeChangelog } : {})
  };
}

export function buildCrystallizePayload(
  options: CrystallizeOptions,
  brief: EvidenceBrief,
  trigger: CrystallizationTrigger
): Parameters<CrystallizationService['crystallize']>[0] {
  return {
    task: {
      task_id: options.fromTask,
      task_status: 'completed',
      gates_passed: true,
      evidence_collected: true
    },
    loop_input: buildLoopInput(options),
    bee_input: buildBeeInput(options),
    bee_relation_reason: options.beeRelationReason,
    evidence_brief: brief,
    evidence_bullets: options.briefBullet ?? [],
    source_trace_pointers: options.sourceTrace ?? [],
    ...(options.evaluatorSummary !== undefined
      ? { evaluator_summary: options.evaluatorSummary }
      : {}),
    ...(options.userDecisionSummary !== undefined
      ? { user_decision_summary: options.userDecisionSummary }
      : {}),
    trigger
  };
}

export function printCrystallizeResult(
  io: ProgramIO,
  recommendation: {
    payload: {
      brief: unknown;
      bullets: unknown;
      source_trace_pointers: unknown;
      evaluator_summary: unknown;
    };
  },
  result: { loop_release_id: string; crystallization_event_id: string },
  json: boolean | undefined
): void {
  printResult(
    io,
    ok(
      'asset.crystallize',
      {
        recommendation: {
          brief: recommendation.payload.brief,
          bullets: recommendation.payload.bullets,
          source_trace_pointers: recommendation.payload.source_trace_pointers,
          evaluator_summary: recommendation.payload.evaluator_summary
        },
        result,
        nextActions: [
          `Run \`peaks loop show --loop ${result.loop_release_id}\` to inspect the new loop_release.`,
          `Run \`peaks asset dispose --crystallization-event ${result.crystallization_event_id} --mode trace_only\` to retire the event without touching the asset.`
        ]
      },
      [],
      [
        'The CLI has surfaced a complete 4-section brief; the LLM should now drive the user through AskUserQuestion picks (spec §5.3).'
      ]
    ),
    json
  );
}
