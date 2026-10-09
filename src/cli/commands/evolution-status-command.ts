/**
 * `peaks evolution status` — M4 / spec §4.4. Split out of
 * `evolution-commands.ts`: the option surface, the envelope and the
 * exit-code sites are unchanged.
 */
import type { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';
import {
  invalidTargetFailure,
  parseTargetFlag,
  reportFailure,
  type EvolutionTarget,
  withEvolutionDb
} from './evolution-command-shared.js';

const STATUS_DESCRIPTION =
  'M4: read the status snapshot for a target (counts of evaluations by verdict + latest evaluation id).';

/** The `--options` Commander hands to the `status` action. */
export interface StatusOptions {
  target: string;
  project?: string;
  json?: boolean;
}

/** The `{ target_kind, target_release_id }` argument `svc.status` takes. */
function statusTarget(target: EvolutionTarget): {
  target_kind: EvolutionTarget['kind'];
  target_release_id: string;
} {
  return { target_kind: target.kind, target_release_id: target.id };
}

/** The `status` action body. */
export function runStatus(options: StatusOptions, io: ProgramIO): void {
  try {
    const target = parseTargetFlag(options.target);
    if (!target) {
      printResult(io, invalidTargetFailure('evolution.status', options.target), options.json);
      process.exitCode = 1;
      return;
    }
    const targetArg = statusTarget(target);
    const status = withEvolutionDb(options.project, (svc) => svc.status(targetArg));
    printResult(io, ok('evolution.status', status, [], []), options.json);
  } catch (err) {
    reportFailure({
      io,
      command: 'evolution.status',
      code: 'EVOLUTION_STATUS_FAILED',
      error: err,
      data: { target: options.target },
      nextActions: ['Verify the target flag.'],
      asJson: options.json
    });
  }
}

/** Register `peaks evolution status` on the `evolution` parent. */
export function registerStatusCommand(evolution: Command, io: ProgramIO): void {
  addJsonOption(
    evolution
      .command('status')
      .description(STATUS_DESCRIPTION)
      .requiredOption('--target <kind:id>', "target asset, e.g. 'loop:loop-onboarding-research'")
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: StatusOptions) => runStatus(options, io));
}
