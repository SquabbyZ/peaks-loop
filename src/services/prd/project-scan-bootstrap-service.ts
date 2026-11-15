/**
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
 *     schemaVersion:1 (AC3); `refreshMachineFields` rewrites only the
 *     machine-derivable fields of such a file (see
 *     `project-scan-field-refresh.ts`), and `forceTemplates` overrides the
 *     4 bundled templates' skip
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
import { TEMPLATE_FILES, readTemplateStrict } from '../workspace/templates/project-scan/index.js';
import { refreshProjectScanOnDisk } from './project-scan-field-refresh.js';
import { deriveTechStack } from './project-scan-techstack.js';
import { buildExistingProjectScan, buildZeroToOneProjectScan } from './project-scan-content.js';

export type BootstrapProjectScanOptions = {
  readonly projectRoot: string;
  /**
   * Rewrite the machine-derivable frontmatter fields (`capturedAt`,
   * `techStack`, `libraryVersions`) of an existing `schemaVersion: 1`
   * project-scan.md, preserving every other byte. A file that was never
   * populated (empty `architecture` AND empty `techStack`) is refreshed even
   * without this option — it is a shell, not sediment.
   */
  readonly refreshMachineFields?: boolean;
  /** Override the bundled-template skip and overwrite audit/business files. */
  readonly forceTemplates?: boolean;
};

