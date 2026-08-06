/**
 * `peaks code lint` — read-only ESLint verifier (Gate B5).
 */
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectEslint } from '../../services/lint/detect-eslint.js';
import { runEslint, type EslintRunOptions } from '../../services/lint/eslint-runner.js';

type LintOptions = {
  scope?: string;
  configPath?: string;
  fix?: boolean;
  write?: boolean;
  timeoutMs?: string;
  json?: boolean;
};

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`--timeout-ms must be a positive integer; received "${value}"`);
  }
  return parsed;
}

export function registerLintCommands(program: Command, io: ProgramIO): void {
  const lint = program
    .command('lint', { hidden: true })
    .description('Read-only ESLint verifier (peaks-rd Gate B5). Soft-fails when the toolchain is missing.');

  addJsonOption(lint
    .command('detect-eslint', { isDefault: true })
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
    .command('run', { hidden: true })
    .description('Run the read-only ESLint verifier. Soft-fails on missing toolchain.')
    .option('--scope <path>', 'lint scope (default: project root)')
    .option('--config <path>', 'explicit ESLint config path')
    .option('--fix', 'forbidden — peaks code lint is read-only')
    .option('--write', 'forbidden — peaks code lint is read-only')
    .option('--timeout-ms <ms>', 'subprocess timeout in milliseconds (default 60000)')
  ).action((options: LintOptions) => {
    let timeoutMs: number | undefined;
    try {
      timeoutMs = parseTimeoutMs(options.timeoutMs);
    } catch (error: unknown) {
      printResult(io, fail('code.lint', 'INVALID_TIMEOUT', getErrorMessage(error), { state: 'execution-failed' }, ['Re-run with --timeout-ms <positive integer>.']), options.json);
      return;
    }
    const runOptions: EslintRunOptions = {
      cwd: process.cwd(),
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
      ...(options.fix === true ? { fix: true } : {}),
      ...(options.write === true ? { write: true } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
    };
    const result = runEslint(runOptions);
    const envelope = result.state === 'ok'
      ? ok('code.lint', result, [], [])
      : fail('code.lint', result.state.toUpperCase().replace(/-/g, '_'), `peaks code lint state: ${result.state}`, result, [`Re-run with --scope <path> or restore the ESLint toolchain.`]);
    printResult(io, envelope, options.json);
  });
}
