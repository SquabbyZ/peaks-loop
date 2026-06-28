/**
 * v2.15.0 follow-up — G13: impact scan service.
 *
 * Lightweight, file-glob-based impact analysis (no AST, no type
 * checking). For a given set of changed files, predict:
 *   - which other files are likely affected (by path convention)
 *   - which business flows touch them (config-driven)
 *   - the risk level (high / medium / low)
 *   - the "must-check" list (concrete business scenarios the user
 *     must verify before shipping)
 *
 * Pure functions. The CLI wraps this with a `peaks impact scan`
 * command; `peaks impact must-check` returns the must-check list
 * subset. Persistence is per-invocation (no state file).
 */

/** A single impacted file predicted from a changed file. */
export interface ImpactedFile {
  /** Absolute or relative path. */
  readonly path: string;
  /** Why this file is considered affected. */
  readonly reason: string;
  /** Risk: high if the file is in core business paths. */
  readonly risk: 'high' | 'medium' | 'low';
}

/** A business flow that may be affected by the change. */
export interface AffectedFlow {
  /** Flow name (e.g. "用户登录", "Skill 权限校验"). */
  readonly name: string;
  /** Why this flow is affected. */
  readonly reason: string;
}

/** A must-check scenario the user must verify before shipping. */
export interface MustCheckItem {
  readonly scenario: string;
  readonly category: 'business' | 'ui' | 'integration' | 'data';
  readonly priority: 'P0' | 'P1' | 'P2';
}

/** Full scan report. */
export interface ImpactScanReport {
  readonly changedFiles: readonly string[];
  readonly impactedFiles: readonly ImpactedFile[];
  readonly affectedFlows: readonly AffectedFlow[];
  readonly mustCheck: readonly MustCheckItem[];
  readonly overallRisk: 'high' | 'medium' | 'low';
  readonly warnings: readonly string[];
}

export interface ImpactScanOptions {
  readonly changedFiles: readonly string[];
  /** Optional business flow map: flow name → list of file globs. */
  readonly businessFlows?: ReadonlyMap<string, readonly string[]>;
}

/**
 * Default business flow map (covers the most common B-end
 * archetypes; users can override via --flows in the CLI).
 */
export const DEFAULT_BUSINESS_FLOWS: ReadonlyMap<string, readonly string[]> = new Map([
  ['用户管理', ['**/user/**', '**/users/**', '**/account/**']],
  ['权限校验', ['**/auth/**', '**/permission/**', '**/rbac/**', '**/role/**']],
  ['登录流程', ['**/login/**', '**/signin/**', '**/auth/**']],
  ['订单/交易', ['**/order/**', '**/payment/**', '**/transaction/**', '**/checkout/**']],
  ['Skill 权限', ['**/skill/**', '**/plugin/**']],
  ['数据列表', ['**/list/**', '**/table/**', '**/grid/**']],
  ['API 网关', ['**/api/**', '**/gateway/**', '**/routes/**']],
  ['数据库 schema', ['**/schema/**', '**/migrations/**', '**/prisma/**', '**/drizzle/**']],
  ['前端 UI 组件', ['**/components/**', '**/pages/**', '**/views/**']],
  ['后端服务', ['**/services/**', '**/server/**', '**/controllers/**']]
]);

/**
 * Convert a file path to a glob-friendly pattern. Returns 3 levels
 * (the file itself, the parent dir, the project-wide pattern).
 */
function pathToGlobs(path: string): string[] {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/');
  // Drop the filename → get the parent pattern: "src/foo/" → "src/**"
  const parent = parts.length > 1 ? parts.slice(0, -1).join('/') + '/**' : '**';
  return [normalized, parent, `**/${parts[parts.length - 1]}`];
}

/** Simple glob matcher supporting `**` and `*`. */
export function matchGlob(pattern: string, path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  // Build regex by splitting on glob tokens, escaping the rest.
  // Order: ** (doublestar) → .* ; * → [^/]* ; other → escape
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      // ** may be followed by a slash — consume `**/` or just `**`
      regexStr += '.*';
      i += 2;
      if (pattern[i] === '/') i++;
    } else if (pattern[i] === '*') {
      regexStr += '[^/]*';
      i++;
    } else {
      // Escape regex special char
      regexStr += pattern[i]!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  const re = new RegExp('^' + regexStr + '$');
  return re.test(normalizedPath);
}

