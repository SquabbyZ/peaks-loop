/**
 * Detection algorithm for `peaks skill scope`.
 *
 * Pure function: given a project root and the installed-skills path, the
 * algorithm produces a `DetectResult` (signals + per-skill classification
 * + counts). No filesystem writes, no randomness, no time-of-day. AC11.
 *
 * Three layers:
 * 1. `extractProjectSignals(projectRoot)` — read package.json + tsconfig +
 *    file tree (top-50 extensions).
 * 2. `classifySkill(skill, signals, hardcodedRules)` — keyword matching
 *    against the skill's SKILL.md description.
 * 3. `detectSkillScope({ projectRoot, installedSkillsPath })` — top-level
 *    orchestrator that returns the JSON envelope (AC1).
 */

import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ProjectSignals,
  SkillKind,
  SkillRelevance,
  SkillScopeCounts,
  SkillScopeRecord,
} from './types.js';
import {
  ALWAYS_RELEVANT_SKILLS,
  NON_TS_SKILL_PREFIXES,
  TRACKED_EXTENSIONS,
  readScopeThreshold,
} from './types.js';

// ---------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------

interface PackageJsonShape {
  readonly name?: string;
  readonly type?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly scripts?: Record<string, string>;
  readonly engines?: { readonly node?: string };
}

interface TsConfigShape {
  readonly compilerOptions?: { readonly module?: string; readonly target?: string };
}

function hasAnyDep(
  pkg: PackageJsonShape,
  names: readonly string[]
): boolean {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return names.some((name) => Object.prototype.hasOwnProperty.call(all, name));
}

function parseNodeEngineMajor(enginesNode: string | undefined): number | null {
  if (enginesNode === undefined) return null;
  // Match patterns like '>=20', '^20.0.0', '>=20.0.0 <21.0.0'
  const match = enginesNode.match(/(\d+)/);
  return match === null ? null : Number(match[1]);
}

/**
 * Read and parse a JSON file. Returns null on parse error or missing file.
 */
async function readJson(path: string): Promise<unknown> {
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function asPackageJson(value: unknown): PackageJsonShape | null {
  if (value === null || typeof value !== 'object') return null;
  return value as PackageJsonShape;
}

function asTsConfig(value: unknown): TsConfigShape | null {
  if (value === null || typeof value !== 'object') return null;
  return value as TsConfigShape;
}

/**
 * Walk `src/` (recursively) AND the project root, collecting the top-50
 * unique file extensions (sorted lexicographically) AND the per-extension
 * file count (used by R003.1 to compute fractional share).
 */
export interface ScanResult {
  readonly extensions: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly totalFiles: number;
}

export function scanFileTree(projectRoot: string, maxExtensions = 50): ScanResult {
  const roots: string[] = [];
  if (existsSync(join(projectRoot, 'src'))) roots.push(join(projectRoot, 'src'));
  roots.push(projectRoot);

  const counts: Record<string, number> = {};
  // Bound the walk: at most 2000 files, 5 levels deep.
  let visited = 0;
  const MAX_FILES = 2000;
  const MAX_DEPTH = 5;

  for (const root of roots) {
    const stack: string[] = [root];
    while (stack.length > 0 && visited < MAX_FILES) {
      const dir = stack.pop() as string;
      if (!existsSync(dir)) continue;
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const name = entry.name;
        if (typeof name !== 'string') continue;
        const full = join(dir, name);
        // Skip hidden dirs (e.g. node_modules, .git) and the fixture `skills/` dir.
        if (name === 'node_modules' || name === '.git' || name === 'skills' || name === 'dist') continue;
        if (entry.isDirectory()) {
          const depth = full.split(/[/\\]/).length - projectRoot.split(/[/\\]/).length;
          if (depth < MAX_DEPTH) stack.push(full);
        } else if (entry.isFile()) {
          visited += 1;
          if (visited >= MAX_FILES) break;
          const dot = name.lastIndexOf('.');
          if (dot < 0) continue;
          const ext = name.slice(dot).toLowerCase();
          counts[ext] = (counts[ext] ?? 0) + 1;
        }
      }
    }
  }

  const extensions = Object.keys(counts).sort().slice(0, maxExtensions);
  return { extensions, counts, totalFiles: visited };
}

