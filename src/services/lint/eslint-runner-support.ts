/**
 * ESLint runner pipeline helpers — moved VERBATIM out of `eslint-runner.ts`
 * for the 300-raw-line cap (slice `b1-filesplit-campaign`, wave 3C): the
 * severity map, diff-range gate, baseline waiver / red-line aggregation,
 * project-root walk, empty-result factory and the argv builder.
 * `eslint-runner.ts` re-exports the public names, so existing import paths
 * keep working.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isArray } from '../../shared/array-guards.js';
import { repoRelativeKey } from '../../shared/path-utils.js';
import type {
  BaselineViolation,
  EslintFinding,
  EslintRunOptions,
  EslintRunResult,
  EslintState,
  EslintSummary,
  RedLineEntry
} from './eslint-runner-types.js';

const ESLINT_SEVERITY_ERROR = 2;
const ESLINT_SEVERITY_WARN = 1;
const PROJECT_ROOT_WALK_MAX_DEPTH = 8;
const RED_LINE_TOP_FILES = 5;

export function severityFor(value: unknown): 'error' | 'warn' | 'info' {
  if (value === ESLINT_SEVERITY_ERROR) return 'error';
  if (value === ESLINT_SEVERITY_WARN) return 'warn';
  return 'info';
}

export function summarize(findings: readonly EslintFinding[]): EslintSummary {
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
export function resolveProjectRoot(cwd: string): string {
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

export function inDiff(filePath: string, line: number, ranges: readonly DiffRange[]): boolean {
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

export function loadBaseline(
  projectRoot: string,
  baselineFile: string
): readonly BaselineViolation[] {
  const fullPath = join(projectRoot, baselineFile);
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
  // `isArray` (not `Array.isArray`, typed `arg is any[]`), so `parsed.violations`
  // keeps the `ReadonlyArray<{ruleId?: unknown; …}>` shape declared by
  // `BaselineFile` and `v` below is a typed read. The `!== undefined` half is
  // required because a `boolean` helper cannot narrow. See
  // `src/shared/array-guards.ts`.
  const violations =
    parsed.violations !== undefined && isArray(parsed.violations) ? parsed.violations : [];
  const out: BaselineViolation[] = [];
  for (const v of violations) {
    if (typeof v.ruleId !== 'string' || typeof v.file !== 'string' || typeof v.line !== 'number')
      continue;
    out.push({
      ruleId: v.ruleId,
      // Reduce to the comparison key on load, so `matchBaseline` and the
      // red-line aggregation both read one canonical form.
      file: repoRelativeKey(v.file, projectRoot),
      line: v.line,
      severity: severityFor(v.severity),
      message: typeof v.message === 'string' ? v.message : ''
    });
  }
  return out;
}

export function matchBaseline(
  finding: EslintFinding,
  baseline: readonly BaselineViolation[],
  projectRoot: string
): boolean {
  // The finding side is reduced by the SAME key the baseline was loaded
  // through — this is the half that made the waiver inert across machines.
  const findingKey = repoRelativeKey(finding.filePath, projectRoot);
  for (const v of baseline) {
    if (v.ruleId !== finding.ruleId) continue;
    if (v.file !== findingKey) continue;
    if (v.line !== finding.line) continue;
    return true;
  }
  return false;
}

export function aggregateRedLine(baseline: readonly BaselineViolation[]): readonly RedLineEntry[] {
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

export const EMPTY_DIFF_RANGE: readonly DiffRange[] = [];
export const EMPTY_REDLINE: readonly RedLineEntry[] = [];

export function emptyResult(state: EslintState, start: number, rawOutput: string): EslintRunResult {
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
    throw Object.assign(
      new Error('peaks code lint is read-only; --fix and --write are forbidden'),
      {
        code: 'LINT_FIX_FORBIDDEN'
      }
    );
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

export type { DiffRange };
