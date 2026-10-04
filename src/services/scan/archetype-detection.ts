/**
 * Archetype detection primitives (B wave-3 file-size split).
 *
 * Extracted verbatim from `archetype-service.ts`: the backend /
 * monorepo / swagger candidate lists, the archetype-detection
 * thresholds (PRD-002b slice 2), and the async detectors that probe a
 * project root for those signals. Values are bytewise-identical to
 * the original literals. `archetype-service.ts` keeps the decision
 * functions (`decideArchetype`, `decideFrontendOnly`,
 * `decideIntegrationMode`) and the public `scanArchetype` entry; the
 * `frontendOnly` / `frontendOnlyReason` output contract is unchanged.
 */

import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative as relativePath } from 'node:path';
import { isDirectory, pathExists, readText } from 'peaks-loop-shared/fs';

export const BACKEND_DEP_NAMES = [
  'express',
  'koa',
  'fastify',
  '@nestjs/core',
  '@nestjs/common',
  'hapi',
  '@hapi/hapi',
  'restify',
  'next' // treated separately for API routes
];

export const BACKEND_DIR_CANDIDATES = [
  'server',
  'backend',
  'api',
  'apps/server',
  'apps/api',
  'packages/server',
  'packages/api'
];
export const MONOREPO_CONFIG_FILES = [
  'pnpm-workspace.yaml',
  'lerna.json',
  'turbo.json',
  'nx.json',
  'rush.json'
];

/**
 * PRD-002b slice 2 — extract archetype-detection thresholds. Names
 * describe the meaning; values are bytewise-identical to the original
 * literals (signaled in commit message).
 */
// eslint-disable-next-line no-magic-numbers -- canonical ms-per-day math (1000 * 60s * 60min * 24h)
export const MS_PER_DAY = 1000 * 60 * 60 * 24;
export const GREENFIELD_MAX_SRC_FILES = 20;
export const LEGACY_MIN_SRC_FILES = 20;
export const LOCKFILE_STALE_DAYS = 180;
export const GREENFIELD_MAX_LOCKFILE_DAYS = 30;
export const HIGH_CONFIDENCE_SIGNAL_COUNT = 3;
export const SWAGGER_CANDIDATE_PATHS = [
  'swagger.json',
  'swagger.yaml',
  'openapi.json',
  'openapi.yaml',
  'openapi.yml',
  'docs/swagger.json',
  'docs/openapi.json',
  'docs/openapi.yaml'
];

type PackageJsonRecord = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

export async function readPackageJsonDeps(
  projectRoot: string
): Promise<{ exists: boolean; deps: Record<string, string> }> {
  const pkgPath = join(projectRoot, 'package.json');
  if (!(await pathExists(pkgPath))) {
    return { exists: false, deps: {} };
  }
  try {
    const raw = await readText(pkgPath);
    const parsed = JSON.parse(raw) as PackageJsonRecord;
    const deps: Record<string, string> = {
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
      ...(parsed.peerDependencies ?? {}),
      ...(parsed.optionalDependencies ?? {})
    };
    return { exists: true, deps };
  } catch {
    return { exists: true, deps: {} };
  }
}

export async function detectBackendFrameworks(deps: Record<string, string>): Promise<string[]> {
  return BACKEND_DEP_NAMES.filter(
    (name) => name !== 'next' && Object.prototype.hasOwnProperty.call(deps, name)
  );
}

/**
 * Manifests that only a service writes. Language-diverse on purpose: every
 * other probe in this file is Node-specific, and a repository whose backend is
 * Go / Java / Kotlin / Python / Ruby / PHP / Rust has no Node manifest at all,
 * so a Node-only evidence set reported it as `frontendOnly`.
 */
export const SERVICE_ONLY_MANIFEST_FILES = [
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'manage.py',
  'config.ru',
  'artisan'
];