function hasExt(exts: readonly string[], ext: string): boolean {
  return exts.includes(ext);
}

/**
 * Build the `ProjectSignals` object from the project root.
 */
export async function extractProjectSignals(projectRoot: string): Promise<ProjectSignals> {
  const pkgRaw = await readJson(join(projectRoot, 'package.json'));
  const pkg = asPackageJson(pkgRaw);
  const hasPackageJson = pkg !== null;

  const isTypeScript =
    hasPackageJson &&
    (hasAnyDep(pkg!, ['typescript', 'tsx', '@types/node']) ||
      existsSync(join(projectRoot, 'tsconfig.json')));

  const tsRaw = await readJson(join(projectRoot, 'tsconfig.json'));
  const tsConfig = asTsConfig(tsRaw);
  const isTypeScriptESM =
    (pkg?.type === 'module') ||
    (tsConfig?.compilerOptions?.module !== undefined &&
      ['ESNext', 'NodeNext', 'ES2022'].includes(tsConfig.compilerOptions.module));

  const isReact = pkg !== null && hasAnyDep(pkg, ['react', 'react-dom', 'preact']);
  const isVue = pkg !== null && hasAnyDep(pkg, ['vue']);
  const isSvelte = pkg !== null && hasAnyDep(pkg, ['svelte']);
  const isNext = pkg !== null && hasAnyDep(pkg, ['next']);
  const isNestJS = pkg !== null && hasAnyDep(pkg, ['@nestjs/core', '@nestjs/common']);
  const isExpress = pkg !== null && hasAnyDep(pkg, ['express']);
  const isFastify = pkg !== null && hasAnyDep(pkg, ['fastify']);
  const isPostgres =
    pkg !== null && (hasAnyDep(pkg, ['pg', 'postgres', 'postgresql', 'prisma', '@prisma/client']));
  const isMysql = pkg !== null && hasAnyDep(pkg, ['mysql', 'mysql2']);
  const isMongo = pkg !== null && hasAnyDep(pkg, ['mongodb', 'mongoose']);
  const isRedis = pkg !== null && hasAnyDep(pkg, ['redis', 'ioredis']);
  const isDocker =
    existsSync(join(projectRoot, 'Dockerfile')) ||
    existsSync(join(projectRoot, 'docker-compose.yml')) ||
    existsSync(join(projectRoot, 'docker-compose.yaml'));
  const isK8s =
    existsSync(join(projectRoot, 'k8s')) ||
    existsSync(join(projectRoot, 'kubernetes')) ||
    existsSync(join(projectRoot, 'deployment.yaml')) ||
    existsSync(join(projectRoot, 'deployment.yml'));
  const isCommander = pkg !== null && hasAnyDep(pkg, ['commander']);
  // Detect Python projects (requirements.txt, pyproject.toml, setup.py, .py presence).
  const isPython =
    !hasPackageJson ||
    existsSync(join(projectRoot, 'requirements.txt')) ||
    existsSync(join(projectRoot, 'pyproject.toml')) ||
    existsSync(join(projectRoot, 'setup.py'));
  const isCodegraph = pkg !== null && hasAnyDep(pkg, ['@colbymchenry/codegraph']);
  const isHeadroom =
    pkg !== null && (hasAnyDep(pkg, ['headroom-ai']) ||
      Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }).some((k) =>
        k.startsWith('@headroom/')
      ));

  const nodeEngineMajor = parseNodeEngineMajor(pkg?.engines?.node);
  const scan = scanFileTree(projectRoot);
  const topExtensions = scan.extensions;

  // Build the per-extension presence flag map (R003.1: kept for backwards-compat).
  const hasFileExtension: Record<string, boolean> = {};
  for (const ext of TRACKED_EXTENSIONS) {
    hasFileExtension[ext.slice(1)] = hasExt(topExtensions, ext);
  }

  // Build the per-extension fractional share map (R003.1).
  const shareByExtension: Record<string, number> = {};
  if (scan.totalFiles > 0) {
    for (const [ext, count] of Object.entries(scan.counts)) {
      shareByExtension[ext.slice(1)] = count / scan.totalFiles;
    }
  }

  return {
    hasPackageJson,
    isTypeScript,
    isTypeScriptESM,
    isReact,
    isVue,
    isSvelte,
    isNext,
    isNestJS,
    isExpress,
    isFastify,
    isPostgres,
    isMysql,
    isMongo,
    isRedis,
    isDocker,
    isK8s,
    isCommander,
    isCodegraph,
    isHeadroom,
    isPython,
    nodeEngineMajor,
    topExtensions,
    hasFileExtension,
    shareByExtension,
  };
}

