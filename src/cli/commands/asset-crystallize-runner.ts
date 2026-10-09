// src/cli/commands/asset-crystallize-runner.ts
//
// The `asset.crystallize` action body and its failure envelopes. Split out of
// `asset-crystallize-command.ts`; every error code, message and next-action
// list is unchanged, including the rethrow of an error class the verb does not
// handle itself.

import {
  CrystallizationIntegrityError,
  BriefSectionError,
  safeRenderRecommendationPayload,
  CRYSTALLIZATION_TRIGGERS,
  type EvidenceBrief,
  parseEvidenceBrief
} from '../../services/crystallization/index.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import { fail } from 'peaks-loop-shared/result';
import {
  createCrystallizationService,
  openAssetDb,
  parseTriggerFlag,
  resolveAssetProjectRoot
} from './asset-command-shared.js';
import {
  briefFromOptions,
  buildCrystallizePayload,
  printCrystallizeResult,
  type CrystallizeOptions
} from './asset-crystallize-payload.js';

/** Everything one `asset.crystallize` failure envelope needs, in one value. */
type CrystallizeFailure = {
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
  readonly nextActions: string[];
  readonly json: boolean | undefined;
};

function failCrystallize(io: ProgramIO, failure: CrystallizeFailure): void {
  printResult(
    io,
    fail('asset.crystallize', failure.code, failure.message, failure.data, failure.nextActions),
    failure.json
  );
  process.exitCode = 1;
}

function printInvalidTrigger(io: ProgramIO, options: CrystallizeOptions): void {
  failCrystallize(io, {
    code: 'ASSET_INVALID_TRIGGER',
    message: `--trigger must be one of: ${CRYSTALLIZATION_TRIGGERS.join('|')}`,
    data: { trigger: options.trigger },
    nextActions: ['Pass a valid --trigger value.'],
    json: options.json
  });
}

function printMissingBrief(
  io: ProgramIO,
  err: Error,
  candidateBrief: Record<string, string>,
  json: boolean | undefined
): void {
  const briefErr = err as unknown as { message: string; findings: readonly string[] };
  failCrystallize(io, {
    code: 'MISSING_BRIEF_SECTION',
    message: briefErr.message,
    data: { findings: [...briefErr.findings], flagsProvided: Object.keys(candidateBrief) },
    nextActions: [
      'Pass ALL FOUR brief sections via --brief-what-happened / --brief-why-it-matters / --brief-what-learned / --brief-what-action.',
      'The CLI refuses to render a recommendation without a complete 4-section brief (spec §4.7 / RL-7).'
    ],
    json
  });
}

function printRecommendationRejected(
  io: ProgramIO,
  recommendation: Extract<ReturnType<typeof safeRenderRecommendationPayload>, { ok: false }>,
  candidateBrief: Record<string, string>,
  json: boolean | undefined
): void {
  failCrystallize(io, {
    code: recommendation.code ?? 'MISSING_BRIEF_SECTION',
    message: 'recommendation envelope rejected — brief is missing one of its 4 sections',
    data: { findings: recommendation.findings, briefProvided: candidateBrief },
    nextActions: [
      'Pass ALL FOUR brief sections via the matching CLI flags.',
      'Counts in --brief-bullet may support the brief; they do NOT replace it (spec §4.7 / RL-7).'
    ],
    json
  });
}

/** Terminal failures from the service. Anything else is rethrown, as before. */
function handleCrystallizeError(io: ProgramIO, err: unknown, json: boolean | undefined): void {
  if (err instanceof CrystallizationIntegrityError) {
    const integrityErr = err as unknown as {
      code: string;
      message: string;
      findings: readonly string[];
    };
    failCrystallize(io, {
      code: integrityErr.code,
      message: integrityErr.message,
      data: { findings: [...integrityErr.findings] },
      nextActions: [
        integrityErr.code === 'CRYSTALLIZATION_PRE_RUN'
          ? 'Re-shape the candidate task so task_status=completed AND gates_passed=true AND evidence_collected=true (spec §5 / RL-2).'
          : integrityErr.code === 'MISSING_BRIEF_SECTION'
            ? 'Pass ALL FOUR brief sections (RL-7); the CLI refuses to render a recommendation without them.'
            : 'Inspect the failure findings and re-shape the payload.'
      ],
      json
    });
    return;
  }
  if (err instanceof BriefSectionError) {
    const briefErr = err as unknown as { message: string; findings: readonly string[] };
    failCrystallize(io, {
      code: 'MISSING_BRIEF_SECTION',
      message: briefErr.message,
      data: { findings: [...briefErr.findings] },
      nextActions: ['Pass all 4 brief sections (RL-7).'],
      json
    });
    return;
  }
  throw err;
}

export async function runAssetCrystallize(
  io: ProgramIO,
  options: CrystallizeOptions
): Promise<void> {
  try {
    const trigger = parseTriggerFlag(options.trigger);
    if (!trigger) {
      printInvalidTrigger(io, options);
      return;
    }

    // Build the brief from CLI flags and re-validate it through
    // the canonical schema (so a partial brief is caught BEFORE
    // any DB side effects fire).
    const candidateBrief = briefFromOptions(options);
    let brief: EvidenceBrief;
    try {
      brief = parseEvidenceBrief(candidateBrief);
    } catch (err) {
      if (err instanceof BriefSectionError) {
        printMissingBrief(io, err, candidateBrief, options.json);
        return;
      }
      throw err;
    }

    // Render the recommendation envelope up-front so the CLI can
    // refuse to write if any brief section is missing. This is
    // the same code path the crystallization service uses.
    const recommendation = safeRenderRecommendationPayload({
      brief,
      bullets: options.briefBullet ?? [],
      source_trace_pointers: options.sourceTrace ?? [],
      evaluator_summary: {
        one_liner: options.evaluatorSummary ?? '',
        risk_tags: []
      }
    });
    if (!recommendation.ok) {
      printRecommendationRejected(io, recommendation, candidateBrief, options.json);
      return;
    }

    const db = openAssetDb(resolveAssetProjectRoot(options.project));
    try {
      const svc = createCrystallizationService(db);
      const result = svc.crystallize(buildCrystallizePayload(options, brief, trigger));
      printCrystallizeResult(io, recommendation, result, options.json);
    } finally {
      db.close();
    }
  } catch (err) {
    handleCrystallizeError(io, err, options.json);
  }
}
