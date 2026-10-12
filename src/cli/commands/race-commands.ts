// Registers the top-level `peaks race` command tree: the `peaks-race-code`
// fast lane's gate-2 surface. Exactly two verbs, deliberately:
//
//   peaks race pilot-status      — READ-ONLY. Judges the evidence, writes nothing.
//   peaks race pilot-gate record — the writer. Upserts one evidence row.
//
// The phase check is NOT a third verb: it has no runtime consumer, and the CLI
// surface is part of this slice's contract. It lives in
// `tests/unit/skills/race-lane-phase-gate.test.ts`.
import type { Command } from 'commander';
import { CLI_VERSION } from 'peaks-loop-shared/version';
import { fail, ok } from 'peaks-loop-shared/result';

import {
  evaluatePilotGate,
  type PilotGateCounts,
  type PilotGateReason,
  type PilotGateVerdict
} from '../../services/race/gate2-evaluator.js';
import {
  RACE_GATE2_POLICY_V1,
  RACE_GATE2_POLICY_VERSION,
  type RaceGate2Policy
} from '../../services/race/gate2-policy.js';
import { readPilotGate } from '../../services/race/pilot-gate-store.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { registerRacePilotGateRecordCommand } from './race-pilot-gate-record-command.js';

const RACE_DESCRIPTION = 'peaks-race-code fast lane: gate-2 threshold policy and evidence';
const PILOT_STATUS_DESCRIPTION =
  'Judge .peaks/race/pilot-gate.json against the gate-2 policy. Read-only; prints pass | fail | insufficient-evidence.';
const PROJECT_HELP = 'project root (default: cwd)';

export type PilotStatusReport = {
  readonly policyVersion: string;
  readonly evaluatorVersion: string;
  readonly recordedPolicyVersion?: string;
  readonly policy: RaceGate2Policy;
  readonly verdict: PilotGateVerdict;
  readonly counts: PilotGateCounts;
  readonly reasons: readonly PilotGateReason[];
  readonly evidencePath: string;
};

type PilotStatusOptions = { project: string; json?: boolean };

export function registerRaceCommands(program: Command, io: ProgramIO): void {
  const race = program.command('race').description(RACE_DESCRIPTION);
  registerRacePilotStatusCommand(race, io);
  registerRacePilotGateRecordCommand(race, io);
}

function registerRacePilotStatusCommand(race: Command, io: ProgramIO): void {
  addJsonOption(
    race
      .command('pilot-status')
      .description(PILOT_STATUS_DESCRIPTION)
      .option('--project <path>', PROJECT_HELP, '.')
  ).action((options: PilotStatusOptions) => runPilotStatus(options, io));
}

/**
 * A missing or malformed evidence file is NOT a verdict. Exiting 0 there would be
 * the "skipped reported as passed" defect class, so both cases are `ok:false` with
 * their own code and exit 1, and the message says no verdict was reached.
 */
type NoVerdictRefusal = {
  readonly code: string;
  readonly message: string;
  readonly nextAction: string;
};

function refuseNoVerdict(
  io: ProgramIO,
  options: PilotStatusOptions,
  refusal: NoVerdictRefusal,
  path: string
): void {
  printResult(
    io,
    fail('race.pilot-status', refusal.code, refusal.message, { evidencePath: path }, [
      refusal.nextAction
    ]),
    options.json
  );
  process.exitCode = 1;
}

function runPilotStatus(options: PilotStatusOptions, io: ProgramIO): void {
  const read = readPilotGate(options.project);
  if (read.kind === 'missing') {
    refuseNoVerdict(
      io,
      options,
      {
        code: 'PILOT_GATE_EVIDENCE_MISSING',
        message: `No gate-2 evidence at ${read.path}: no verdict was reached`,
        nextAction: 'Record a pilot task with `peaks race pilot-gate record`'
      },
      read.path
    );
    return;
  }
  if (read.kind === 'invalid') {
    refuseNoVerdict(
      io,
      options,
      {
        code: 'PILOT_GATE_EVIDENCE_INVALID',
        message: `Gate-2 evidence at ${read.path} is unreadable, so no verdict was reached: ${read.message}`,
        nextAction: 'Repair or re-record the evidence file before judging it'
      },
      read.path
    );
    return;
  }

  const evaluation = evaluatePilotGate(read.gate.tasks, RACE_GATE2_POLICY_V1);
  const report: PilotStatusReport = {
    policyVersion: RACE_GATE2_POLICY_VERSION,
    evaluatorVersion: CLI_VERSION,
    policy: RACE_GATE2_POLICY_V1,
    verdict: evaluation.verdict,
    counts: evaluation.counts,
    reasons: evaluation.reasons,
    evidencePath: read.path
  };
  const withRecorded =
    read.gate.policyVersion === undefined
      ? report
      : { ...report, recordedPolicyVersion: read.gate.policyVersion };
  printResult(io, ok('race.pilot-status', withRecorded, [], []), options.json);
  // `fail` is the only non-zero verdict: `insufficient-evidence` is the normal
  // "keep running the pilot" state, not a failure (PRD §5.1).
  if (evaluation.verdict === 'fail') {
    process.exitCode = 1;
  }
}
