/**
 * project-scan bootstrap service — slice 2026-07-15-project-scan-bootstrap
 * (PRD G1 + G2 + G4b / AC1-AC10 / R1-R4).
 *
 * Owns the "first time a project enters Peaks-Loop" bootstrap flow:
 *   - 0-1 detection (no package.json OR no source files)
 *   - writes `.peaks/project-scan/project-scan.md` with empty placeholders
 *     for 0-1 projects, or with archetype + libraryVersions for existing
 *     projects (calling `scanArchetype` + `scanLibraries` directly, not
 *     forking a CLI process)
 *   - boots the 4 audit/business templates (bundled in repo at
 *     `src/services/workspace/templates/project-scan/`) into
 *     `.peaks/project-scan/` (AC9)
 *   - idempotent: skips re-writes when the existing file is at
 *     schemaVersion:1 (AC3); --force / --force-templates override
 *
 * Called by:
 *   - `peaks project context` (via `generateProjectContext`)
 *   - `peaks workspace init` (main path)
 *
 * The "5 templates" count: 4 bundled audit/business files + the
 * dynamically-generated `project-scan.md` produced by this service.
 * `templatesBooted` reflects the count of files actually written;
 * `templatesSkipped` reflects files already present (sediment-protected).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scanArchetype } from '../scan/archetype-service.js';
import { scanLibraries } from '../scan/libraries-service.js';
import type { ArchetypeReport } from '../scan/scan-types.js';
import type { LibraryReport } from '../scan/libraries-types.js';
import {
  TEMPLATE_FILES,
  readTemplateStrict
} from '../workspace/templates/project-scan/index.js';

export type BootstrapProjectScanOptions = {
  readonly projectRoot: string;
  /** Override the existing-file skip and rewrite project-scan.md. */
  readonly force?: boolean;
  /** Override the bundled-template skip and overwrite audit/business files. */
  readonly forceTemplates?: boolean;
};

export type BootstrapProjectScanEnvelope = {
  /** True iff project-scan.md was written by this call. */
  readonly created: boolean;
  /** True iff project-scan.md existed and was skipped (idempotent). */
  readonly skipped: boolean;
  /** Count of files written to .peaks/project-scan/ (1 project-scan.md + N templates). */
  readonly templatesBooted: number;
  /** Count of files already present and skipped (sediment-preserved). */
  readonly templatesSkipped: number;
  /** Absolute path to the project-scan.md file (whether written or pre-existing). */
  readonly projectScanPath: string;
  /** Resolved archetype (when existing-project path was taken). */
  readonly archetype?: string;
  /** Total wall-time of the bootstrap call. */
  readonly durationMs: number;
};

const PROJECT_SCAN_DIR = join('.peaks', 'project-scan');
const PROJECT_SCAN_FILENAME = 'project-scan.md';
const PROJECT_SCAN_PATH = join(PROJECT_SCAN_DIR, PROJECT_SCAN_FILENAME);

const SOURCE_FILE_EXTENSIONS = /\.(tsx?|jsx?|vue|svelte)$/;

/**
 * Monorepo layout sentinels. A project is monorepo-shaped if it carries
 * one of these config files at its root, even when `src/` is absent.
 * Slice 2026-07-15 hot-fix (ice-cola real-world test, 2026-07-15):
 *   `pnpm-workspace.yaml` is the most common signal; `turbo.json`
 *   (Turborepo) and `nx.json` (Nx) are the others the ecosystem
 *   reaches for. lerna.json is legacy-only and intentionally omitted
 *   here — those projects should be detected via `package.json`
 *   workspaces[] field below.
 */
const MONOREPO_ROOT_CONFIGS = [
  'pnpm-workspace.yaml',
  'turbo.json',
  'nx.json'
] as const;

/** True iff the project root declares pnpm / yarn / npm workspaces. */
function projectHasWorkspacesInPackageJson(projectRoot: string): boolean {
  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return false;
  let raw: string;
  try {
    raw = readFileSync(pkgPath, 'utf8');
  } catch {
    return false;
  }
  let pkg: { workspaces?: unknown };
  try {
    pkg = JSON.parse(raw) as { workspaces?: unknown };
  } catch {
    return false;
  }
  if (Array.isArray(pkg.workspaces)) return pkg.workspaces.length > 0;
  if (pkg.workspaces && typeof pkg.workspaces === 'object') {
    // Yarn classic shape: { packages: ['packages/*'] }
    const obj = pkg.workspaces as { packages?: unknown };
    if (Array.isArray(obj.packages)) return obj.packages.length > 0;
  }
  return false;
}