/** Risk of a single file based on its path patterns. */
function fileRisk(path: string): 'high' | 'medium' | 'low' {
  if (matchGlob('**/auth/**', path) || matchGlob('**/permission/**', path) ||
      matchGlob('**/rbac/**', path) || matchGlob('**/schema/**', path) ||
      matchGlob('**/migrations/**', path) || matchGlob('**/prisma/**', path)) {
    return 'high';
  }
  if (matchGlob('**/services/**', path) || matchGlob('**/api/**', path) ||
      matchGlob('**/components/**', path)) {
    return 'medium';
  }
  return 'low';
}

/**
 * Run an impact scan. Pure function — no I/O.
 */
export function runImpactScan(opts: ImpactScanOptions): ImpactScanReport {
  const flows = opts.businessFlows ?? DEFAULT_BUSINESS_FLOWS;
  const changed = opts.changedFiles;
  const warnings: string[] = [];

  if (changed.length === 0) {
    warnings.push('No changed files provided. Pass --files a.ts,b.ts to scan.');
  }

  // Build set of globs from changed files.
  const changedGlobs = new Set<string>();
  for (const f of changed) {
    for (const g of pathToGlobs(f)) changedGlobs.add(g);
  }

  // For each business flow, check if any changed file matches.
  const affectedFlows: AffectedFlow[] = [];
  for (const [name, patterns] of flows) {
    const matches = changed.filter((f) => patterns.some((p) => matchGlob(p, f)));
    if (matches.length > 0) {
      affectedFlows.push({ name, reason: `changes touch ${matches.length} file(s) in this flow: ${matches.slice(0, 3).join(', ')}` });
    }
  }

  // Predict other files that may be affected (siblings of changed files).
  const impactedFiles: ImpactedFile[] = [];
  for (const f of changed) {
    const parts = f.replace(/\\/g, '/').split('/');
    if (parts.length <= 1) continue;
    const parent = parts.slice(0, -1).join('/');
    impactedFiles.push({
      path: `${parent}/index.{ts,tsx,js,jsx}`,
      reason: `sibling of changed file ${f}`,
      risk: fileRisk(`${parent}/index.ts`)
    });
  }

  // Deduplicate impacted files.
  const seen = new Set<string>();
  const dedupedImpacted = impactedFiles.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });

  // Build must-check list.
  const mustCheck: MustCheckItem[] = [];
  for (const flow of affectedFlows) {
    if (flow.name === '权限校验' || flow.name === '用户管理' || flow.name === '数据库 schema') {
      mustCheck.push({
        scenario: `回归测试: ${flow.name} 主流程跑通,边界 case(无权限/越权/迁移)不报错`,
        category: 'business',
        priority: 'P0'
      });
    }
    if (flow.name === '登录流程') {
      mustCheck.push({
        scenario: '登录 / 登出 / 续签 / 失败提示 4 个流程手工跑一遍',
        category: 'integration',
        priority: 'P0'
      });
    }
    if (flow.name === '前端 UI 组件' || flow.name === '数据列表') {
      mustCheck.push({
        scenario: `改动的 UI 页面在 3 种浏览器(Chrome / Edge / Safari)渲染正常,无白屏 / 错位 / 性能退化`,
        category: 'ui',
        priority: 'P1'
      });
    }
    if (flow.name === 'API 网关' || flow.name === '后端服务') {
      mustCheck.push({
        scenario: `改动接口的 happy path + 3 个异常 case(超时/限流/鉴权失败)返回正确的 status code`,
        category: 'integration',
        priority: 'P0'
      });
    }
  }
  // Deduplicate by scenario.
  const seenScenarios = new Set<string>();
  const dedupedMustCheck = mustCheck.filter((m) => {
    if (seenScenarios.has(m.scenario)) return false;
    seenScenarios.add(m.scenario);
    return true;
  });

  // Overall risk = highest individual risk.
  let overallRisk: 'high' | 'medium' | 'low' = 'low';
  for (const f of dedupedImpacted) {
    if (f.risk === 'high') { overallRisk = 'high'; break; }
    if (f.risk === 'medium') overallRisk = 'medium';
  }
  if (affectedFlows.length > 3) overallRisk = 'high';
  if (changed.length > 20) overallRisk = 'high';

  return {
    changedFiles: changed,
    impactedFiles: dedupedImpacted,
    affectedFlows,
    mustCheck: dedupedMustCheck,
    overallRisk,
    warnings
  };
}

/**
 * Extract just the must-check list from a scan report.
 */
export function mustCheckFromReport(report: ImpactScanReport): readonly MustCheckItem[] {
  return report.mustCheck;
}
