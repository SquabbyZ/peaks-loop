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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveNpxInvocation } from './npx-resolver.js';

/**
 * PRD-002b slice 2 — extract runner-pipeline magic numbers (ESLint
 * severity codes, buffer / timeout budgets, max project-root walk
 * depth, red-line top-N aggregation cap, base severity defaults).
 * Values are bytewise-identical to the original literals.
 */
const ESLINT_SEVERITY_ERROR = 2;
const ESLINT_SEVERITY_WARN = 1;
const ESLINT_DEFAULT_TIMEOUT_MS = 60_000;
const KB_PER_MB = 1024;
const BYTES_PER_KB = 1024;
const MB_TO_BYTES = KB_PER_MB * BYTES_PER_KB;
const DIFF_BUFFER_BYTES = 16 * MB_TO_BYTES;
const OUTPUT_BUFFER_BYTES = 32 * MB_TO_BYTES;
const PROJECT_ROOT_WALK_MAX_DEPTH = 8;
const RED_LINE_TOP_FILES = 5;

export const ESLINT_PACKAGE_PINS = {
  eslint: '8.57.1',
  typescriptEslintParser: '8.66.0',
  typescriptEslintPlugin: '8.66.0'
} as const;

export type RedLineMode = 'none' | 'baseline-aware';

export type EslintState =
  | 'ok'
  | 'eslint-missing'
  | 'npx-failed'
  | 'execution-failed'
  | 'baseline-missing';

export type EslintFinding = {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly ruleId: string | null;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
};

export type EslintSummary = {
  readonly error: number;
  readonly warn: number;
  readonly info: number;
};

export type BaselineViolation = {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
};

export type RedLineEntry = {
  readonly ruleId: string;
  readonly count: number;
  readonly topFiles: ReadonlyArray<{ readonly file: string; readonly count: number }>;
};

export type EslintRunResult = {
  readonly state: EslintState;
  readonly findings: readonly EslintFinding[];
  readonly summary: EslintSummary;
  readonly durationMs: number;
  readonly rawOutput: string;
  readonly baselineWaived: readonly EslintFinding[];
  readonly redLine: readonly RedLineEntry[];
};

export type EslintRunOptions = {
  readonly cwd: string;
  readonly scope?: string;
  readonly configPath?: string;
  readonly fix?: boolean;
  readonly write?: boolean;
  readonly timeoutMs?: number;
  readonly diffOnly?: boolean;
  readonly baselineFile?: string;
  readonly redLineMode?: RedLineMode;
};

type EslintMessage = {
  filePath?: unknown;
  line?: unknown;
  column?: unknown;
  ruleId?: unknown;
  severity?: unknown;
  message?: unknown;
};

function severityFor(value: unknown): 'error' | 'warn' | 'info' {
  if (value === ESLINT_SEVERITY_ERROR) return 'error';
  if (value === ESLINT_SEVERITY_WARN) return 'warn';
  return 'info';
}

function summarize(findings: readonly EslintFinding[]): EslintSummary {
  let error = 0;
  let warn = 0;
  let info = 0;
  for (const f of findings) {
    if (f.severity === 'error') error++;
    else if (f.severity === 'warn') warn++;
    else info++;
  }
  return { error, warn, info };
}

type DiffRange = { readonly file: string; readonly lines: readonly number[] };

/**
 * Read `git diff HEAD --unified=0` and parse every `+` line as a
 * touched line number. Falls back to [] on any parse error so the
 * caller treats all findings as out-of-diff (no silent zero-result).
 */