/** True iff the project root is a monorepo by any of the 3 root-config signals. */
function projectIsMonorepo(projectRoot: string): boolean {
  for (const cfg of MONOREPO_ROOT_CONFIGS) {
    if (existsSync(join(projectRoot, cfg))) return true;
  }
  return projectHasWorkspacesInPackageJson(projectRoot);
}

/**
 * Recursive file-existence check for a single root dir, capped at MAX_DEPTH.
 * Returns true the first time it encounters a file matching
 * SOURCE_FILE_EXTENSIONS. Skips dot-dirs and node_modules.
 */
function directoryContainsSourceFiles(rootDir: string): boolean {
  if (!existsSync(rootDir)) return false;
  const queue: string[] = [rootDir];
  const MAX_DEPTH = 6;
  let depth = 0;

  while (queue.length > 0 && depth <= MAX_DEPTH) {
    const current = queue.shift();
    if (current === undefined) break;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (entry.isFile() && SOURCE_FILE_EXTENSIONS.test(entry.name)) {
        return true;
      }
    }
    depth += 1;
  }
  return false;
}

/**
 * Heuristic for "this directory holds source code".
 *
 * 1. `src/` at the root (single-package layout).
 * 2. Any of the monorepo source roots: `packages/`, `apps/`, `libs/`,
 *    `services/`, `workspaces/` — each is checked recursively for at
 *    least one matching source file. Slice 2026-07-15 hot-fix (ice-cola
 *    test, 2026-07-15): the original implementation only looked at
 *    `src/` and mis-classified monorepos as 0-1 (pnpm-workspace layout
 *    puts source under `packages/<pkg>/src/`, not `<root>/src/`).
 *
 * Returns true on the first hit. False when none of the candidate
 * roots contain source files (genuine 0-1).
 */
function projectHasSourceFiles(projectRoot: string): boolean {
  if (directoryContainsSourceFiles(join(projectRoot, 'src'))) return true;

  const monorepoSourceRoots = ['packages', 'apps', 'libs', 'services', 'workspaces'];
  for (const candidate of monorepoSourceRoots) {
    const dir = join(projectRoot, candidate);
    if (!existsSync(dir)) continue;
    if (directoryContainsSourceFiles(dir)) return true;
  }
  return false;
}

/** Detect 0-1: no package.json OR no source files.
 *  Slice 2026-07-15 hot-fix (ice-cola test, 2026-07-15): monorepos with
 *  source under packages/<pkg>/ are no longer mis-classified as 0-1. */
function isZeroToOneProject(projectRoot: string): boolean {
  const hasPackageJson = existsSync(join(projectRoot, 'package.json'));
  if (!hasPackageJson) return true;
  if (projectIsMonorepo(projectRoot)) {
    // Monorepo: a package.json at root + workspace config is enough
    // signal that this is NOT a 0-1 project — even if we couldn't find
    // source files at the expected roots (workspace packages may be
    // missing locally, behind a sparse-checkout, etc.). Trust the
    // workspace layout and let `scanArchetype` decide the real shape.
    return false;
  }
  return !projectHasSourceFiles(projectRoot);
}

/**
 * Parse the frontmatter `schemaVersion` from an existing project-scan.md.
 * Returns `null` when the file is absent, malformed, or has no version.
 * The reader in `services/prd/project-scan-reader.ts` is the canonical
 * parser; we re-implement the minimum here to avoid coupling the
 * bootstrap path to that reader's strict shape validation.
 */