/**
 * Manifests a service MAY write and a library or CLI also writes. Counted as
 * backend evidence only when the file itself names a web framework — the
 * alternative is a boolean that fires on any Python or Rust directory, which
 * trades one wrong answer for another.
 */
export const CONDITIONAL_SERVICE_MANIFESTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['requirements.txt', /\b(fastapi|flask|django|uvicorn|gunicorn|aiohttp|tornado|starlette)\b/i],
  ['pyproject.toml', /\b(fastapi|flask|django|uvicorn|gunicorn|aiohttp|tornado|starlette)\b/i],
  ['Cargo.toml', /\b(actix-web|axum|rocket|warp|tonic|hyper|poem)\b/i],
  ['Gemfile', /\b(rails|sinatra|hanami|puma|rack)\b/i],
  ['composer.json', /\b(laravel|symfony|slim)\b/i]
];

/** Directories never worth descending into when looking for a service manifest. */
const MANIFEST_WALK_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
  '.git'
]);

/**
 * How deep from the project root a service is allowed to sit before its
 * manifest stops being counted. Two levels covers the layouts that were
 * invisible (`apps/gateway/package.json`, `services/checkout/requirements.txt`,
 * `web/` + `cmd/server`), and a deeper walk would read generated trees.
 */
export const SERVICE_MANIFEST_MAX_DEPTH = 2;

/** A directory in the bounded walk, with how deep from the root it sits. */
type WalkEntry = { dir: string; depth: number };

/**
 * How many leading bytes of a source file are read to find a directive. `'use
 * server'` must be the first statement, so the head is the whole question, and
 * reading a bounded head keeps this probe from pulling multi-megabyte files into
 * memory.
 */
const DIRECTIVE_HEAD_BYTES = 400;

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    // An unreadable directory is not evidence of a backend, and not of its
    // absence either; the root manifest already carries the project.
    return [];
  }
}

function relativeFromRoot(projectRoot: string, dir: string): string {
  return relativePath(projectRoot, dir).replace(/\\/g, '/');
}

function labeled(relative: string, file: string): string {
  return relative === '' ? file : `${relative}/${file}`;
}

function descendable(entries: Dirent[], dir: string, depth: number): WalkEntry[] {
  if (depth >= SERVICE_MANIFEST_MAX_DEPTH) return [];
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !MANIFEST_WALK_SKIP_DIRS.has(entry.name) &&
        !entry.name.startsWith('.')
    )
    .map((entry) => ({ dir: join(dir, entry.name), depth: depth + 1 }));
}

/**
 * Service manifests sitting in ONE directory: the unmistakable ones by name,
 * and the shared ones only when the file names a web framework.
 */
async function manifestEvidenceInDir(
  dir: string,
  relative: string,
  names: ReadonlySet<string>
): Promise<string[]> {
  const found: string[] = SERVICE_ONLY_MANIFEST_FILES.filter((manifest) => names.has(manifest)).map(
    (manifest) => labeled(relative, manifest)
  );
  for (const [manifest, pattern] of CONDITIONAL_SERVICE_MANIFESTS) {
    if (!names.has(manifest)) continue;
    const text = await readText(join(dir, manifest)).catch(() => '');
    const matched = pattern.exec(text);
    if (matched !== null) {
      found.push(`${labeled(relative, manifest)} (${matched[0].toLowerCase()})`);
    }
  }
  return found;
}

/**
 * A nested `package.json` declares its own dependencies, and a workspace root
 * does not list them. Reading only the root is how an express service under
 * `apps/` became `frontendOnly`.
 */
async function workspacePackageEvidence(
  dir: string,
  relative: string,
  names: ReadonlySet<string>,
  backendDepNames: readonly string[]
): Promise<string[]> {
  if (relative === '' || !names.has('package.json')) return [];
  const { deps } = await readPackageJsonDeps(dir);
  return backendDepNames
    .filter((dep) => dep !== 'next' && Object.prototype.hasOwnProperty.call(deps, dep))
    .map((dep) => `${relative}: ${dep}`);
}

