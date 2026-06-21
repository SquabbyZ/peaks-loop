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
 */
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { scanAssertions } from '../../services/mut/assert-scanner.js';
import { runMutation, type StrykerInvoker } from '../../services/mut/mut-runner.js';
import { buildMutReport } from '../../services/mut/report-builder.js';
import { createProductionStrykerInvoker } from '../../services/mut/production-stryker.js';
import { MutReportSchema } from '../../services/mut/types.js';
import type { AssertionsReport, MutationReport } from '../../services/mut/types.js';
import type { ProgramIO } from '../cli-helpers.js';

export interface MutCommandsOptions {
  readonly invokeStryker: StrykerInvoker;
}

/**
 * Pure helper: a stub AssertionsReport used when only Stryker ran.
 * The mutants-only path does NOT touch the AST scanner; we still need
 * a structurally-valid `assertions` block so the Zod schema accepts
 * the assembled report.
 */
function emptyAssertions(): AssertionsReport {
  return {
    totalAssertions: 0,
    weakAssertions: 0,
    weakRate: 0,
    weakPatterns: [],
  };
}

/**
 * Pure helper: a stub MutationReport used when only the assertion
 * scan ran. Mirrors the asserts-only path's invariants (killRate = 0,
 * mutantsTotal = 0, tool = 'stryker' for forward compatibility).
 */
function emptyMutation(): MutationReport {
  return {
    tool: 'stryker',
    mutantsTotal: 0,
    mutantsKilled: 0,
    mutantsSurvived: 0,
    mutantsTimeout: 0,
    killRate: 0,
    byFile: [],
  };
}

/**
 * Emit a one-line JSON envelope describing the run's outcome. Used by
 * both `--json` and the human-readable branches so the `passed` /
 * `sha256` shape stays consistent regardless of TTY mode.
 */
function emitSummary(
  json: boolean,
  payload: { ok: true; sha256: string; passed: boolean; path: string }
): void {
  if (json) {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    process.stdout.write(`mut-report.json: ${payload.path}\nsha256: ${payload.sha256}\npassed: ${payload.passed}\n`);
  }
}

/**
 * Construct the `peaks mut` family as a standalone Commander command.
 * Returns the parent `mut` Command so callers can attach it under any
 * root program (used both by `registerMutCommands` in production and
 * directly by the unit tests).
 */