// ---------------------------------------------------------------------------
// Skill classification
// ---------------------------------------------------------------------------

export interface InstalledSkill {
  readonly name: string;
  readonly description: string;
  readonly skillPath: string;
}

interface HardcodedRules {
  readonly alwaysRelevant: ReadonlySet<string>;
  readonly nonTsPrefixes: readonly string[];
}

/**
 * Infer the `SkillKind` for a skill by name. Used for the JSON envelope.
 */
export function inferSkillKind(name: string, alwaysRelevant: ReadonlySet<string>): SkillKind {
  if (alwaysRelevant.has(name) && name.startsWith('peaks-')) return 'peaks-family';
  if (alwaysRelevant.has(name)) return 'generic-ai';
  if (NON_TS_SKILL_PREFIXES.some((p) => name.startsWith(p))) return 'language-specific';
  return 'other';
}

/**
 * Classify a single skill given the project signals. Returns the relevance
 * + a list of human-readable reasons (stable for fixtures, so unit tests
 * can assert exact strings).
 */
export function classifySkill(
  skill: InstalledSkill,
  signals: ProjectSignals,
  rules: HardcodedRules
): SkillScopeRecord {
  const reasons: string[] = [];

  // 1. Hard-coded allowlist always wins.
  if (rules.alwaysRelevant.has(skill.name)) {
    reasons.push('hard-coded always-relevant');
    return {
      name: skill.name,
      kind: inferSkillKind(skill.name, rules.alwaysRelevant),
      relevance: 'relevant',
      reasons,
    };
  }

  // 2. Non-TS prefix → irrelevant when the project is TS.
  if (rules.nonTsPrefixes.some((prefix) => skill.name.startsWith(prefix))) {
    if (signals.isTypeScript && !isNonTsProject(signals)) {
      reasons.push('non-TS skill prefix; project is TS');
      return {
        name: skill.name,
        kind: 'language-specific',
        relevance: 'irrelevant',
        reasons,
      };
    }
  }

  // 3. Keyword matching against the description (strong + weak hits).
  const desc = skill.description.toLowerCase();
  // Special-case: when the project is a non-TS project (Python, etc.),
  // language-specific skills with matching keywords should be relevant.
  // R003.1: gate this on the language's fractional share >= threshold,
  // so a 1-file stray `.cpp` does not flip cpp-coding-standards to relevant.
  if (isNonTsProject(signals)) {
    const langMatch = languageKeywordMatch(desc);
    if (langMatch !== null) {
      const ext = LANGUAGE_TO_EXTENSION[langMatch];
      const share = ext === undefined ? 1 : (signals.shareByExtension?.[ext] ?? 0);
      const threshold = readScopeThreshold();
      if (share < threshold) {
        reasons.push(
          `${langMatch} keyword but share ${(share * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(0)}%`,
        );
        return {
          name: skill.name,
          kind: inferSkillKind(skill.name, rules.alwaysRelevant),
          relevance: 'irrelevant',
          reasons,
        };
      }
      reasons.push(`${langMatch} keyword + non-TS project (share ${(share * 100).toFixed(1)}%)`);
      return {
        name: skill.name,
        kind: inferSkillKind(skill.name, rules.alwaysRelevant),
        relevance: 'relevant',
        reasons,
      };
    }
  }
  const strong = strongMatches(desc, signals);
  const weak = weakMatches(desc, signals);

  if (strong.length > 0) {
    reasons.push(...strong);
    return {
      name: skill.name,
      kind: inferSkillKind(skill.name, rules.alwaysRelevant),
      relevance: 'relevant',
      reasons,
    };
  }
  if (weak.length > 0) {
    reasons.push(...weak);
    return {
      name: skill.name,
      kind: inferSkillKind(skill.name, rules.alwaysRelevant),
      relevance: 'borderline',
      reasons,
    };
  }

  return {
    name: skill.name,
    kind: inferSkillKind(skill.name, rules.alwaysRelevant),
    relevance: 'irrelevant',
    reasons: ['no project-signal match'],
  };
}

