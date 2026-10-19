/**
 * ESLint runner — read-only verifier for peaks code lint.
 * Pins the 4 toolchain packages to the same major versions
 * `config/eslint/.peaks-rules.cjs` requires; the runner loads them
 * via `npx --package` so peaks-loop devDeps do not grow. Per the
 * G-lint-2 red line, --fix / --write are FORBIDDEN.
 *
 * PRD-002b slice: three new options enforce the
 * incremental-first / no-touch-stockcode / project-aware baseline
 * invariants:
 *
 *   - diffOnly (default true): filter findings to git-diff hunks;
 *    存量违规 silently skipped. Enforces D4 + D5.
 *   - baselineFile (default '.peaks/lint/baseline.json'): waiver
 *     matching findings (ruleId + file + line). Enforces D5.
 *   - redLineMode (default 'baseline-aware'): aggregate baseline
 *     violations by ruleId so the envelope carries an LLM-readable
 *     red-line. Enforces D6 + supplementary S2.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRelativeKey } from '../../shared/path-utils.js';
import { resolveNpxInvocation } from './npx-resolver.js';
import {
  ESLINT_PACKAGE_PINS,
  type EslintFinding,
  type EslintRunOptions,
  type EslintRunResult,
  type EslintState,
  type RedLineMode
} from './eslint-runner-types.js';
import {
  aggregateRedLine,
  buildEslintArgs,
  EMPTY_DIFF_RANGE,
  emptyPopulationReason,
  EMPTY_REDLINE,
  emptyResult,
  inDiff,
  loadBaseline,
  matchBaseline,
  resolveProjectRoot,
  summarize,
  type DiffRange
} from './eslint-runner-support.js';
import { parseEslintReport, type ParsedReport } from './eslint-report.js';

export { ESLINT_PACKAGE_PINS } from './eslint-runner-types.js';
export { buildEslintArgs, resolveProjectRoot } from './eslint-runner-support.js';
export type {
  BaselineViolation,
  EslintFinding,
  EslintRunOptions,
  EslintRunResult,
  EslintState,
  EslintSummary,
  RedLineEntry,
  RedLineMode
} from './eslint-runner-types.js';

/**
 * PRD-002b slice 2 — extract runner-pipeline magic numbers (ESLint
 * severity codes, buffer / timeout budgets, max project-root walk
 * depth, red-line top-N aggregation cap, base severity defaults).
 * Values are bytewise-identical to the original literals.
 */
const ESLINT_DEFAULT_TIMEOUT_MS = 60_000;
const KB_PER_MB = 1024;
const BYTES_PER_KB = 1024;
const MB_TO_BYTES = KB_PER_MB * BYTES_PER_KB;
const DIFF_BUFFER_BYTES = 16 * MB_TO_BYTES;
const OUTPUT_BUFFER_BYTES = 32 * MB_TO_BYTES;

function loadDiffRanges(cwd: string): readonly DiffRange[] {
  const ranges: DiffRange[] = [];
  try {
    const result = spawnSync('git', ['diff', 'HEAD', '--unified=0', '--no-color'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: DIFF_BUFFER_BYTES,
      windowsHide: true
    });
    if (result.status !== 0 || typeof result.stdout !== 'string') return [];
    const stdout = result.stdout;
    let currentFile: string | null = null;
    let currentLine = 0;
    for (const raw of stdout.split('\n')) {
      const line = raw;
      if (line.startsWith('+++ ')) {
        const path = line.slice(4).split('\t')[0] ?? '';
        currentFile = path.startsWith('b/') ? path.slice(2) : path;
        continue;
      }
      if (line.startsWith('--- ')) {
        continue;
      }
      const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
      if (hunk !== null) {
        currentLine = Number.parseInt(hunk[1] ?? '0', 10);
        continue;
      }
      if (currentFile !== null && line.startsWith('+') && !line.startsWith('+++')) {
        if (Number.isFinite(currentLine) && currentLine > 0) {
          ranges.push({ file: currentFile, lines: [currentLine] });
        }
        currentLine += 1;
      }
    }
  } catch {
    return [];
  }
  return ranges;
}

