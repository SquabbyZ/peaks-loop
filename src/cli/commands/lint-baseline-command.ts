/**
 * `peaks lint baseline` writer — split out of `lint-commands.ts` for the
 * 300-raw-line cap. Writes the project baseline and refuses to write one from a
 * run that examined nothing (backlog §2.41).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fail, ok } from 'peaks-loop-shared/result';
import { CLI_VERSION } from 'peaks-loop-shared/version';
import { repoRelativeKey } from '../../shared/path-utils.js';
import {
  resolveProjectRoot,
  runEslint,
  type EslintRunResult
} from '../../services/lint/eslint-runner.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';

export type LintBaselineOptions = {
  scope?: string;
  config?: string;
  timeoutMs?: string;
  json?: boolean;
  baselineFile?: string;
  allowEmpty?: boolean;
};

export function writeBaselineJson(
  projectRoot: string,
  baselineFile: string,
  result: EslintRunResult
): { path: string; violations: number } {
  const fullPath = join(projectRoot, baselineFile);
  mkdirSync(dirname(fullPath), { recursive: true });
  // Write the SAME key the reader matches on. Writing ESLint's absolute
  // `filePath` here is what re-rooted the file on whichever machine ran the
  // command, so the next checkout inherited keys it could not match.
  const violations = result.findings.map((f) => ({
    ruleId: f.ruleId,
    file: repoRelativeKey(f.filePath, projectRoot),
    line: f.line,
    severity: f.severity,
    message: f.message
  }));
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    toolVersion: `peaks-loop-${CLI_VERSION}`,
    violations
  };
  writeFileSync(fullPath, JSON.stringify(payload, null, 2), 'utf8');
  return { path: fullPath, violations: violations.length };
}

export function emitBaseline(
  io: ProgramIO,
  options: LintBaselineOptions,
  timeoutMs: number | undefined
): void {
  const cwd = process.cwd();
  // The flag governs BOTH sides: the runner subtracts the named file below,
  // and `writeBaselineJson` writes back to it.
  const baselineFile = options.baselineFile ?? '.peaks/lint/baseline.json';
  const result = runEslint({
    cwd,
    diffOnly: false,
    baselineFile,
    ...(options.scope !== undefined ? { scope: options.scope } : {}),
    ...(options.config !== undefined ? { configPath: options.config } : {}),
    ...(options.allowEmpty === true ? { allowEmpty: true } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {})
  });
  // §2.41: an empty population must never erase every recorded violation.
  if (result.state !== 'ok' && result.state !== 'baseline-missing') {
    printResult(
      io,
      fail(
        'code.lint.baseline',
        result.state.toUpperCase().replace(/-/g, '_'),
        `peaks code lint baseline state: ${result.state}${result.reason === undefined ? '' : ` — ${result.reason}`}`,
        { ...result },
        ['Nothing was written; the existing baseline is unchanged.']
      ),
      options.json
    );
    return;
  }
  const written = writeBaselineJson(resolveProjectRoot(cwd), baselineFile, result);
  printResult(
    io,
    ok(
      'code.lint.baseline',
      {
        state: result.state,
        findings: result.findings.length,
        checkedFiles: result.checkedFiles,
        ignoredFiles: result.ignoredFiles,
        ...written
      },
      [],
      [
        'Commit baseline.json (or .gitignore it). Peaks-Loop ships its own baseline as a reference fixture.'
      ]
    ),
    options.json
  );
}