/**
 * Strong matches: keyword in description that maps to a confirmed project signal.
 */
function strongMatches(description: string, signals: ProjectSignals): string[] {
  const matches: string[] = [];
  if (signals.isReact && /\breact\b/.test(description)) matches.push('react project + react skill');
  if (signals.isVue && /\bvue\b/.test(description)) matches.push('vue project + vue skill');
  if (signals.isSvelte && /\bsvelte\b/.test(description)) matches.push('svelte project + svelte skill');
  if (signals.isNext && /\bnext\.?js\b|\bnextjs\b/.test(description)) matches.push('next project + nextjs skill');
  if (signals.isNestJS && /\bnest\.?js\b|\bnestjs\b/.test(description)) matches.push('nestjs project + nestjs skill');
  if (signals.isExpress && /\bexpress\b/.test(description)) matches.push('express project + express skill');
  if (signals.isFastify && /\bfastify\b/.test(description)) matches.push('fastify project + fastify skill');
  if (signals.isPostgres && /\bpostgres|\bpostgresql\b/.test(description)) matches.push('postgres project + postgres skill');
  if (signals.isMysql && /\bmysql\b/.test(description)) matches.push('mysql project + mysql skill');
  if (signals.isMongo && /\bmongo(?:db)?\b/.test(description)) matches.push('mongo project + mongo skill');
  if (signals.isRedis && /\bredis\b/.test(description)) matches.push('redis project + redis skill');
  if (signals.isDocker && /\bdocker\b/.test(description)) matches.push('docker project + docker skill');
  if (signals.isK8s && /\bkubernetes\b|\bk8s\b/.test(description)) matches.push('k8s project + k8s skill');
  if (signals.isCommander && /\bcommander\b|\bcli\b/.test(description)) matches.push('cli project + cli skill');
  if (/\btdd\b|\btest-driven\b/.test(description)) matches.push('tdd keyword (always relevant)');
  if (/\brefactor\b/.test(description)) matches.push('refactor keyword (always relevant)');
  return matches;
}

/**
 * Weak matches: keyword that's a hint but not a confirmed signal.
 */
function weakMatches(description: string, signals: ProjectSignals): string[] {
  const matches: string[] = [];
  if (
    /\bfrontend\b/.test(description) &&
    (signals.isReact || signals.isVue || signals.isSvelte || signals.isNext)
  ) {
    matches.push('frontend keyword + frontend project');
  }
  if (
    /\bbackend\b/.test(description) &&
    (signals.isNestJS || signals.isExpress || signals.isFastify)
  ) {
    matches.push('backend keyword + backend project');
  }
  if (
    /\bdatabase\b/.test(description) &&
    (signals.isPostgres || signals.isMysql || signals.isMongo || signals.isRedis)
  ) {
    matches.push('database keyword + db project');
  }
  return matches;
}

/**
 * Map a skill description to a non-TS language when the description
 * explicitly mentions that language. Returns null when there's no match.
 */
