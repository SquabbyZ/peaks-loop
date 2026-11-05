/**
 * The failure surface of `peaks mut` — the named-error mapping and the
 * diagnostic file a failed Stryker run leaves behind.
 *
 * WHY IT IS ITS OWN MODULE
 * -------------------------
 * R7 needs a MACHINE-READABLE error code (for example
 * `MUT_TOOLCHAIN_UNAVAILABLE`) plus an actionable message and a non-zero
 * exit code — never `UNHANDLED_ERROR` with a bare "Cannot find package".
 * The Stryker-backed subcommands ALSO need the failure written down:
 * Stryker reports several distinct failures as the bare
 * "Something went wrong in the initial test run", and because the runner
 * keeps its console log off (`logLevel: 'off'`, stdout belongs to the
 * `--json` envelope) its own file log is the only place the real reason
 * appears. The production invoker captures that log into the error's
 * `details.strykerLog`; this module turns the error into the file and the
 * envelope that points at it.
 *
 * Split out of `mut-commands-helpers.ts` for the `src/` raw-line cap (300).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { printErrorEnvelope, type ProgramIO } from '../cli-helpers.js';

/**
 * Fallback code for a mutation failure that carries no named code of its
 * own. The production invoker raises the specific codes; anything that
 * escapes it without one still gets a stable, greppable name.
 */
export const MUT_CLI_ERROR_CODE = 'MUT_FAILED';

/** Named mutation codes are always `MUT_` + upper snake case. */
const NAMED_CODE_PATTERN = /^MUT_[A-Z0-9_]+$/;

/** How many `cause` links the diagnostic walks before it stops. */
const MAX_CAUSE_DEPTH = 4;

/**
 * Read the machine-readable code off a failure. The production invoker
 * raises named codes (`MUT_TOOLCHAIN_UNAVAILABLE`, `MUT_NO_MUTANTS`,
 * `MUT_MUTATE_PATTERN_REQUIRED`, …) and `runMutation` preserves them
 * while wrapping. Anything without a recognised code falls back to
 * `MUT_FAILED` so the envelope is never anonymous.
 */
export function mutErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && NAMED_CODE_PATTERN.test(code)) {
      return code;
    }
  }
  return MUT_CLI_ERROR_CODE;
}

/** The human-readable half of the envelope. */
export function mutErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Emit the failure envelope on stderr and set a non-zero exit code. Its
 * `data` field carries the machine-readable detail — where an ABSOLUTE path
 * belongs; stdout stays reserved for the `--json` payload (R6).
 *
 * `diagnosticPath` is set by the Stryker-backed subcommands. When it is
 * given the failure is ALSO written to that file, together with Stryker's
 * own file log when the invoker captured one. The path is then named in the
 * envelope's `data` and `nextActions` so the next caller does not have to
 * guess it.
 */
export function emitMutError(io: ProgramIO, err: unknown, diagnosticPath?: string): void {
  const details = mutErrorDetails(err);
  const written = diagnosticPath
    ? writeMutFailureDiagnostic(diagnosticPath, err, details)
    : undefined;
  // Stryker's log can be large; it belongs in the file, not in stderr.
  const data: Record<string, unknown> = { ...details };
  delete data.strykerLog;
  if (written?.ok) {
    data.diagnosticPath = written.path;
  } else if (written) {
    // The original failure stays primary; this only says the file is absent.
    data.diagnosticWriteFailure = written.reason;
  }
  printErrorEnvelope(
    io,
    'mut',
    mutErrorCode(err),
    mutErrorMessage(err),
    data,
    written?.ok ? [`Read the Stryker diagnostic log at ${written.path}`] : []
  );
}

/** The machine-readable `details` an invoker attached to its error, if any. */
function mutErrorDetails(err: unknown): Record<string, unknown> {
  const details = (err as { details?: unknown } | null)?.details;
  return details && typeof details === 'object' ? { ...(details as Record<string, unknown>) } : {};
}

/**
 * Where a failed Stryker run writes its diagnostic — NEXT TO the report the
 * run was going to produce, so both artifacts of one run live together.
 */
export function mutationFailureLogPath(outPath: string): string {
  return join(dirname(resolve(outPath)), 'stryker-failure.log');
}

/**
 * What became of the diagnostic write. A discriminated result rather than
 * `string | undefined`, so a caller cannot mistake a failed write for "no
 * diagnostic requested" — and a diagnostic must never mask the original error.
 */
export type MutDiagnosticResult =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string };

/** Persist the failure; the reason a write failed is kept, not swallowed. */
export function writeMutFailureDiagnostic(
  path: string,
  err: unknown,
  details: Record<string, unknown>
): MutDiagnosticResult {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderMutFailureLog(err, details), 'utf8');
    return { ok: true, path };
  } catch (writeError) {
    const reason = writeError instanceof Error ? writeError.message : String(writeError);
    return { ok: false, reason };
  }
}

/** The diagnostic file's body: what failed, and whatever Stryker logged. */
function renderMutFailureLog(err: unknown, details: Record<string, unknown>): string {
  const lines = [
    '# peaks mut failure diagnostic',
    `time: ${new Date().toISOString()}`,
    `code: ${mutErrorCode(err)}`,
    `message: ${mutErrorMessage(err)}`,
    '',
    '## Error',
    err instanceof Error ? (err.stack ?? err.message) : String(err)
  ];
  const causes = describeCauses(err);
  if (causes.length > 0) {
    lines.push('', '## Cause chain', ...causes);
  }
  const strykerLog = details.strykerLog;
  if (typeof strykerLog === 'string' && strykerLog.trim().length > 0) {
    lines.push('', '## Stryker log', strykerLog.trimEnd());
  }
  return `${lines.join('\n')}\n`;
}

/** The `cause` chain of an error, nearest first. Bounded so it cannot loop. */
function describeCauses(err: unknown, depth = 0): string[] {
  if (depth >= MAX_CAUSE_DEPTH || !err || typeof err !== 'object') {
    return [];
  }
  const cause = (err as { cause?: unknown }).cause;
  if (!cause) {
    return [];
  }
  return [describeCause(cause), ...describeCauses(cause, depth + 1)];
}

/** `Error`s keep their stack; anything else is serialised, never stringified blind. */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.stack ?? cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  return JSON.stringify(cause) ?? 'unserialisable cause';
}
