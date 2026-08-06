/**
 * `peaks code lint` — read-only ESLint verifier (Gate B5).
 *
 * PRD-002b slice: three subcommands expose the runner's new
 * incremental-first / no-touch-stockcode options to the CLI surface.
 *
 *   - `peaks lint baseline` — one-shot full-repo scan; writes
 *     `.peaks/lint/baseline.json` (project-level, gitignored by
 *     default). Each project regenerates its own baseline; the file
 *     is project-aware (D6 binding).
 *   - `peaks lint check` — default; diffOnly=true + baselineFile
 *     waiver + redLineMode='baseline-aware'. This is the LLM-facing
 *     Gate B5 entry point.
 *   - `peaks lint --red-line` — write
 *     `.peaks/memory/lint-redline-summary.md` so the next LLM
 *     invocation can read the cross-project red-line before
 *     writing more code (supplementary S2 dual-track).
 */
import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectEslint } from '../../services/lint/detect-eslint.js';
import { runEslint, type EslintRunOptions, type EslintRunResult } from '../../services/lint/eslint-runner.js';

type LintOptions = {
  scope?: string;
  configPath?: string;
  fix?: boolean;
  write?: boolean;
  timeoutMs?: string;
  json?: boolean;
  baselineFile?: string;
  redLine?: boolean;
  baseline?: boolean;
};

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`--timeout-ms must be a positive integer; received "${value}"`);
  }
  return parsed;
}

function writeBaselineJson(cwd: string, baselineFile: string, result: EslintRunResult): { path: string; violations: number } {
  const fullPath = join(cwd, baselineFile);
  mkdirSync(dirname(fullPath), { recursive: true });
  const violations = result.findings.map((f) => ({
    ruleId: f.ruleId,
    file: f.filePath,
    line: f.line,
    severity: f.severity,
    message: f.message
  }));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    toolVersion: 'peaks-loop-4.0.16+',
    violations
  };
  writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf8');
  return { path: fullPath, violations: violations.length };
}

function writeRedLineSummary(cwd: string, result: EslintRunResult): { path: string; ruleIds: string[] } {
  const fullPath = join(cwd, '.peaks/memory/lint-redline-summary.md');
  mkdirSync(dirname(fullPath), { recursive: true });
  const lines: string[] = [];
  lines.push('---');
  lines.push('title: lint red-line summary (auto-generated)');
  lines.push('rid: 2026-08-06-eslint-strict-metrics');
  lines.push('generatedAt: ' + new Date().toISOString());
  lines.push('source: `peaks lint --red-line` (PRD-002b slice)');
  lines.push('---');
  lines.push('');
  lines.push('# Lint red-line summary');
  lines.push('');
  lines.push('> LLM-facing card. The next LLM invocation MUST read this file before writing JS/TS code under the peaks-rd Gate B5 surface.');
  lines.push('');
  lines.push('## Top ruleIds (sorted by baseline violation count)');
  lines.push('');
  if (result.redLine.length === 0) {
    lines.push('No baseline violations recorded — project is lint-clean against the current baseline.');
  } else {
    for (const entry of result.redLine) {
      lines.push(`- \`${entry.ruleId}\`: ${entry.count} occurrence${entry.count === 1 ? '' : 's'}`);
      for (const top of entry.topFiles) {
        lines.push(`    - ${top.file} (${top.count})`);
      }
    }
  }
  lines.push('');
  writeFileSync(fullPath, lines.join('\n'), 'utf8');
  return { path: fullPath, ruleIds: result.redLine.map((r) => r.ruleId) };
}