export type BootstrapProjectScanEnvelope = {
  /** True iff project-scan.md was written by this call. */
  readonly created: boolean;
  /** True iff project-scan.md existed and was skipped (idempotent). */
  readonly skipped: boolean;
  /** True iff only the machine-derivable frontmatter fields were rewritten. */
  readonly refreshed: boolean;
  /** Count of files written to .peaks/project-scan/ (1 project-scan.md + N templates). */
  readonly templatesBooted: number;
  /** Count of files already present and skipped (sediment-preserved). */
  readonly templatesSkipped: number;
  /** Absolute path to the project-scan.md file (whether written or pre-existing). */
  readonly projectScanPath: string;
  /** Resolved archetype (when existing-project path was taken). */
  readonly archetype?: string;
  /** Why an existing project-scan.md could not be machine-refreshed. */
  readonly refreshWarning?: string;
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
 *   `pnpm-workspace.yaml` is the most common signal; `turbo.json`
 *   (Turborepo) and `nx.json` (Nx) are the others the ecosystem
 *   reaches for. lerna.json is legacy-only and intentionally omitted
 *   here — those projects should be detected via `package.json`
 *   workspaces[] field below.
 */
const MONOREPO_ROOT_CONFIGS = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json'] as const;

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
 * 2. Any of the monorepo / framework source roots: `packages/`, `apps/`,
 *    `libs/`, `services/`, `workspaces/`, `app/` (Next.js App Router), and
 *    `server/` — each is checked recursively for source files.
 * 3. The project ROOT itself, recursively — which catches the layouts that name
 *    none of the above. Measured 2026-11-16: without it, a Next.js `app/*.tsx`
 *    tree, a `server/` layout and a flat repo with `index.ts` at the root were
 *    all classified 0-1, and because `zeroToOne` gates the refresh their scans
 *    stayed stale forever.
 *
 * Returns true on the first hit. False when none of the candidate
 * roots contain source files (genuine 0-1).
 */
function projectHasSourceFiles(projectRoot: string): boolean {
  if (directoryContainsSourceFiles(join(projectRoot, 'src'))) return true;

  const monorepoSourceRoots = [
    'packages',
    'apps',
    'libs',
    'services',
    'workspaces',
    'app',
    'server'
  ];
  for (const candidate of monorepoSourceRoots) {
    const dir = join(projectRoot, candidate);
    if (!existsSync(dir)) continue;
    if (directoryContainsSourceFiles(dir)) return true;
  }
  return directoryContainsSourceFiles(projectRoot);
}

/** Detect 0-1: no package.json OR no source files.
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
 *
 * Three answers, and the difference between them is load-bearing:
 *   - `null`   — no file at all. The caller may create one.
 *   - `1`      — a file this code understands. Refresh it in place.
 *   - `0`      — a file IS present but its version could not be read. The caller
 *                must NOT regenerate it: `0` exists precisely so that "present,
 *                unclassifiable" is never mistaken for "absent", because
 *                regenerating destroys whatever prose the file holds.
 *
 * CRLF-TOLERANT. `core.autocrlf=true` is the default on Windows, so a checkout
 * hands this function `---\r\n`. A pattern anchored on `\n` alone read such a
 * file as version 0 — which used to fall through to the CREATE branch and
 * overwrite hand-written architecture notes, pinned-version warnings and memory
 * blocks. Measured on 2026-11-16: a CRLF copy of a hand-authored scan lost all
 * three. Hence the `\r?\n` below, which is what keeps a Windows checkout out of
 * that branch.
 */
function readExistingSchemaVersion(absPath: string): number | null {
  if (!existsSync(absPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(absPath, 'utf8');
  } catch {
    return 0;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) return 0;
  const frontmatter = match[1] ?? '';
  const versionMatch = /^\s*schemaVersion:\s*(\d+)/m.exec(frontmatter);
  if (!versionMatch) return 0;
  const parsed = Number(versionMatch[1]);
  return Number.isSafeInteger(parsed) ? parsed : 0;
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

/** What the create-or-refresh-or-skip decision reached, and why. */
type ScanWriteDecision = {
  readonly created: boolean;
  readonly skipped: boolean;
  readonly refreshed: boolean;
  readonly archetype?: string;
  readonly warning?: string;
};

/**
 * Write, refresh, or leave alone the project-scan.md, and say which happened.
 *
 * The three outcomes are mutually exclusive and each has a reason the envelope
 * has to carry:
 *   - CREATE only when the file is ABSENT (`existingVersion === null`);
 *   - REFRESH when a file is present and editable — at schemaVersion 1, or at an
 *     unreadable version (`0`), where the refresh rewrites the machine fields
 *     it can find and leaves everything else alone;
 *   - SKIP otherwise — including a still-0-1 project, whose placeholder is
 *     TRUTHFUL rather than stale.
 *
 * A PRESENT but unclassifiable file never reaches CREATE. That is the rule the
 * `0` return exists for: regenerating a file whose prose nobody can classify is
 * how a hand-written architecture note, a pinned-version warning and a memory
 * block get destroyed, and the file's own body is not something this layer has
 * any right to replace.
 */
async function decideProjectScanWrite(args: {
  readonly absPath: string;
  readonly projectRoot: string;
  readonly existingVersion: number | null;
  readonly zeroToOne: boolean;
  readonly refreshMachineFields: boolean;
}): Promise<ScanWriteDecision> {
  if (args.existingVersion !== null) {
    const outcome = await refreshProjectScanOnDisk({
      absolutePath: args.absPath,
      projectRoot: args.projectRoot,
      zeroToOne: args.zeroToOne,
      requested: args.refreshMachineFields
    });
    return {
      created: false,
      skipped: outcome.skipped,
      refreshed: outcome.refreshed,
      ...(outcome.warning !== undefined ? { warning: outcome.warning } : {})
    };
  }
  if (args.zeroToOne) {
    writeFileSync(args.absPath, buildZeroToOneProjectScan(), 'utf8');
    return { created: true, skipped: false, refreshed: false, archetype: 'unknown' };
  }
  const archetypeReport = await scanArchetype({ projectRoot: args.projectRoot });
  const libraryReport = await scanLibraries({ projectRoot: args.projectRoot });
  const content = buildExistingProjectScan({
    archetypeReport,
    libraryReport,
    techStack: deriveTechStack(args.projectRoot)
  });
  writeFileSync(args.absPath, content, 'utf8');
  return { created: true, skipped: false, refreshed: false, archetype: archetypeReport.archetype };
}

/** Boot the 4 bundled templates (AC9) and count what was written vs preserved. */
async function bootTemplates(args: {
  readonly projectRoot: string;
  readonly force: boolean;
}): Promise<{ readonly booted: number; readonly skipped: number }> {
  let booted = 0;
  let skipped = 0;
  for (const name of TEMPLATE_FILES) {
    const wrote = await bootTemplate({
      projectRoot: args.projectRoot,
      name,
      force: args.force
    });
    if (wrote) booted += 1;
    else skipped += 1;
  }
  return { booted, skipped };
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

  const decision = await decideProjectScanWrite({
    absPath: projectScanAbsPath,
    projectRoot: options.projectRoot,
    existingVersion: readExistingSchemaVersion(projectScanAbsPath),
    zeroToOne: isZeroToOneProject(options.projectRoot),
    refreshMachineFields: options.refreshMachineFields === true
  });

  const templates = await bootTemplates({
    projectRoot: options.projectRoot,
    force: options.forceTemplates === true
  });

  // The project-scan.md this call wrote (or preserved) counts as 1 template.
  return {
    created: decision.created,
    skipped: decision.skipped,
    refreshed: decision.refreshed,
    templatesBooted: templates.booted + (decision.created ? 1 : 0),
    templatesSkipped: templates.skipped + (decision.created ? 0 : 1),
    projectScanPath: projectScanAbsPath,
    ...(decision.archetype !== undefined ? { archetype: decision.archetype } : {}),
    ...(decision.warning !== undefined ? { refreshWarning: decision.warning } : {}),
    durationMs: Date.now() - startedAt
  };
}
