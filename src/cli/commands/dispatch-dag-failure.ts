import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';

/** One refusal from the `--from-dag` path, as the fields the envelope needs. */
export type DagFailure = {
  readonly role: string;
  readonly code: string;
  readonly message: string;
  readonly extra?: Record<string, unknown>;
  readonly nextActions: readonly string[];
};

/**
 * Emit a `sub-agent.dispatch` failure envelope and mark the process failed.
 *
 * Returns `null` so every caller can read `if (readDag(...) === null) return;`
 * — the three statements (print, exit code, return) are one decision and stay
 * together, which is also what keeps each call site inside
 * `max-lines-per-function`.
 */
export function emitDagFailure(io: ProgramIO, asJson: boolean, failure: DagFailure): null {
  const { role, code, message, extra, nextActions } = failure;
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      code,
      message,
      { role, toolCall: null, dispatchRecordPath: null, ...extra } as never,
      [...nextActions]
    ),
    asJson
  );
  process.exitCode = 1;
  return null;
}