function resolveProjectRoot(cwd: string): string {
  // ESLint 8 auto-discovers `.eslintrc.*` from cwd upward. When the
  // CLI is launched via `node bin/peaks.js`, cwd is the bin/ dir and
  // ESLint fails to find the config. Walk up until we see
  // `config/eslint/.peaks-rules.cjs` and use that as the project root.
  const marker = join('config', 'eslint', '.peaks-rules.cjs');
  let current = cwd;
  for (let depth = 0; depth < PROJECT_ROOT_WALK_MAX_DEPTH; depth += 1) {
    if (existsSync(join(current, marker))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return cwd;
}

function loadDiffRanges(cwd: string): readonly DiffRange[] {
  const ranges: DiffRange[] = [];
  try {
    const result = spawnSync('git', ['diff', 'HEAD', '--unified=0', '--no-color'], {
      cwd,
      encoding: 'utf8',
      maxBuffer: DIFF_BUFFER_BYTES
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

function inDiff(filePath: string, line: number, ranges: readonly DiffRange[]): boolean {
  if (ranges.length === 0) return false;
  for (const r of ranges) {
    if (r.file !== filePath) continue;
    for (const ln of r.lines) {
      if (Math.abs(ln - line) <= 0) return true;
    }
  }
  return false;
}

type BaselineFile = {
  readonly version?: unknown;
  readonly generatedAt?: unknown;
  readonly toolVersion?: unknown;
  readonly violations?: ReadonlyArray<{
    ruleId?: unknown;
    file?: unknown;
    line?: unknown;
    severity?: unknown;
    message?: unknown;
  }>;
};

function loadBaseline(cwd: string, baselineFile: string): readonly BaselineViolation[] {
  const fullPath = join(cwd, baselineFile);
  let raw: string;
  try {
    raw = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }
  let parsed: BaselineFile;
  try {
    parsed = JSON.parse(raw) as BaselineFile;
  } catch {
    return [];
  }
  const violations = Array.isArray(parsed.violations) ? parsed.violations : [];
  const out: BaselineViolation[] = [];
  for (const v of violations) {
    if (typeof v.ruleId !== 'string' || typeof v.file !== 'string' || typeof v.line !== 'number') continue;
    out.push({
      ruleId: v.ruleId,
      file: v.file,
      line: v.line,
      severity: severityFor(v.severity),
      message: typeof v.message === 'string' ? v.message : ''
    });
  }
  return out;
}

function matchBaseline(finding: EslintFinding, baseline: readonly BaselineViolation[]): boolean {
  for (const v of baseline) {
    if (v.ruleId !== finding.ruleId) continue;
    if (v.file !== finding.filePath) continue;
    if (v.line !== finding.line) continue;
    return true;
  }
  return false;
}

function aggregateRedLine(baseline: readonly BaselineViolation[]): readonly RedLineEntry[] {
  const byRule = new Map<string, { count: number; fileCounts: Map<string, number> }>();
  for (const v of baseline) {
    const existing = byRule.get(v.ruleId);
    if (existing === undefined) {
      const fileCounts = new Map<string, number>();
      fileCounts.set(v.file, 1);
      byRule.set(v.ruleId, { count: 1, fileCounts });
    } else {
      existing.count += 1;
      existing.fileCounts.set(v.file, (existing.fileCounts.get(v.file) ?? 0) + 1);
    }
  }
  const out: RedLineEntry[] = [];
  for (const [ruleId, agg] of byRule.entries()) {
    const topFiles = [...agg.fileCounts.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, RED_LINE_TOP_FILES);
    out.push({ ruleId, count: agg.count, topFiles });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

const EMPTY_DIFF_RANGE: readonly DiffRange[] = [];
const EMPTY_REDLINE: readonly RedLineEntry[] = [];

function emptyResult(state: EslintState, start: number, rawOutput: string): EslintRunResult {
  return {
    state,
    findings: [],
    summary: { error: 0, warn: 0, info: 0 },
    durationMs: Date.now() - start,
    rawOutput,
    baselineWaived: [],
    redLine: EMPTY_REDLINE
  };
}

export function buildEslintArgs(options: EslintRunOptions): string[] {
  if (options.fix === true || options.write === true) {
    throw Object.assign(new Error('peaks code lint is read-only; --fix and --write are forbidden'), {
      code: 'LINT_FIX_FORBIDDEN'
    });
  }
  // The runner now uses the locally-installed eslint binary
  // (`./node_modules/eslint/bin/eslint.js`) instead of the npx
  // --package wrapper, which is broken on Windows (npm 10.9.4 chdirs
  // the child to its own cache bin, breaking config auto-discovery).
  // The pin constants are kept for detect-eslint's npm-registry
  // probe + for the npx-resolver fallback path.
  const args: string[] = ['--format', 'json'];
  // Always pass the legacy .peaks-rules.cjs path; ESLint 8
  // auto-discovers only `.eslintrc.*` files and our config lives at
  // `config/eslint/.peaks-rules.cjs`. Callers may override via
  // `options.configPath`.
  const effectiveConfigPath = options.configPath ?? join('config', 'eslint', '.peaks-rules.cjs');
  args.push('--config', effectiveConfigPath);
  args.push(...(options.scope !== undefined && options.scope.length > 0 ? [options.scope] : ['.']));
  return args;
}

export function runEslint(options: EslintRunOptions): EslintRunResult {
  const start = Date.now();
  let args: string[];
  try {
    args = buildEslintArgs(options);
  } catch (error: unknown) {
    return emptyResult('execution-failed', start, error instanceof Error ? error.message : String(error));
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
      '--package', `eslint@${ESLINT_PACKAGE_PINS.eslint}`,
      '--package', `@typescript-eslint/parser@${ESLINT_PACKAGE_PINS.typescriptEslintParser}`,
      '--package', `@typescript-eslint/eslint-plugin@${ESLINT_PACKAGE_PINS.typescriptEslintPlugin}`,
      '--', 'eslint', ...args
    ]);
    command = resolved.command;
    invocationArgs = resolved.args;
    baseEnv = resolved.baseEnv;
  }
  const result = spawnSync(command, invocationArgs, { ...spawnOptions, env: baseEnv });

  if (result.error !== undefined && result.error !== null) {
    const message = result.error.message;
    const state: EslintState = /ENOENT/.test(message) ? 'npx-failed' : 'execution-failed';
    return emptyResult(state, start, typeof result.stdout === 'string' ? result.stdout : '');
  }

  if (result.signal !== null && result.signal !== undefined) {
    return emptyResult('execution-failed', start, typeof result.stdout === 'string' ? result.stdout : '');
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  let findings: EslintFinding[] = [];
  if (stdout.trim().length > 0) {
    try {
      const parsed = JSON.parse(stdout) as ReadonlyArray<EslintMessage>;
      for (const entry of parsed) {
        if (typeof entry !== 'object' || entry === null) continue;
        const parentFile = typeof (entry as { filePath?: unknown }).filePath === 'string'
          ? (entry as { filePath: string }).filePath
          : '';
        const messages = Array.isArray((entry as { messages?: unknown[] }).messages)
          ? (entry as { messages: EslintMessage[] }).messages
          : [];
        for (const m of messages) {
          if (m === null || typeof m !== 'object') continue;
          findings.push({
            filePath: typeof m.filePath === 'string' && m.filePath.length > 0 ? m.filePath : parentFile,
            line: typeof m.line === 'number' ? m.line : 0,
            column: typeof m.column === 'number' ? m.column : 0,
            ruleId: typeof m.ruleId === 'string' ? m.ruleId : null,
            severity: severityFor(m.severity),
            message: typeof m.message === 'string' ? m.message : ''
          });
        }
      }
    } catch {
      return emptyResult('execution-failed', start, stdout);
    }
  }

  if (result.status !== 0 && findings.length === 0) {
    return emptyResult('eslint-missing', start, typeof result.stderr === 'string' ? result.stderr : stdout);
  }

  // PRD-002b slice: incremental-first / no-touch-stockcode filters.
  // PRD-002b D6: baselineFile is project-level; if missing we surface
  // state='baseline-missing' so the caller can re-run `peaks lint baseline`.
  const diffOnly = options.diffOnly !== false;
  const redLineMode: RedLineMode = options.redLineMode ?? 'baseline-aware';
  const baselinePath = options.baselineFile ?? '.peaks/lint/baseline.json';
  const baseline = loadBaseline(options.cwd, baselinePath);
  const diffRanges = diffOnly ? loadDiffRanges(options.cwd) : EMPTY_DIFF_RANGE;

  let activeFindings: EslintFinding[] = findings;
  let waived: EslintFinding[] = [];
  if (diffOnly) {
    activeFindings = findings.filter((f) => inDiff(f.filePath, f.line, diffRanges));
  }
  if (baseline.length > 0) {
    const next: EslintFinding[] = [];
    waived = [];
    for (const f of activeFindings) {
      if (matchBaseline(f, baseline)) {
        waived.push(f);
      } else {
        next.push(f);
      }
    }
    activeFindings = next;
  }

  const redLine = redLineMode === 'baseline-aware' ? aggregateRedLine(baseline) : EMPTY_REDLINE;
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
    baselineWaived: waived,
    redLine
  };
}
