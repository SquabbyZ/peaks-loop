/**
 * `peaks mut <sub>` — CLI surface for the mutation test-quality skill.
 * Per spec §4.2 验收审计 + §7 阶段二.
 *
 * Hard rules:
 *   - One-axis envelope layout (Plan 1 followup hotfix, commit 81f00ce):
 *     `--session-id` is REQUIRED on every artifact-producing subcommand,
 *     and `--change-id` is NEVER accepted on the parser.
 *   - H6 (CLI裁决, not LLM): `thresholds.passed` is computed by the
 *     ReportBuilder, not by the LLM. The CLI merely surfaces it.
 *   - H8 (audit trail hashable): every artifact carries a 64-hex sha256
 *     that chains back to TACT.sig via the `inputSig` field.
 *   - KISS: keep the public surface narrow — run / mutants / asserts /
 *     report. The CLI is a thin orchestrator over the service layer.
 *
 * The three subcommands that drive the mutation pipeline (`run`, `mutants`,
 * `asserts`) live in `mut-commands-helpers.ts`; this file assembles them
 * and owns `report` — a pure reader of an already-written file. The split
 * keeps `createMutCommands` inside the `max-lines-per-function` budget
 * (50 code lines); it measured 209 before the split.
 */
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  createProductionStrykerInvoker,
  MutReportSchema,
  type MutReportJson,
  type StrykerInvoker
} from 'peaks-loop-mut';
import type { ProgramIO } from '../cli-helpers.js';
import {
  buildMutAssertsCommand,
  buildMutMutantsCommand,
  buildMutRunCommand,
  DEFAULT_MUT_IO
} from './mut-commands-helpers.js';

export interface MutCommandsOptions {
  readonly invokeStryker: StrykerInvoker;
  /** Where the command writes. Defaults to stdout/stderr. */
  readonly io?: ProgramIO;
}

/**
 * Construct the `peaks mut` family as a standalone Commander command.
 * Returns the parent `mut` Command so callers can attach it under any
 * root program (used both by `registerMutCommands` in production and
 * directly by the unit tests).
 */
export function createMutCommands(opts: MutCommandsOptions): Command {
  const io = opts.io ?? DEFAULT_MUT_IO;
  const mut = new Command('mut').description(
    'peaks-mut: mutation testing + assertion validity scan (spec §4.2 / §7)'
  );
  mut.addCommand(buildMutRunCommand(opts.invokeStryker, io));
  mut.addCommand(buildMutMutantsCommand(opts.invokeStryker, io));
  mut.addCommand(buildMutAssertsCommand(io));
  mut.addCommand(buildMutReportCommand(io));
  return mut;
}

/**
 * Program-level wiring: attach the `peaks mut` family to the root
 * program with the production Stryker invoker. Tests should use
 * `createMutCommands({ invokeStryker })` instead so the heavy
 * @stryker-mutator/core runtime stays out of the unit-test path.
 */
export function registerMutCommands(program: Command, io: ProgramIO): void {
  const invokeStryker = createProductionStrykerInvoker();
  program.addCommand(createMutCommands({ invokeStryker, io }));
}

/**
 * `peaks mut report` — re-read a previously-written mut-report.json (no
 * Stryker / scan invocation). One-axis: --session-id required for the
 * audit trail.
 */
export function buildMutReportCommand(io: ProgramIO): Command {
  return new Command('report')
    .description(
      'Re-read a previously-written mut-report.json (no Stryker / scan invocation). One-axis: --session-id required for the audit trail.'
    )
    .requiredOption('--in <path>', 'input mut-report.json path')
    .requiredOption('--session-id <sid>', 'session id')
    .option('--json', 'machine-readable output', false)
    .action(async (a: { in: string; sessionId: string; json: boolean }) => {
      const read = await readMutReportForDisplay(a.in);
      if (!read.ok) {
        io.stderr(read.message);
        process.exitCode = read.exitCode;
        return;
      }
      renderMutReportSummary(io, read.report, a.sessionId, a.json);
      if (!read.report.thresholds.passed) {
        process.exitCode = 1;
      }
    });
}

/** The outcome of reading a report file for display. */
type MutReportRead =
  | { readonly ok: true; readonly report: MutReportJson }
  | { readonly ok: false; readonly exitCode: 2; readonly message: string };

/**
 * Read + validate a mut-report.json. A malformed file is a display
 * failure (exit code 2), not a crash — the original `report` subcommand
 * behaved that way and the behavior is preserved.
 */
async function readMutReportForDisplay(inPath: string): Promise<MutReportRead> {
  const raw = await readFile(inPath, 'utf8');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: 2, message: `INVALID_JSON: ${detail}` };
  }
  const parsed = MutReportSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, exitCode: 2, message: `INVALID: ${parsed.error.message}` };
  }
  return { ok: true, report: parsed.data };
}

/** Render the report summary as one JSON line or a human-readable block. */
function renderMutReportSummary(
  io: ProgramIO,
  report: MutReportJson,
  sessionId: string,
  json: boolean
): void {
  const summary = {
    mutation: { tool: report.mutation.tool, killRate: report.mutation.killRate },
    assertions: {
      total: report.assertions.totalAssertions,
      weak: report.assertions.weakAssertions,
      weakRate: report.assertions.weakRate
    },
    thresholds: { passed: report.thresholds.passed },
    followups: report.followups.length,
    sha256: report.sha256,
    sessionId
  };
  if (json) {
    io.stdout(JSON.stringify(summary));
    return;
  }
  io.stdout(
    [
      `mutation: tool=${report.mutation.tool} killRate=${(report.mutation.killRate * 100).toFixed(1)}%`,
      `assertions: total=${report.assertions.totalAssertions} weak=${report.assertions.weakAssertions} rate=${(report.assertions.weakRate * 100).toFixed(1)}%`,
      `thresholds: passed=${report.thresholds.passed}`,
      `followups: ${report.followups.length}`,
      `sha256: ${report.sha256}`
    ].join('\n')
  );
}