function languageKeywordMatch(description: string): string | null {
  if (/\bpython\b/.test(description)) return 'python';
  if (/\bkotlin\b/.test(description)) return 'kotlin';
  if (/\bjava\b/.test(description)) return 'java';
  if (/\brust\b/.test(description)) return 'rust';
  if (/\bgo\b|\bgolang\b/.test(description)) return 'go';
  if (/\bruby\b/.test(description)) return 'ruby';
  if (/\bswift\b/.test(description)) return 'swift';
  if (/\bc#\b|\bcsharp\b/.test(description)) return 'csharp';
  if (/\bc\+\+|\bcpp\b/.test(description)) return 'cpp';
  return null;
}

/**
 * R003.1: map a non-TS language keyword to its primary file extension
 * (used to look up the fractional share from `signals.shareByExtension`).
 */
const LANGUAGE_TO_EXTENSION: Readonly<Record<string, string>> = {
  python: 'py',
  kotlin: 'kt',
  java: 'java',
  rust: 'rs',
  go: 'go',
  ruby: 'rb',
  swift: 'swift',
  csharp: 'cs',
  cpp: 'cpp',
};

/**
 * Multi-language project heuristic: if the project's file tree contains
 * extensions matching a non-TS language, OR the project is a Python project,
 * treat it as a non-TS project and let the language-specific skills be relevant.
 */
function isNonTsProject(signals: ProjectSignals): boolean {
  if (signals.isPython) return true;
  const nonTsExts = ['swift', 'kt', 'kts', 'java', 'scala', 'py', 'pyx', 'go', 'rs', 'rb', 'cs'];
  return nonTsExts.some((ext) => signals.hasFileExtension[ext] === true);
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

export interface DetectInput {
  readonly projectRoot: string;
  readonly installedSkillsPath?: string;
  readonly detectedIde?: string | null;
}

export interface DetectResult {
  readonly detectedIde: string | null;
  readonly projectSignals: ProjectSignals;
  readonly skills: readonly SkillScopeRecord[];
  readonly counts: SkillScopeCounts;
}

/**
 * Discover the installed skills under `installedSkillsPath` (default:
 * `~/.claude/skills`). Each subdir containing a SKILL.md counts as an
 * installed skill.
 */
export async function listInstalledSkills(installedSkillsPath: string): Promise<InstalledSkill[]> {
  if (!existsSync(installedSkillsPath)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(installedSkillsPath, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }

  const skills: InstalledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (typeof name !== 'string') continue;
    const skillPath = join(installedSkillsPath, name, 'SKILL.md');
    if (!existsSync(skillPath)) continue;
    try {
      const raw = await readFile(skillPath, 'utf8');
      const frontmatter = parseFrontmatterLoose(raw);
      skills.push({
        name: frontmatter.name ?? name,
        description: frontmatter.description ?? '',
        skillPath,
      });
    } catch {
      skills.push({ name, description: '', skillPath });
    }
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

interface LooseFrontmatter {
  readonly name?: string;
  readonly description?: string;
}

/**
 * Lightweight YAML frontmatter parser (good enough for `name` + `description`).
 * Falls back to regex when the file is malformed.
 */
function parseFrontmatterLoose(content: string): LooseFrontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return {};
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end === -1) return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < end; i += 1) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match === null || match[1] === undefined) continue;
    out[match[1]] = (match[2] ?? '').replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

/**
 * The default installed-skills path: `~/.claude/skills`. Resolved at call
 * time so the orchestrator stays pure-ish (no module-level side effects).
 */
export function defaultInstalledSkillsPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.claude', 'skills');
}

const ALWAYS_RELEVANT_SET: ReadonlySet<string> = new Set(ALWAYS_RELEVANT_SKILLS);

/**
 * Top-level orchestrator. Reads package.json + tsconfig + file tree,
 * discovers installed skills, classifies each one, returns the JSON
 * envelope. Idempotent: same input → same output. No filesystem writes.
 */
export async function detectSkillScope(input: DetectInput): Promise<DetectResult> {
  const projectRoot = input.projectRoot;
  const skillsPath = input.installedSkillsPath ?? defaultInstalledSkillsPath();
  const signals = await extractProjectSignals(projectRoot);
  const installed = await listInstalledSkills(skillsPath);

  const rules: HardcodedRules = {
    alwaysRelevant: ALWAYS_RELEVANT_SET,
    nonTsPrefixes: NON_TS_SKILL_PREFIXES,
  };

  const skills = installed.map((skill) => classifySkill(skill, signals, rules));

  const counts: SkillScopeCounts = {
    relevant: skills.filter((s) => s.relevance === 'relevant').length,
    borderline: skills.filter((s) => s.relevance === 'borderline').length,
    irrelevant: skills.filter((s) => s.relevance === 'irrelevant').length,
  };

  return {
    detectedIde: input.detectedIde ?? null,
    projectSignals: signals,
    skills,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Idempotency guard helper for tests
// ---------------------------------------------------------------------------

/** Compute a stable summary hash (used by tests to assert no time-dependent fields). */
export function detectSummary(result: DetectResult): string {
  const sorted = [...result.skills].sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({
    counts: result.counts,
    skills: sorted.map((s) => ({ name: s.name, relevance: s.relevance })),
  });
}

// Quiet the "unused" warning on statSync when used only in tests paths
void statSync;