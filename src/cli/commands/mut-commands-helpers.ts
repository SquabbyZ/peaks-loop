/**
 * `peaks mut` — command builders and helper functions.
 *
 * Originally extracted from `mut-commands.ts` (file-size cap campaign).
 * It holds the stub-report factories, the summary emitter, the named-error
 * mapping, and — after the `max-lines-per-function` rule was measured at
 * 209 code lines for `createMutCommands` — the three subcommand builders
 * that drive the mutation pipeline (`run`, `mutants`, `asserts`).
 * The `report` subcommand — a pure reader of an already-written file —
 * lives with the CLI surface in `mut-commands.ts`.
 *
 * The named-error part exists for R7: a missing or unloadable mutation
 * toolchain must surface a MACHINE-READABLE error code (for example
 * `MUT_TOOLCHAIN_UNAVAILABLE`) plus an actionable message and a
 * non-zero exit code — never `UNHANDLED_ERROR` with a bare
 * "Cannot find package". The same rule now covers a missing `--test-files`
 * path (`MUT_TEST_FILE_NOT_FOUND`).
 */
import { Command } from 'commander';
import {
  assertTestFilesUsable,
  buildMutReport,
  runMutation,
  scanAssertions,
  type AssertionsReport,
  type MutationReport,
  type StrykerInvoker
} from 'peaks-loop-mut';
import { printErrorEnvelope, type ProgramIO } from '../cli-helpers.js';

/**
 * Fallback code for a mutation failure that carries no named code of its
 * own. The production invoker raises the specific codes; anything that
 * escapes it without one still gets a stable, greppable name.
 */
export const MUT_CLI_ERROR_CODE = 'MUT_FAILED';

/** Named mutation codes are always `MUT_` + upper snake case. */
const NAMED_CODE_PATTERN = /^MUT_[A-Z0-9_]+$/;

/**
 * The IO the mut family writes to when the caller injects none. Same
 * shape as `src/cli/program.ts`'s default sinks: one trailing newline
 * per write.
 */
export const DEFAULT_MUT_IO: ProgramIO = {
  stdout: (text: string) => process.stdout.write(`${text}\n`),
  stderr: (text: string) => process.stderr.write(`${text}\n`)
};

/** The options every Stryker-backed subcommand receives. */
export interface MutCommandArgs {
  readonly project: string;
  readonly testFiles: string[];
  readonly mutate?: string[];
  readonly inputSig: string;
  readonly sessionId: string;
  readonly out: string;
  readonly json: boolean;
}

/**
 * Pure helper: a stub AssertionsReport used when only Stryker ran.
 * The mutants-only path does NOT touch the AST scanner; we still need
 * a structurally-valid `assertions` block so the Zod schema accepts
 * the assembled report.
 */
export function emptyAssertions(): AssertionsReport {
  return {
    totalAssertions: 0,
    weakAssertions: 0,
    weakRate: 0,
    weakPatterns: []
  };
}

/**
 * Pure helper: a stub MutationReport used when only the assertion
 * scan ran. Mirrors the asserts-only path's invariants (killRate = 0,
 * mutantsTotal = 0, tool = 'stryker' for forward compatibility).
 */
export function emptyMutation(): MutationReport {
  return {
    tool: 'stryker',
    mutantsTotal: 0,
    mutantsKilled: 0,
    mutantsSurvived: 0,
    mutantsTimeout: 0,
    killRate: 0,
    byFile: []
  };
}

/**
 * Emit a one-line JSON envelope describing the run's outcome. Used by
 * both `--json` and the human-readable branches so the `passed` /
 * `sha256` shape stays consistent regardless of TTY mode.
 */
export function emitSummary(
  io: ProgramIO,
  json: boolean,
  payload: { ok: true; sha256: string; passed: boolean; path: string }
): void {
  if (json) {
    io.stdout(JSON.stringify(payload));
    return;
  }
  io.stdout(
    `mut-report.json: ${payload.path}\nsha256: ${payload.sha256}\npassed: ${payload.passed}`
  );
}

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
 */
export function emitMutError(io: ProgramIO, err: unknown): void {
  const details = (err as { details?: unknown } | null)?.details;
  const data = details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
  printErrorEnvelope(io, 'mut', mutErrorCode(err), mutErrorMessage(err), data, []);
}