export function registerLintCommands(program: Command, io: ProgramIO): void {
  const lint = program
    .command('lint')
    .description('Read-only ESLint verifier (peaks-rd Gate B5). Soft-fails when the toolchain is missing.');

  addJsonOption(lint
    .command('detect-eslint', { isDefault: false })
    .description('Read-only probe: returns the 5-state ESLint runtime envelope (ready / eslint-missing / config-error / npx-failed / detection-failed).')
  ).action((options: { json?: boolean }) => {
    const result = detectEslint();
    const envelope = result.state === 'ready'
      ? ok('code.lint.detect-eslint', result, [...result.warnings], [...result.nextActions])
      : fail('code.lint.detect-eslint', result.state.toUpperCase().replace(/-/g, '_'), `eslint is not ready: ${result.state}`, result, [...result.nextActions]);
    printResult(io, envelope, options.json);
    if (result.state !== 'ready') {
      process.exitCode = 0; // soft-fail
    }
  });

  addJsonOption(lint
    .command('check', { isDefault: true })
    .description('Run the read-only ESLint verifier on diff hunks + apply baseline waiver + emit red-line (default Gate B5 entry).')
    .option('--scope <path>', 'lint scope (default: project root)')
    .option('--config <path>', 'explicit ESLint config path')
    .option('--timeout-ms <ms>', 'subprocess timeout in milliseconds (default 60000)')
    .option('--baseline-file <path>', 'baseline JSON path (default .peaks/lint/baseline.json)')
    .option('--red-line', 'also write .peaks/memory/lint-redline-summary.md')
  ).action((options: LintOptions) => {
    let timeoutMs: number | undefined;
    try {
      timeoutMs = parseTimeoutMs(options.timeoutMs);
    } catch (error: unknown) {
      printResult(io, fail('code.lint', 'INVALID_TIMEOUT', getErrorMessage(error), { state: 'execution-failed' }, ['Re-run with --timeout-ms <positive integer>.']), options.json);
      return;
    }
    const cwd = process.cwd();
    const runOptions: EslintRunOptions = {
      cwd,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      ...(options.baselineFile !== undefined ? { baselineFile: options.baselineFile } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    };
    const result = runEslint(runOptions);
    const extras: Record<string, unknown> = {};
    if (options.redLine === true) {
      extras.redLineSummary = writeRedLineSummary(cwd, result);
    }
    const envelope = result.state === 'ok' || result.state === 'baseline-missing'
      ? ok('code.lint', { ...result, ...extras }, [], [])
      : fail('code.lint', result.state.toUpperCase().replace(/-/g, '_'), `peaks code lint state: ${result.state}`, { ...result, ...extras }, [`Re-run with --scope <path> or restore the ESLint toolchain.`]);
    printResult(io, envelope, options.json);
  });

  addJsonOption(lint
    .command('baseline')
    .description('One-shot full-repo scan; writes .peaks/lint/baseline.json (project-level, gitignored by default).')
    .option('--scope <path>', 'lint scope (default: project root)')
    .option('--config <path>', 'explicit ESLint config path')
    .option('--timeout-ms <ms>', 'subprocess timeout in milliseconds (default 60000)')
    .option('--baseline-file <path>', 'baseline JSON output path (default .peaks/lint/baseline.json)')
  ).action((options: LintOptions) => {
    let timeoutMs: number | undefined;
    try {
      timeoutMs = parseTimeoutMs(options.timeoutMs);
    } catch (error: unknown) {
      printResult(io, fail('code.lint.baseline', 'INVALID_TIMEOUT', getErrorMessage(error), { state: 'execution-failed' }, ['Re-run with --timeout-ms <positive integer>.']), options.json);
      return;
    }
    const cwd = process.cwd();
    const runOptions: EslintRunOptions = {
      cwd,
      diffOnly: false,
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    };
    const result = runEslint(runOptions);
    const baselineFile = options.baselineFile ?? '.peaks/lint/baseline.json';
    const written = writeBaselineJson(cwd, baselineFile, result);
    const envelope = ok('code.lint.baseline', { state: result.state, findings: result.findings.length, ...written }, [], ['Commit baseline.json (or .gitignore it). Peak-loop ships its own baseline as a reference fixture.']);
    printResult(io, envelope, options.json);
  });
}
