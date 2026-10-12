// Split out of `request-commands.ts`: the
// typed failure arms of `peaks request transition`. Each branch is a
// printer + exit-code pair, kept one per function so the dispatcher stays
// readable and every branch keeps setting `process.exitCode = 1`.
import { InvalidArgumentError } from 'commander';
import {
  PrerequisitesNotSatisfiedError,
  LintGateError,
  TypeSanityViolationError,
  FileSizeViolationError
} from '../../services/artifacts/request-artifact-service.js';
import { StateOrderViolationError } from '../../services/artifacts/request-state-order.js';
import { ConfirmationRequiredError } from '../../services/mode/mode-enforcement.js';
import { fail } from 'peaks-loop-shared/result';

import {
  getErrorMessage,
  printableWarningText,
  printResult,
  type ProgramIO
} from '../cli-helpers.js';
import type { RequestTransitionOptions } from './request-command-options.js';

function reportPrerequisitesFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  error: PrerequisitesNotSatisfiedError
): void {
  // The `warnings` list is surfaced inside the 1-minor-release back-compat
  // window (e.g. MUT_REPORT) so the operator sees both the hard-blocked
  // `missing` paths and the soft-blocked ones. `warnings` is always present
  // (possibly empty) to keep the response shape stable.
  printResult(
    io,
    fail(
      'request.transition',
      error.code,
      error.message,
      {
        role: error.role,
        newState: error.newState,
        sessionId: error.sessionId,
        missing: error.missing,
        warnings: error.warnings
      },
      [
        ...error.missing.map((entry) => `Produce ${entry.path}: ${entry.description}`),
        // Sanitised for the same reason the success branch sanitises: a
        // `gateEvidence.<key>` warning can carry a control character decoded out
        // of the handoff frontmatter, and `printResult` puts these on stderr.
        ...error.warnings.map(
          (w) =>
            `Soft-blocked (v2.13.3 back-compat window): ${printableWarningText(w.path)} — ` +
            `${printableWarningText(w.message)}`
        ),
        'Once every required artifact exists, rerun this transition.',
        'For exceptional cases (docs-only / config-only change), bypass with: --allow-incomplete --reason "<justification>"'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function reportLintGateFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  error: LintGateError
): void {
  printResult(
    io,
    fail(
      'request.transition',
      error.code,
      error.message,
      { role: error.role, newState: error.newState, errorCount: error.errorCount },
      [
        'Fix lint errors in the artifact before transitioning.',
        'Run `peaks request lint --role <role> --id <rid> --project <path>` to see details.',
        'Or bypass with: --allow-incomplete --reason "<justification>"'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function reportStateOrderFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  error: StateOrderViolationError
): void {
  printResult(
    io,
    fail(
      'request.transition',
      error.code,
      error.message,
      {
        role: error.role,
        from: error.from,
        newState: error.to,
        skipped: error.skipped
      },
      [
        error.kind === 'unreadable'
          ? "Restore the artifact's '- state:' line: an unreadable state fails this gate closed"
          : `Walk the states in order — from '${error.from}' the next legal state is ` +
            `'${error.skipped[0] ?? error.to}'`,
        'Or bypass with: --allow-incomplete --reason "<justification>"'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function reportTypeSanityFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  error: TypeSanityViolationError
): void {
  printResult(
    io,
    fail(
      'request.transition',
      error.code,
      error.message,
      {
        declaredType: error.declaredType,
        suggestedTypes: error.suggestedTypes,
        rationale: error.rationale
      },
      [
        `Re-classify the request — likely correct type: ${error.suggestedTypes.join(' | ')}`,
        'Or, if the declared type is correct, surface the mismatch reason to the user.'
      ]
    ),
    options.json
  );
  process.exitCode = 1;
}

function reportFileSizeFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  error: FileSizeViolationError
): void {
  printResult(
    io,
    fail('request.transition', error.code, error.message, { violations: error.violations }, [
      ...error.violations.map((v) =>
        v.previousLines === null
          ? `Split ${v.file} (${v.lines} lines) below its ${v.cap}-line cap — this change created it over the cap`
          : `Split ${v.file} back below its ${v.cap}-line cap, or at least down to the ${v.previousLines} lines it had at the base ref (grew +${v.lines - v.previousLines})`
      ),
      'Or bypass with: --allow-incomplete --reason "<justification>"'
    ]),
    options.json
  );
  process.exitCode = 1;
}

function reportConfirmationFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  requestId: string,
  error: ConfirmationRequiredError
): void {
  printResult(
    io,
    fail(
      'request.transition',
      'CONFIRMATION_REQUIRED',
      error.message,
      { role: options.role, requestId, transitionKey: error.transitionKey, mode: error.mode },
      [...error.nextActions]
    ),
    options.json
  );
  process.exitCode = 1;
}

/**
 * Map a thrown transition error to its envelope. `InvalidArgumentError` is
 * re-thrown: Commander raises it for an unparsable `--state`, and swallowing it
 * here would report a usage error as a transition failure.
 */
export function reportTransitionFailure(
  io: ProgramIO,
  options: RequestTransitionOptions,
  requestId: string,
  error: unknown
): void {
  if (error instanceof InvalidArgumentError) {
    throw error;
  }
  if (error instanceof PrerequisitesNotSatisfiedError) {
    reportPrerequisitesFailure(io, options, error);
    return;
  }
  if (error instanceof LintGateError) {
    reportLintGateFailure(io, options, error);
    return;
  }
  if (error instanceof StateOrderViolationError) {
    reportStateOrderFailure(io, options, error);
    return;
  }
  if (error instanceof TypeSanityViolationError) {
    reportTypeSanityFailure(io, options, error);
    return;
  }
  if (error instanceof FileSizeViolationError) {
    reportFileSizeFailure(io, options, error);
    return;
  }
  if (error instanceof ConfirmationRequiredError) {
    reportConfirmationFailure(io, options, requestId, error);
    return;
  }
  printResult(
    io,
    fail(
      'request.transition',
      'REQUEST_TRANSITION_FAILED',
      getErrorMessage(error),
      { role: options.role, requestId },
      ['Check role, request id, state, and project path before retrying']
    ),
    options.json
  );
  process.exitCode = 1;
}