/**
 * Validate `--test-files` BEFORE any Stryker run, scan or report write: a
 * missing path must fail with the named code, never reach the mutation
 * engine. A PATTERN is accepted here — Stryker expands patterns.
 */
function assertMutTestFiles(a: MutCommandArgs): void {
  assertTestFilesUsable({ project: a.project, testFiles: a.testFiles, allowPatterns: true });
}

/**
 * `peaks mut run` — the full mut pipeline (Stryker + assertion scan +
 * report). One-axis: --session-id required.
 */ export function buildMutRunCommand(invokeStryker: StrykerInvoker, io: ProgramIO): Command {
  return new Command('run')
    .description(
      'Run the full mut pipeline (Stryker + assertion scan + report). One-axis: --session-id required.'
    )
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to mutate against')
    .option('--mutate <patterns...>', 'source patterns to mutate, relative to --project')
    .requiredOption('--input-sig <hex>', 'TACT.sig (sha256) for chain')
    .requiredOption(
      '--session-id <sid>',
      'session id; CLI writes artifacts only under .peaks/_runtime/<sid>/mut/ (one-axis layout)'
    )
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: MutCommandArgs) => {
      try {
        assertMutTestFiles(a);
        const { mutation } = await runMutation({
          project: a.project,
          testFiles: a.testFiles,
          mutate: a.mutate ?? [],
          invokeStryker
        });
        const assertions = await scanAssertions({
          project: a.project,
          testFiles: a.testFiles
        });
        const report = await buildMutReport({
          inputSig: a.inputSig,
          out: a.out,
          mutation,
          assertions
        });
        emitSummary(io, a.json, {
          ok: true,
          sha256: report.sha256,
          passed: report.thresholds.passed,
          path: a.out
        });
        if (!report.thresholds.passed) {
          // H6: CLI裁决 — threshold breach is a non-zero exit so callers
          // (peaks-rd, peaks-qa, CI) can block on it without parsing stdout.
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        // R7: a named code + actionable message + non-zero exit, never an
        // UNHANDLED_ERROR envelope with a bare "Cannot find package".
        emitMutError(io, err);
      }
    });
}

/**
 * `peaks mut mutants` — Stryker only; writes a stub-assertions
 * mut-report.json. One-axis: --session-id required.
 */
export function buildMutMutantsCommand(invokeStryker: StrykerInvoker, io: ProgramIO): Command {
  return new Command('mutants')
    .description(
      'Run Stryker only; write a stub-assertions mut-report.json. One-axis: --session-id required.'
    )
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to mutate against')
    .option('--mutate <patterns...>', 'source patterns to mutate, relative to --project')
    .requiredOption('--input-sig <hex>', 'TACT.sig')
    .requiredOption('--session-id <sid>', 'session id')
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: MutCommandArgs) => {
      try {
        assertMutTestFiles(a);
        const { mutation } = await runMutation({
          project: a.project,
          testFiles: a.testFiles,
          mutate: a.mutate ?? [],
          invokeStryker
        });
        const report = await buildMutReport({
          inputSig: a.inputSig,
          out: a.out,
          mutation,
          assertions: emptyAssertions()
        });
        emitSummary(io, a.json, {
          ok: true,
          sha256: report.sha256,
          passed: report.thresholds.passed,
          path: a.out
        });
        if (!report.thresholds.passed) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        emitMutError(io, err);
      }
    });
}

/**
 * `peaks mut asserts` — the assertion scan only; writes a mut-report.json
 * with an empty mutation block. One-axis: --session-id required.
 */
export function buildMutAssertsCommand(io: ProgramIO): Command {
  return new Command('asserts')
    .description(
      'Run the assertion scan only; write a mut-report.json with empty mutation block. One-axis: --session-id required.'
    )
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to scan')
    .requiredOption('--input-sig <hex>', 'TACT.sig')
    .requiredOption('--session-id <sid>', 'session id')
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: MutCommandArgs) => {
      try {
        assertMutTestFiles(a);
        const assertions = await scanAssertions({
          project: a.project,
          testFiles: a.testFiles
        });
        const report = await buildMutReport({
          inputSig: a.inputSig,
          out: a.out,
          mutation: emptyMutation(),
          assertions
        });
        emitSummary(io, a.json, {
          ok: true,
          sha256: report.sha256,
          passed: report.thresholds.passed,
          path: a.out
        });
        if (!report.thresholds.passed) {
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        emitMutError(io, err);
      }
    });
}
