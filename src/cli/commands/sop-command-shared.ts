// src/cli/commands/sop-command-shared.ts
//
// What every `peaks sop *` verb emits: the success envelope and the failure
// envelope, both with the family's `ok`/`fail` shape and the `--json` switch.
// Split out of `sop-commands.ts`; no envelope field or exit code changed.

import { fail, ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';

/** The `--project` / `--json` pair every verb in this family declares. */
export type SopBaseOptions = {
  project?: string;
  json?: boolean;
};

/** The fields a family success envelope carries. */
export type SopOutcome = {
  readonly json: boolean | undefined;
  readonly command: string;
  readonly data: unknown;
  readonly nextActions?: readonly string[];
};

/** The fields a family failure envelope carries. */
export type SopFailure = SopOutcome & {
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
};

/** Print the family's success envelope. */
export function printSopOk(io: ProgramIO, outcome: SopOutcome): void {
  printResult(
    io,
    ok(outcome.command, outcome.data, [], [...(outcome.nextActions ?? [])]),
    outcome.json ?? false
  );
}

/** Print the family's failure envelope and mark the process failed. */
export function printSopFailure(io: ProgramIO, failure: SopFailure): void {
  printResult(
    io,
    fail(failure.command, failure.code, failure.message, failure.data, [
      ...(failure.nextActions ?? [])
    ]),
    failure.json ?? false
  );
  process.exitCode = 1;
}