export function createMutCommands(opts: MutCommandsOptions): Command {
  const mut = new Command('mut').description(
    'peaks-mut: mutation testing + assertion validity scan (spec §4.2 / §7)'
  );

  mut
    .command('run')
    .description('Run the full mut pipeline (Stryker + assertion scan + report). One-axis: --session-id required.')
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to mutate against')
    .requiredOption('--input-sig <hex>', 'TACT.sig (sha256) for chain')
    .requiredOption('--session-id <sid>', 'session id; CLI writes artifacts only under .peaks/_runtime/<sid>/mut/ (one-axis layout)')
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: {
      project: string;
      testFiles: string[];
      inputSig: string;
      sessionId: string;
      out: string;
      json: boolean;
    }) => {
      const { mutation } = await runMutation({
        project: a.project,
        testFiles: a.testFiles,
        invokeStryker: opts.invokeStryker,
      });
      const assertions = await scanAssertions({
        project: a.project,
        testFiles: a.testFiles,
      });
      const report = await buildMutReport({
        inputSig: a.inputSig,
        out: a.out,
        mutation,
        assertions,
      });
      emitSummary(a.json, {
        ok: true,
        sha256: report.sha256,
        passed: report.thresholds.passed,
        path: a.out,
      });
      if (!report.thresholds.passed) {
        // H6: CLI裁决 — threshold breach is a non-zero exit so callers
        // (peaks-rd, peaks-qa, CI) can block on it without parsing
        // stdout.
        process.exitCode = 1;
      }
    });

  mut
    .command('mutants')
    .description('Run Stryker only; write a stub-assertions mut-report.json. One-axis: --session-id required.')
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to mutate against')
    .requiredOption('--input-sig <hex>', 'TACT.sig')
    .requiredOption('--session-id <sid>', 'session id')
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: {
      project: string;
      testFiles: string[];
      inputSig: string;
      sessionId: string;
      out: string;
      json: boolean;
    }) => {
      const { mutation } = await runMutation({
        project: a.project,
        testFiles: a.testFiles,
        invokeStryker: opts.invokeStryker,
      });
      const report = await buildMutReport({
        inputSig: a.inputSig,
        out: a.out,
        mutation,
        assertions: emptyAssertions(),
      });
      emitSummary(a.json, {
        ok: true,
        sha256: report.sha256,
        passed: report.thresholds.passed,
        path: a.out,
      });
      if (!report.thresholds.passed) {
        process.exitCode = 1;
      }
    });

  mut
    .command('asserts')
    .description('Run the assertion scan only; write a mut-report.json with empty mutation block. One-axis: --session-id required.')
    .requiredOption('--project <path>', 'project root')
    .requiredOption('--test-files <files...>', 'test files to scan')
    .requiredOption('--input-sig <hex>', 'TACT.sig')
    .requiredOption('--session-id <sid>', 'session id')
    .requiredOption('--out <path>', 'output path for mut-report.json')
    .option('--json', 'machine-readable output', false)
    .action(async (a: {
      project: string;
      testFiles: string[];
      inputSig: string;
      sessionId: string;
      out: string;
      json: boolean;
    }) => {
      const assertions = await scanAssertions({
        project: a.project,
        testFiles: a.testFiles,
      });
      const report = await buildMutReport({
        inputSig: a.inputSig,
        out: a.out,
        mutation: emptyMutation(),
        assertions,
      });
      emitSummary(a.json, {
        ok: true,
        sha256: report.sha256,
        passed: report.thresholds.passed,
        path: a.out,
      });
      if (!report.thresholds.passed) {
        process.exitCode = 1;
      }
    });

  mut
    .command('report')
    .description('Re-read a previously-written mut-report.json (no Stryker / scan invocation). One-axis: --session-id required for the audit trail.')
    .requiredOption('--in <path>', 'input mut-report.json path')
    .requiredOption('--session-id <sid>', 'session id')
    .option('--json', 'machine-readable output', false)
    .action(async (a: { in: string; sessionId: string; json: boolean }) => {
      const raw = await readFile(a.in, 'utf8');
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch (err: unknown) {
        process.stderr.write(`INVALID_JSON: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exitCode = 2;
        return;
      }
      const parsed = MutReportSchema.safeParse(parsedJson);
      if (!parsed.success) {
        process.stderr.write(`INVALID: ${parsed.error.message}\n`);
        process.exitCode = 2;
        return;
      }
      const r = parsed.data;
      const summary = {
        mutation: {
          tool: r.mutation.tool,
          killRate: r.mutation.killRate,
        },
        assertions: {
          total: r.assertions.totalAssertions,
          weak: r.assertions.weakAssertions,
          weakRate: r.assertions.weakRate,
        },
        thresholds: { passed: r.thresholds.passed },
        followups: r.followups.length,
        sha256: r.sha256,
        sessionId: a.sessionId,
      };
      if (a.json) {
        process.stdout.write(JSON.stringify(summary) + '\n');
      } else {
        process.stdout.write([
          `mutation: tool=${r.mutation.tool} killRate=${(r.mutation.killRate * 100).toFixed(1)}%`,
          `assertions: total=${r.assertions.totalAssertions} weak=${r.assertions.weakAssertions} rate=${(r.assertions.weakRate * 100).toFixed(1)}%`,
          `thresholds: passed=${r.thresholds.passed}`,
          `followups: ${r.followups.length}`,
          `sha256: ${r.sha256}`,
        ].join('\n') + '\n');
      }
      if (!r.thresholds.passed) {
        process.exitCode = 1;
      }
    });

  return mut;
}

/**
 * Program-level wiring: attach the `peaks mut` family to the root
 * program with the production Stryker invoker. Tests should use
 * `createMutCommands({ invokeStryker })` instead so the heavy
 * @stryker-mutator/core runtime stays out of the unit-test path.
 */
export function registerMutCommands(program: Command, _io: ProgramIO): void {
  const invokeStryker = createProductionStrykerInvoker();
  program.addCommand(createMutCommands({ invokeStryker }));
}