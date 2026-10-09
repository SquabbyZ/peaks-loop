/**
 * `peaks evolution mark-keep` + `peaks evolution revert` — the two
 * explicit-verdict verbs (spec §6.1 #8). Split out of
 * `evolution-commands.ts`: the option surfaces, the envelope keys and
 * the exit-code sites are unchanged.
 */
import type { Command } from 'commander';
import { EvolutionIntegrityError } from '../../services/evolution/evolution-service.js';
import type { EvolutionEvaluation } from '../../services/evolution/evolution-types.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';
import {
  proposalNotFoundFailure,
  reportFailure,
  reportIntegrityFailure,
  withEvolutionDb
} from './evolution-command-shared.js';

const MARK_KEEP_DESCRIPTION =
  'M4: explicit user-confirmed `keep` verdict. Requires --user-confirmation <ptr> and a score_delta >= score_delta_min (AC-11/AC-15).';

const REVERT_DESCRIPTION =
  'M4: revert a proposal (universal recovery; spec §6.1 #8). Always allowed; the user may supply --user-confirmation for audit.';

/** The `--options` Commander hands to the `mark-keep` action. */
export interface MarkKeepOptions {
  proposal: string;
  userConfirmation: string;
  project?: string;
  json?: boolean;
}

/** The `--options` Commander hands to the `revert` action. */
export interface RevertOptions {
  proposal: string;
  userConfirmation?: string;
  project?: string;
  json?: boolean;
}

/** Print the mark-keep failure envelope for `err` and set exit code 1. */
function reportMarkKeepFailure(io: ProgramIO, err: unknown, options: MarkKeepOptions): void {
  if (err instanceof EvolutionIntegrityError) {
    reportIntegrityFailure({
      io,
      command: 'evolution.mark-keep',
      error: err,
      nextActions: ['Re-shape the proposal or the score so score_delta >= score_delta_min.'],
      asJson: options.json
    });
    return;
  }
  reportFailure({
    io,
    command: 'evolution.mark-keep',
    code: 'EVOLUTION_MARK_KEEP_FAILED',
    error: err,
    data: { proposalId: options.proposal },
    nextActions: ['Verify the proposal id.'],
    asJson: options.json
  });
}

/** The `ok(...)` `data` payload for a confirmed `keep`. */
function markKeepEnvelopeData(updated: EvolutionEvaluation): Record<string, unknown> {
  return {
    proposalId: updated.id,
    verdict: updated.verdict,
    user_confirmation_pointer: updated.user_confirmation_pointer ?? null,
    score_delta: updated.proposal.score_delta,
    score_delta_min: updated.proposal.score_delta_min
  };
}

/** The `mark-keep` action body. */
export function runMarkKeep(options: MarkKeepOptions, io: ProgramIO): void {
  try {
    const updated = withEvolutionDb(options.project, (svc) =>
      svc.markVerdict(options.proposal, 'keep', options.userConfirmation)
    );
    if (!updated) {
      printResult(
        io,
        proposalNotFoundFailure('evolution.mark-keep', options.proposal, [
          'Verify the proposal id.'
        ]),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(io, ok('evolution.mark-keep', markKeepEnvelopeData(updated), [], []), options.json);
  } catch (err) {
    reportMarkKeepFailure(io, err, options);
  }
}

/** The `revert` action body. */
export function runRevert(options: RevertOptions, io: ProgramIO): void {
  try {
    const updated = withEvolutionDb(options.project, (svc) =>
      svc.revert(options.proposal, options.userConfirmation)
    );
    if (!updated) {
      printResult(
        io,
        proposalNotFoundFailure('evolution.revert', options.proposal, ['Verify the proposal id.']),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok(
        'evolution.revert',
        {
          proposalId: updated.id,
          verdict: updated.verdict,
          user_confirmation_pointer: updated.user_confirmation_pointer ?? null
        },
        [],
        []
      ),
      options.json
    );
  } catch (err) {
    reportFailure({
      io,
      command: 'evolution.revert',
      code: 'EVOLUTION_REVERT_FAILED',
      error: err,
      data: { proposalId: options.proposal },
      nextActions: ['Verify the proposal id.'],
      asJson: options.json
    });
  }
}

/** Register `peaks evolution mark-keep` on the `evolution` parent. */
export function registerMarkKeepCommand(evolution: Command, io: ProgramIO): void {
  addJsonOption(
    evolution
      .command('mark-keep')
      .description(MARK_KEEP_DESCRIPTION)
      .requiredOption('--proposal <id>', 'proposal id')
      .option(
        '--user-confirmation <ptr>',
        'pointer to the user choice record (AC-15) — omit to surface the EVOLUTION_MISSING_USER_CONFIRMATION service-layer error'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: MarkKeepOptions) => runMarkKeep(options, io));
}

/** Register `peaks evolution revert` on the `evolution` parent. */
export function registerRevertCommand(evolution: Command, io: ProgramIO): void {
  addJsonOption(
    evolution
      .command('revert')
      .description(REVERT_DESCRIPTION)
      .requiredOption('--proposal <id>', 'proposal id')
      .option('--user-confirmation <ptr>', 'optional pointer to the user choice record')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: RevertOptions) => runRevert(options, io));
}
