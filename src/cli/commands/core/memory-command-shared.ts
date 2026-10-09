import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../../cli-helpers.js';

/** A `--dry-run --apply` refusal, resolved per verb. */
export type FlagConflict = {
  readonly command: string;
  readonly code: string;
  readonly nextActions: readonly string[];
  readonly json: boolean | undefined;
  readonly dryRun: boolean | undefined;
  readonly apply: boolean | undefined;
};

/**
 * `--dry-run` and `--apply` are mutually exclusive: previewing and writing in
 * one invocation has no defined meaning, so refuse before any work happens.
 */
export function refuseBothFlags(io: ProgramIO, conflict: FlagConflict): boolean {
  if (!(conflict.dryRun === true && conflict.apply === true)) return false;
  printResult(
    io,
    fail(conflict.command, conflict.code, 'Use either --dry-run or --apply, not both', {}, [
      ...conflict.nextActions
    ]),
    conflict.json
  );
  process.exitCode = 1;
  return true;
}

/** A verb whose lazy `memory-commands.ts` import or run failed. */
export type BootstrapFailure = {
  readonly command: string;
  readonly code: string;
  readonly message: string;
  readonly json: boolean | undefined;
  readonly nextActions?: readonly string[] | undefined;
};

/** Print the `*_BOOTSTRAP_FAILED` envelope and mark the process failed. */
export function emitBootstrapFailure(io: ProgramIO, failure: BootstrapFailure): void {
  printResult(
    io,
    fail(failure.command, failure.code, failure.message, {}, [...(failure.nextActions ?? [])]),
    failure.json
  );
  process.exitCode = 1;
}
