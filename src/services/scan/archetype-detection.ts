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

import { stat } from 'node:fs/promises';
import { join } from 'node:path';
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