function readExistingSchemaVersion(absPath: string): number | null {
  if (!existsSync(absPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  if (!match) return null;
  const frontmatter = match[1] ?? '';
  const versionMatch = /^\s*schemaVersion:\s*(\d+)/m.exec(frontmatter);
  if (!versionMatch) return null;
  const parsed = Number(versionMatch[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Build the project-scan.md content for a 0-1 project (empty placeholders). */
function buildZeroToOneProjectScan(): string {
  const now = new Date().toISOString();
  return [
    '---',
    'schemaVersion: 1',
    `capturedAt: ${now}`,
    'archetype: unknown',
    'confidence: low',
    'techStack: {}',
    'libraryVersions: {}',
    'architecture: ""',
    'karpathySelfCheck: {}',
    '---',
    '',
    '# Project Scan (0-1 bootstrap)',
    '',
    `> Auto-generated by \`peaks workspace init\` / \`peaks project context\` on ${now}. ` +
      'Refresh with `peaks project context --project <repo>` once the project has a `package.json` + source files.',
    '',
    '## Archetype',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Type | `unknown` |',
    '| Confidence | `low` |',
    '| Reason | 0-1 project, no package.json or source files |',
    '| Frontend-only | `false` |',
    '',
    '## Project mode',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Mode | unknown |',
    '| Reason | 0-1 bootstrap — refresh after the first source file lands |',
    '',
    '## Tech stack',
    '',
    '| Concern | Value |',
    '|---|---|',
    '| Language | (empty) |',
    '| Package manager | (empty) |',
    '| Node runtime | (empty) |',
    '| Build | (empty) |',
    '| Tests | (empty) |',
    '',
    '## Library versions',
    '',
    '| Package | Pinned range | Major | Scope | Ecosystem |',
    '|---|---|---|---|---|',
    '| (empty) | — | — | — | — |',
    '',
    '## Architecture',
    '',
    '_No architecture recorded yet — refresh with `peaks project context --project <repo>` once the project has source files._',
    '',
    '## Karpathy self-check',
    '',
    '| Guideline | Where enforced |',
    '|---|---|',
    '| §1 Think Before Coding | (empty) |',
    '| §2 Simplicity First | (empty) |',
    '| §3 Surgical Changes | (empty) |',
    '| §4 Goal-Driven Execution | (empty) |',
    '',
    '## Refresh procedure',
    '',
    '1. Add a `package.json` (with `pnpm init` or equivalent).',
    '2. Add at least one TypeScript/JavaScript/Vue/Svelte source file under `src/`.',
    '3. Re-run `peaks project context --project <repo>` — the empty placeholders are replaced with real archetype + libraryVersions.',
    ''
  ].join('\n');
}

/** Render a LibraryReport as a markdown table body (header row included). */
function renderLibraryTable(libraryReport: LibraryReport): string {
  const header = '| Package | Pinned range | Major | Scope | Ecosystem |';
  const sep = '|---|---|---|---|---|';
  if (libraryReport.libraries.length === 0) {
    return [header, sep, '| (empty) | — | — | — | — |'].join('\n');
  }
  const rows = libraryReport.libraries.map((entry) => {
    const major = entry.major === null ? '—' : String(entry.major);
    return `| \`${entry.name}\` | \`${entry.version}\` | ${major} | ${entry.scope} | ${entry.ecosystem} |`;
  });
  return [header, sep, ...rows].join('\n');
}

/** Build the project-scan.md content for an existing project. */
async function buildExistingProjectScan(args: {
  archetypeReport: ArchetypeReport;
  libraryReport: LibraryReport;
}): Promise<string> {
  const { archetypeReport, libraryReport } = args;
  const now = new Date().toISOString();
  const runtime = (process.versions.node ?? 'unknown').trim();

  // Library versions snapshot: a flat {name: version} map. Mirrors the
  // shape consumed by `services/prd/project-scan-types.ts`
  // `ProjectScanLibraryVersions`.
  const libraryVersionsMap: Record<string, string> = {};
  for (const entry of libraryReport.libraries) {
    libraryVersionsMap[entry.name] = entry.version;
  }

  const lines: string[] = [
    '---',
    'schemaVersion: 1',
    `capturedAt: ${now}`,
    `archetype: ${archetypeReport.archetype}`,
    `confidence: ${archetypeReport.confidence}`,
    'techStack: {}',
    `libraryVersions: ${JSON.stringify(libraryVersionsMap, null, 2)
      .split('\n')
      .map((line, idx) => (idx === 0 ? line : '  ' + line))
      .join('\n')}`,
    'architecture: ""',
    'karpathySelfCheck: {}',
    '---',
    '',
    `# Project Scan (refreshed ${now})`,
    '',
    '> Auto-generated by `peaks workspace init` / `peaks project context`.',
    '',
    '## Archetype',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Type | \`${archetypeReport.archetype}\` |`,
    `| Confidence | \`${archetypeReport.confidence}\` |`,
    `| Frontend-only | \`${String(archetypeReport.frontendOnly)}\` |`,
    `| Reason | ${archetypeReport.frontendOnlyReason} |`,
    '',
    '## Project mode',
    '',
    '| Field | Value |',
    '|---|---|',
    `| Mode | ${archetypeReport.frontendOnly ? 'frontend-only' : 'full-stack-or-unknown'} |`,
    `| Reason | ${archetypeReport.frontendOnlyReason} |`,
    '',
    '## Tech stack',
    '',
    '| Concern | Value |',
    '|---|---|',
    '| Language | TypeScript (best-effort — re-confirm via package.json devDeps) |',
    '| Package manager | pnpm (best-effort) |',
    `| Node runtime | node ${runtime} |`,
    '| Build | tsc / package.json `build` script |',
    '| Tests | vitest (best-effort) |',
    '',
    '## Library versions',
    '',
    renderLibraryTable(libraryReport),
    '',
    '## Architecture',
    '',
    `_Auto-generated from \`scanArchetype\` signals — see archetypeReport.backendFrameworks / .backendDirsPresent / .swaggerPaths in \`.peaks/_runtime/<sid>/rd/project-scan.md\` (legacy) or \`.peaks/project-scan/project-scan.md\` (this file) for the raw facts._`,
    '',
    '## Karpathy self-check',
    '',
    '| Guideline | Where enforced |',
    '|---|---|',
    '| §1 Think Before Coding | (refresh with LLM review) |',
    '| §2 Simplicity First | (refresh with LLM review) |',
    '| §3 Surgical Changes | (refresh with LLM review) |',
    '| §4 Goal-Driven Execution | (refresh with LLM review) |',
    '',
    '## Refresh procedure',
    '',
    '1. Re-run `peaks scan archetype --project <repo> --json` and `peaks scan libraries --project <repo> --json` after any dependency / archetype change.',
    '2. Re-run `peaks project context --project <repo>` to refresh this file.',
    '3. Commit the regenerated project-scan.md alongside the dependency bump.',
    ''
  ];
  return lines.join('\n');
}

/**
 * Ensure `.peaks/project-scan/` exists. Idempotent.
 */
function ensureProjectScanDir(projectRoot: string): void {
  const dir = join(projectRoot, PROJECT_SCAN_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Copy one bundled template into the project. Returns `true` when
 * the file was written, `false` when it was skipped (already present
 * without `--force-templates`).
 */
async function bootTemplate(args: {
  projectRoot: string;
  name: string;
  force: boolean;
}): Promise<boolean> {
  const destPath = join(args.projectRoot, PROJECT_SCAN_DIR, args.name);
  if (existsSync(destPath) && !args.force) {
    return false;
  }
  const content = await readTemplateStrict(args.name);
  writeFileSync(destPath, content, 'utf8');
  return true;
}

/**
 * Public entry point. See the file header for the full contract.
 */
export async function bootstrapProjectScan(
  options: BootstrapProjectScanOptions
): Promise<BootstrapProjectScanEnvelope> {
  const startedAt = Date.now();
  ensureProjectScanDir(options.projectRoot);

  const projectScanAbsPath = join(options.projectRoot, PROJECT_SCAN_PATH);
  const existingVersion = readExistingSchemaVersion(projectScanAbsPath);

  // Decide whether project-scan.md is created or skipped. Idempotency:
  // when an existing file already declares schemaVersion:1 we honor
  // sediment unless `force=true`.
  let created = false;
  let skipped = false;
  let archetype: string | undefined;

  if (existingVersion === 1 && options.force !== true) {
    skipped = true;
  } else {
    const zeroToOne = isZeroToOneProject(options.projectRoot);
    if (zeroToOne) {
      archetype = 'unknown';
      writeFileSync(projectScanAbsPath, buildZeroToOneProjectScan(), 'utf8');
    } else {
      const archetypeReport = await scanArchetype({ projectRoot: options.projectRoot });
      const libraryReport = await scanLibraries({ projectRoot: options.projectRoot });
      archetype = archetypeReport.archetype;
      const content = await buildExistingProjectScan({ archetypeReport, libraryReport });
      writeFileSync(projectScanAbsPath, content, 'utf8');
    }
    created = true;
  }

  // Boot the 4 bundled templates (AC9). The project-scan.md we just
  // wrote (or preserved) is also counted as 1 template.
  let templatesBooted = created ? 1 : 0;
  let templatesSkipped = created ? 0 : 1;

  for (const name of TEMPLATE_FILES) {
    const wrote = await bootTemplate({
      projectRoot: options.projectRoot,
      name,
      force: options.forceTemplates === true
    });
    if (wrote) {
      templatesBooted += 1;
    } else {
      templatesSkipped += 1;
    }
  }

  return {
    created,
    skipped,
    templatesBooted,
    templatesSkipped,
    projectScanPath: projectScanAbsPath,
    ...(archetype !== undefined ? { archetype } : {}),
    durationMs: Date.now() - startedAt
  };
}