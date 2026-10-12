// The write verb of `peaks race`. Split out of `race-commands.ts` so the
// read-only verb and the writer can each be read on their own — the reader owns
// no file, and the writer owns every write.
//
// The user never types this. Per Human-NL-Choice-Only the LLM runs it on the
// user's behalf after the user describes the task in natural language; and per
// Two-Forms-Only nobody hand-authors the evidence JSON.
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import {
  buildPilotTaskRow,
  RISK_SURFACE_MAX,
  upsertPilotTask,
  HANDLING_VALUES,
  LANE_CHOSEN_BY_VALUES,
  OUTCOME_VALUES,
  type PilotTaskInput
} from '../../services/race/pilot-gate-store.js';
import { addJsonOption, multipleOption, printResult, type ProgramIO } from '../cli-helpers.js';

const PILOT_GATE_DESCRIPTION = 'Gate-2 evidence for the peaks-race-code fast lane';
const RECORD_DESCRIPTION =
  'Upsert one gate-2 evidence row into .peaks/race/pilot-gate.json, keyed by --rid. Refreshes lastEvaluation.';
const PROJECT_HELP = 'project root (default: cwd)';

type RecordOptions = {
  readonly rid: string;
  readonly sessionId: string;
  readonly date: string;
  readonly laneChosenBy: string;
  readonly outcome: string;
  readonly file?: readonly string[];
  readonly riskSurface?: readonly string[];
  readonly riskSurfaceHandling: string;
  readonly rolledBack: boolean;
  readonly ciRed: boolean;
  readonly missedRiskSurface: boolean;
  readonly project: string;
  readonly json?: boolean;
};

/**
 * A boolean is required with an explicit `true|false` rather than a `--no-*`
 * flag: Commander's negated form DEFAULTS the flag, which would let a row be
 * written with a `false` nobody chose. A required value makes "must be given
 * explicitly" mechanical instead of a convention.
 */
function parseBooleanFlag(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`expected true or false, got ${JSON.stringify(value)}`);
}

export function registerRacePilotGateRecordCommand(race: Command, io: ProgramIO): void {
  const pilotGate = race.command('pilot-gate').description(PILOT_GATE_DESCRIPTION);
  addJsonOption(
    pilotGate
      .command('record')
      .description(RECORD_DESCRIPTION)
      .requiredOption('--rid <id>', 'task request id (must start with "rid-")')
      .requiredOption('--session-id <session>', 'session the task ran in')
      .requiredOption('--date <YYYY-MM-DD>', 'task date')
      .requiredOption(
        '--lane-chosen-by <who>',
        `who chose the lane (${LANE_CHOSEN_BY_VALUES.join(' | ')})`
      )
      .requiredOption('--outcome <outcome>', `task outcome (${OUTCOME_VALUES.join(' | ')})`)
      .option('--file <path>', 'repo-relative changed file (repeatable)', multipleOption, [])
      .option(
        '--risk-surface <n>',
        `risk surface hit, 1..${RISK_SURFACE_MAX} (repeatable)`,
        multipleOption,
        []
      )
      .requiredOption(
        '--risk-surface-handling <handling>',
        `how a hit was handled (${HANDLING_VALUES.join(' | ')})`
      )
      .requiredOption('--rolled-back <true|false>', 'was the change rolled back?', parseBooleanFlag)
      .requiredOption(
        '--ci-red <true|false>',
        'is a CI failure attributed to this task?',
        parseBooleanFlag
      )
      .requiredOption(
        '--missed-risk-surface <true|false>',
        'is a missed risk surface known? (no procedure exists for setting this yet)',
        parseBooleanFlag
      )
      .option('--project <path>', PROJECT_HELP, '.')
  ).action((options: RecordOptions) => runRecord(options, io));
}

/**
 * Validate, then write. Validation is fail-closed and runs BEFORE the upsert:
 * a refusal leaves the evidence file exactly as it was, and the message names
 * the flag that broke a rule.
 */
/** Flags in, row input out. Every value is re-validated by the store. */
function toInput(options: RecordOptions): PilotTaskInput {
  return {
    rid: options.rid,
    sessionId: options.sessionId,
    date: options.date,
    laneChosenBy: options.laneChosenBy,
    outcome: options.outcome,
    filesChanged: options.file ?? [],
    riskSurfacesHit: (options.riskSurface ?? []).map((value) => Number(value)),
    riskSurfaceHandling: options.riskSurfaceHandling,
    rolledBack: options.rolledBack,
    ciRed: options.ciRed,
    missedRiskSurface: options.missedRiskSurface
  };
}

function runRecord(options: RecordOptions, io: ProgramIO): void {
  const built = buildPilotTaskRow(toInput(options));
  if (built.kind === 'invalid') {
    printResult(
      io,
      fail('race.pilot-gate.record', 'PILOT_TASK_INVALID', built.message, { rid: options.rid }, [
        'Fix the flag this message names; nothing was written'
      ]),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  try {
    const result = upsertPilotTask(options.project, built.row);
    printResult(
      io,
      ok(
        'race.pilot-gate.record',
        {
          rid: built.row.rid,
          evidencePath: result.path,
          verdict: result.evaluation.verdict,
          counts: result.evaluation.counts
        },
        [],
        []
      ),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'race.pilot-gate.record',
        'PILOT_GATE_WRITE_FAILED',
        getErrorMessage(error),
        { rid: options.rid },
        ['The evidence file was left as it was']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}
