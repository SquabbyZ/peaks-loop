// src/cli/commands/baseline-guard-command.ts
//
// `peaks baseline run-guard` — run the guard contracts over the frozen
// baseline. Split out of `baseline-commands.ts`; the journey selector, the
// refusal codes, the summary data and the exit-code rule are unchanged.

import type { Command } from 'commander';
import {
  GUARD_CONTRACTS,
  getGuardContract,
  isJourneyId
} from '../../services/capability-guard-runner/registry.js';
import {
  exitCodeForGuardSummary,
  runAllGuards
} from '../../services/capability-guard-runner/runner.js';
import type { GuardContract } from '../../services/capability-guard-runner/types.js';
import { P0_JOURNEY_IDS } from '../../services/capability-baseline/types.js';
import type { ProgramIO } from '../cli-helpers.js';
import { fail, guardContext, ok, type BaselineOptions } from './baseline-command-shared.js';

/**
 * The contracts `--journey` selects: all 15 when the flag is absent, the one
 * named contract when it is, or null after the matching refusal was printed.
 */
function selectContracts(
  io: ProgramIO,
  journey: string | undefined
): ReadonlyArray<GuardContract> | null {
  if (journey === undefined) return GUARD_CONTRACTS;
  if (!isJourneyId(journey)) {
    fail(
      io,
      'UNKNOWN_JOURNEY',
      `unknown journey "${journey}"; expected one of ${P0_JOURNEY_IDS.join(', ')}`
    );
    return null;
  }
  const contract = getGuardContract(journey);
  if (contract === undefined) {
    fail(io, 'UNKNOWN_JOURNEY', `no guard contract is registered for ${journey}`);
    return null;
  }
  return [contract];
}

async function runGuard(
  io: ProgramIO,
  opts: BaselineOptions & { journey?: string }
): Promise<void> {
  const projectRoot = opts.project ?? '.';
  const contracts = selectContracts(io, opts.journey);
  if (contracts === null) return;

  const summary = await runAllGuards(contracts, guardContext(projectRoot));
  const data = summary as unknown as Record<string, unknown>;
  const exitCode = exitCodeForGuardSummary(summary);
  if (exitCode === 0) {
    ok(io, 'baseline.run-guard', data);
    return;
  }
  fail(
    io,
    exitCode === 1 ? 'GUARD_FAILED' : 'GUARD_SKIPPED',
    `${String(summary.fail)} failed, ${String(summary.skipped)} skipped of ${String(summary.total)} guard contracts`,
    data
  );
  // `fail` sets 1; a skipped run is a distinct outcome from a failed one.
  process.exitCode = exitCode;
}

export function registerBaselineRunGuardCommand(baseline: Command, io: ProgramIO): void {
  baseline
    .command('run-guard')
    .description(
      'Run the guard contracts over the frozen baseline. Runs all 15 journeys unless --journey is given.'
    )
    .option(
      '--journey <id>',
      `Run only one journey (${P0_JOURNEY_IDS.join('|')}); default is all 15.`
    )
    .option('--project <path>', 'Project root', '.')
    .option('--json', 'Emit JSON envelope')
    .action((opts: { journey?: string; project?: string }) => runGuard(io, opts));
}