export function runEslint(options: EslintRunOptions): EslintRunResult {
  const start = Date.now();
  let args: string[];
  try {
    args = buildEslintArgs(options);
  } catch (error: unknown) {
    return emptyResult(
      'execution-failed',
      start,
      error instanceof Error ? error.message : String(error),
      {
        reason: 'the eslint argument list could not be built'
      }
    );
  }

  const projectRoot = resolveProjectRoot(options.cwd);
  // Invoke eslint via `node <node_modules/eslint/bin/eslint.js>` to bypass
  // the Windows .cmd shim entirely (Node 22 spawnSync cannot run .cmd
  // shims without shell:true, and shell:true mangles quoted args).
  const localEslintJs = join(projectRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const useLocal = existsSync(localEslintJs);

  const spawnOptions: SpawnSyncOptions = {
    cwd: projectRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? ESLINT_DEFAULT_TIMEOUT_MS,
    maxBuffer: OUTPUT_BUFFER_BYTES
  };

  let command: string;
  let invocationArgs: readonly string[];
  let baseEnv: NodeJS.ProcessEnv;
  if (useLocal) {
    command = process.execPath;
    invocationArgs = [localEslintJs, ...args];
    baseEnv = process.env;
  } else {
    // Fallback: resolve `npx` through the user's bundled npm install to
    // bypass the Windows .cmd shim + shell-quoting issues.
    const resolved = resolveNpxInvocation([
      '--package',
      `eslint@${ESLINT_PACKAGE_PINS.eslint}`,
      '--package',
      `@typescript-eslint/parser@${ESLINT_PACKAGE_PINS.typescriptEslintParser}`,
      '--package',
      `@typescript-eslint/eslint-plugin@${ESLINT_PACKAGE_PINS.typescriptEslintPlugin}`,
      '--',
      'eslint',
      ...args
    ]);
    command = resolved.command;
    invocationArgs = resolved.args;
    baseEnv = resolved.baseEnv;
  }
  const result = spawnSync(command, invocationArgs, { ...spawnOptions, env: baseEnv });

  if (result.error !== undefined && result.error !== null) {
    const message = result.error.message;
    const state: EslintState = /ENOENT/.test(message) ? 'npx-failed' : 'execution-failed';
    // A spawn timeout arrives HERE, as `error.code === 'ETIMEDOUT'` — measured on
    // this host with `--timeout-ms 20000`: the spawn-error branch below wins over
    // the signal branch, because this check comes first and spawnSync sets both.
    // So a timeout must not be reported as "could not be spawned": it was spawned
    // and did not finish, and that difference is the whole diagnosis.
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    const budgetMs = options.timeoutMs ?? ESLINT_DEFAULT_TIMEOUT_MS;
    return emptyResult(state, start, typeof result.stdout === 'string' ? result.stdout : '', {
      reason: timedOut
        ? `eslint did not finish within the ${budgetMs}ms spawn timeout`
        : `eslint could not be spawned: ${message}`
    });
  }

  if (result.signal !== null && result.signal !== undefined) {
    // A kill that arrived WITHOUT a spawn error — a signal from outside, not the
    // spawn timeout (that one is caught above as ETIMEDOUT). Named so it is not
    // read as linter output that would not parse.
    const budgetMs = options.timeoutMs ?? ESLINT_DEFAULT_TIMEOUT_MS;
    return emptyResult(
      'execution-failed',
      start,
      typeof result.stdout === 'string' ? result.stdout : '',
      {
        reason: `eslint was killed by ${result.signal} after ${Date.now() - start}ms (spawn timeout ${budgetMs}ms)`
      }
    );
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  // A valid JSON report means eslint RAN. Its exit code is 2 when nothing
  // matched the scope, so the exit code alone cannot tell "the scope is empty"
  // from "the toolchain is missing" — that distinction is §2.41's whole point.
  let report: ParsedReport = { findings: [], checkedFiles: 0, ignoredFiles: 0 };
  let parsedOutput = false;
  if (stdout.trim().length > 0) {
    try {
      report = parseEslintReport(stdout);
      parsedOutput = true;
    } catch {
      return emptyResult('execution-failed', start, stdout, {
        reason: `eslint stdout was not valid JSON (${stdout.length} bytes)`
      });
    }
  }
  const { findings, checkedFiles, ignoredFiles } = report;

  // eslint exits 2 with an empty stdout when the scope matched no file at all.
  // That is an empty population (§2.41), not a missing toolchain.
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const noFilesMatched = /No files matching the pattern/.test(stderr);
  if (result.status !== 0 && findings.length === 0 && !parsedOutput && !noFilesMatched) {
    return emptyResult('eslint-missing', start, stderr.length > 0 ? stderr : stdout);
  }

  // PRD-002b slice: incremental-first / no-touch-stockcode filters.
  // PRD-002b D6: baselineFile is project-level; if missing we surface
  // state='baseline-missing' so the caller can re-run `peaks lint baseline`.
  const diffOnly = options.diffOnly !== false;
  const redLineMode: RedLineMode = options.redLineMode ?? 'baseline-aware';
  const baselinePath = options.baselineFile ?? '.peaks/lint/baseline.json';
  const baseline = loadBaseline(projectRoot, baselinePath);
  const diffRanges = diffOnly ? loadDiffRanges(projectRoot) : EMPTY_DIFF_RANGE;

  let activeFindings: EslintFinding[] = findings;
  let waived: EslintFinding[] = [];
  if (diffOnly) {
    // `git diff` reports repo-relative paths; ESLint reports absolute ones.
    // Reducing the finding through the same key is what lets the diff gate
    // match at all (measured: without it, every finding is dropped as
    // out-of-diff on every machine).
    activeFindings = findings.filter((f) =>
      inDiff(repoRelativeKey(f.filePath, projectRoot), f.line, diffRanges)
    );
  }
  if (baseline.length > 0) {
    const next: EslintFinding[] = [];
    waived = [];
    for (const f of activeFindings) {
      if (matchBaseline(f, baseline, projectRoot)) {
        waived.push(f);
      } else {
        next.push(f);
      }
    }
    activeFindings = next;
  }

  const redLine = redLineMode === 'baseline-aware' ? aggregateRedLine(baseline) : EMPTY_REDLINE;
  if (checkedFiles === 0 && options.allowEmpty !== true) {
    // Backlog §2.41: a count of findings must carry the population that
    // produced it, and an empty population is refused rather than reported
    // green. eslint skips dot-directories by default, so this is the state a
    // scope like `.husky` used to reach silently.
    return emptyResult('empty-scope', start, stdout, {
      reason: emptyPopulationReason(options.scope, ignoredFiles),
      checkedFiles,
      ignoredFiles
    });
  }
  const finalState: EslintState =
    baseline.length === 0 && diffOnly && options.baselineFile !== undefined
      ? 'baseline-missing'
      : 'ok';

  return {
    state: finalState,
    findings: activeFindings,
    summary: summarize(activeFindings),
    durationMs: Date.now() - start,
    rawOutput: stdout,
    checkedFiles,
    ignoredFiles,
    baselineWaived: waived,
    redLine
  };
}
