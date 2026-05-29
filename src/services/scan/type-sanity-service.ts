import { execFileSync } from 'node:child_process';
import { extname, basename } from 'node:path';
import type { RequestType } from '../artifacts/artifact-prerequisites.js';

export type FileCategory = 'source' | 'config' | 'docs' | 'lockfile' | 'test' | 'unknown';

export type FileBreakdown = {
  category: FileCategory;
  count: number;
  examples: string[];
};

export type TypeSanityReport = {
  declaredType: RequestType;
  gitAvailable: boolean;
  changedFiles: string[];
  breakdown: FileBreakdown[];
  suggestedTypes: ReadonlyArray<RequestType>;
  consistent: boolean;
  rationale: string;
};

export type TypeSanityOptions = {
  projectRoot: string;
  declaredType: RequestType;
  /** Compare working tree against this ref. Default 'HEAD' (covers staged + unstaged). */
  baseRef?: string;
};

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs', '.java', '.kt', '.swift', '.cpp', '.c', '.h', '.cs', '.rb', '.php', '.scala', '.dart', '.less', '.scss', '.sass', '.css']);
const DOCS_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);
const LOCKFILE_NAMES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'Cargo.lock', 'Gemfile.lock', 'composer.lock', 'go.sum', 'poetry.lock']);
const CONFIG_NAMES = new Set(['package.json', 'tsconfig.json', 'tsconfig.base.json', 'vite.config.ts', 'vite.config.js', 'webpack.config.js', 'next.config.js', 'next.config.ts', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.prettierrc', '.prettierrc.json', 'eslint.config.js', '.gitignore', '.npmrc', 'docker-compose.yml', 'docker-compose.yaml', 'Dockerfile', 'Makefile', '.editorconfig', 'tailwind.config.js', 'tailwind.config.ts', 'postcss.config.js', 'commitlint.config.js', 'lefthook.yml', 'turbo.json', 'lerna.json', 'pnpm-workspace.yaml', 'nx.json']);
const CONFIG_EXTENSIONS = new Set(['.toml', '.ini', '.cfg', '.env']);

function classifyFile(filePath: string): FileCategory {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  if (LOCKFILE_NAMES.has(name)) return 'lockfile';
  if (CONFIG_NAMES.has(name)) return 'config';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  if (filePath.startsWith('.github/') || filePath.includes('/workflows/') || name === 'release.yml' || name.endsWith('.yml') || name.endsWith('.yaml')) return 'config';
  if (DOCS_EXTENSIONS.has(ext)) return 'docs';
  // Test files: anything under tests/, __tests__/, or matching *.test.*, *.spec.*
  if (/\b(?:tests?|__tests__|__mocks__|spec)\b/.test(filePath) || /\.(test|spec)\.[a-z]+$/i.test(name)) return 'test';
  if (SOURCE_EXTENSIONS.has(ext)) return 'source';
  return 'unknown';
}

/**
 * Peaks' own artifact workspace. Changes here (PRD/RD/QA markdown, session
 * state) are never the "code change" a request type describes, so they must be
 * excluded from the diff — otherwise a PRD-planning-phase handoff that only
 * wrote `.peaks/**` markdown would be misclassified as a docs change.
 */
function isArtifactWorkspaceFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized === '.peaks' || normalized.startsWith('.peaks/');
}

function tryGitDiffFiles(projectRoot: string, baseRef: string): { ok: boolean; files: string[] } {
  try {
    // Combine: tracked changes vs baseRef + untracked files. Use porcelain status for untracked too.
    const trackedRaw = execFileSync('git', ['-C', projectRoot, 'diff', '--name-only', baseRef], { encoding: 'utf8' });
    const tracked = trackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const untrackedRaw = execFileSync('git', ['-C', projectRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
    const untracked = untrackedRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const merged = Array.from(new Set([...tracked, ...untracked])).filter((file) => !isArtifactWorkspaceFile(file));
    return { ok: true, files: merged };
  } catch {
    return { ok: false, files: [] };
  }
}

function buildBreakdown(files: string[]): FileBreakdown[] {
  const grouped = new Map<FileCategory, string[]>();
  for (const file of files) {
    const category = classifyFile(file);
    const list = grouped.get(category) ?? [];
    list.push(file);
    grouped.set(category, list);
  }
  return Array.from(grouped.entries()).map(([category, examples]) => ({
    category,
    count: examples.length,
    examples: examples.slice(0, 5)
  }));
}

function suggestTypes(breakdown: FileBreakdown[]): RequestType[] {
  const counts: Record<FileCategory, number> = { source: 0, config: 0, docs: 0, lockfile: 0, test: 0, unknown: 0 };
  for (const entry of breakdown) counts[entry.category] = entry.count;
  const hasSource = counts.source > 0;
  const hasConfig = counts.config > 0;
  const hasDocs = counts.docs > 0;
  const hasLockfile = counts.lockfile > 0;
  const hasTest = counts.test > 0;

  if (!hasSource && !hasConfig && hasDocs) return ['docs'];
  if (!hasSource && !hasDocs && hasConfig) return ['config'];
  if (!hasSource && !hasDocs && !hasConfig && hasLockfile) return ['chore'];
  if (!hasSource && !hasDocs && !hasConfig && !hasLockfile && hasTest) return ['bugfix', 'refactor'];
  if (hasSource) return ['feature', 'bugfix', 'refactor'];
  return ['feature', 'bugfix', 'refactor', 'config', 'docs', 'chore'];
}

function isConsistent(declared: RequestType, suggested: ReadonlyArray<RequestType>): boolean {
  return suggested.includes(declared);
}

function buildRationale(declared: RequestType, breakdown: FileBreakdown[], suggested: ReadonlyArray<RequestType>, consistent: boolean): string {
  const summary = breakdown.map((entry) => `${entry.category}=${entry.count}`).join(', ');
  if (consistent) {
    return `declared --type=${declared} is consistent with the changed files (${summary})`;
  }
  return `declared --type=${declared} disagrees with the changed files (${summary}); suggested types: ${suggested.join(' | ')}`;
}

export function checkTypeSanity(options: TypeSanityOptions): TypeSanityReport {
  const baseRef = options.baseRef ?? 'HEAD';
  const { ok: gitAvailable, files } = tryGitDiffFiles(options.projectRoot, baseRef);
  const breakdown = buildBreakdown(files);
  const suggested = suggestTypes(breakdown);
  const consistent = !gitAvailable ? true : files.length === 0 ? true : isConsistent(options.declaredType, suggested);
  return {
    declaredType: options.declaredType,
    gitAvailable,
    changedFiles: files,
    breakdown,
    suggestedTypes: suggested,
    consistent,
    rationale: !gitAvailable
      ? 'git unavailable or not a git repository — type sanity check skipped (returns consistent=true)'
      : files.length === 0
        ? `no changes detected against ${baseRef} — type sanity check skipped (returns consistent=true)`
        : buildRationale(options.declaredType, breakdown, suggested, consistent)
  };
}