/**
 * Backend evidence that lives OUTSIDE the root manifest: a workspace package's
 * own `package.json`, and any non-Node service manifest.
 *
 * Returns `dir: evidence` strings (`apps/gateway: express`, `go.mod`,
 * `services/checkout: requirements.txt`) rather than a boolean, because the
 * whole defect this probe closes was a verdict that could not say what it saw.
 */
export async function detectNestedServiceEvidence(
  projectRoot: string,
  backendDepNames: readonly string[] = BACKEND_DEP_NAMES
): Promise<string[]> {
  const evidence: string[] = [];
  const queue: WalkEntry[] = [{ dir: projectRoot, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await readDirSafe(current.dir);
    const names = new Set(entries.map((entry) => entry.name));
    const relative = relativeFromRoot(projectRoot, current.dir);
    evidence.push(...(await manifestEvidenceInDir(current.dir, relative, names)));
    evidence.push(
      ...(await workspacePackageEvidence(current.dir, relative, names, backendDepNames))
    );
    queue.push(...descendable(entries, current.dir, current.depth));
  }
  return evidence.sort();
}

/** Does this directory tree contain a file opening with `'use server'`? */
async function hasUseServerFile(rootDir: string): Promise<boolean> {
  const queue: WalkEntry[] = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await readDirSafe(current.dir);
    for (const entry of entries) {
      const full = join(current.dir, entry.name);
      if (entry.isDirectory()) continue;
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const text = await readText(full).catch(() => '');
      if (/['"]use server['"]/.test(text.slice(0, DIRECTIVE_HEAD_BYTES))) return true;
    }
    queue.push(...descendable(entries, current.dir, current.depth));
  }
  return false;
}

/**
 * Next.js server actions: `'use server'` in a file under `app/`. Route handlers
 * under `pages/api` / `app/api` were the only Next backend the detector knew
 * about, so a Next app that mutates data through actions — the documented
 * Next.js way — was reported as having no backend at all.
 */
export async function detectNextServerActions(projectRoot: string): Promise<boolean> {
  for (const root of ['app', 'src/app']) {
    const rootDir = join(projectRoot, root);
    if (await isDirectory(rootDir)) {
      if (await hasUseServerFile(rootDir)) return true;
    }
  }
  return false;
}

export async function detectNextApiRoutes(projectRoot: string, hasNext: boolean): Promise<boolean> {
  if (!hasNext) {
    return false;
  }
  const candidates = ['pages/api', 'src/pages/api', 'app/api', 'src/app/api'];
  for (const candidate of candidates) {
    if (await isDirectory(join(projectRoot, candidate))) {
      return true;
    }
  }
  return false;
}

export async function detectBackendDirs(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of BACKEND_DIR_CANDIDATES) {
    if (await isDirectory(join(projectRoot, candidate))) {
      found.push(candidate);
    }
  }
  return found;
}

export async function detectSwagger(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of SWAGGER_CANDIDATE_PATHS) {
    if (await pathExists(join(projectRoot, candidate))) {
      found.push(candidate);
    }
  }
  const protoDir = join(projectRoot, 'proto');
  if (await isDirectory(protoDir)) {
    found.push('proto/');
  }
  return found;
}

export async function detectMonorepoConfigs(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of MONOREPO_CONFIG_FILES) {
    if (await pathExists(join(projectRoot, file))) {
      found.push(file);
    }
  }
  return found;
}

export async function lockfileAgeDays(projectRoot: string): Promise<number | null> {
  const candidates = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'];
  for (const candidate of candidates) {
    const full = join(projectRoot, candidate);
    if (await pathExists(full)) {
      const stats = await stat(full);
      const ageMs = Date.now() - stats.mtimeMs;
      return Math.floor(ageMs / MS_PER_DAY);
    }
  }
  return null;
}
