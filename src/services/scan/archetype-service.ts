import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory, pathExists, readText } from '../../shared/fs.js';
import type { ArchetypeReport, ArchetypeSignal, ProjectArchetype } from './scan-types.js';

export type ArchetypeScanOptions = {
  projectRoot: string;
};

const BACKEND_DEP_NAMES = [
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

const BACKEND_DIR_CANDIDATES = ['server', 'backend', 'api', 'apps/server', 'apps/api', 'packages/server', 'packages/api'];
const MONOREPO_CONFIG_FILES = ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json', 'nx.json', 'rush.json'];
const SWAGGER_CANDIDATE_PATHS = [
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

async function readPackageJsonDeps(projectRoot: string): Promise<{ exists: boolean; deps: Record<string, string> }> {
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

async function detectBackendFrameworks(deps: Record<string, string>): Promise<string[]> {
  return BACKEND_DEP_NAMES.filter((name) => name !== 'next' && Object.prototype.hasOwnProperty.call(deps, name));
}

async function detectNextApiRoutes(projectRoot: string, hasNext: boolean): Promise<boolean> {
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

async function detectBackendDirs(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const candidate of BACKEND_DIR_CANDIDATES) {
    if (await isDirectory(join(projectRoot, candidate))) {
      found.push(candidate);
    }
  }
  return found;
}

async function detectSwagger(projectRoot: string): Promise<string[]> {
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

async function detectMonorepoConfigs(projectRoot: string): Promise<string[]> {
  const found: string[] = [];
  for (const file of MONOREPO_CONFIG_FILES) {
    if (await pathExists(join(projectRoot, file))) {
      found.push(file);
    }
  }
  return found;
}

async function countSrcFiles(projectRoot: string, max = 500): Promise<number> {
  const srcDir = join(projectRoot, 'src');
  if (!(await isDirectory(srcDir))) {
    return 0;
  }
  let count = 0;
  const queue: string[] = [srcDir];
  while (queue.length > 0 && count < max) {
    const current = queue.shift();
    if (current === undefined) break;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else if (/\.(tsx?|jsx?|vue|svelte)$/.test(entry.name)) {
        count += 1;
        if (count >= max) break;
      }
    }
  }
  return count;
}

async function lockfileAgeDays(projectRoot: string): Promise<number | null> {
  const candidates = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'];
  for (const candidate of candidates) {
    const full = join(projectRoot, candidate);
    if (await pathExists(full)) {
      const stats = await stat(full);
      const ageMs = Date.now() - stats.mtimeMs;
      return Math.floor(ageMs / (1000 * 60 * 60 * 24));
    }
  }
  return null;
}

function decideArchetype(
  detected: ArchetypeReport['detected']
): { archetype: ProjectArchetype; confidence: 'high' | 'medium' | 'low'; signals: ArchetypeSignal[] } {
  const signals: ArchetypeSignal[] = [];

  const hasBackend = detected.hasBackendFramework || detected.hasNextApiRoutes || detected.backendDirsPresent.length > 0;
  signals.push({
    name: 'backend-presence',
    matched: hasBackend,
    detail: hasBackend
      ? [
          detected.backendFrameworks.length > 0 ? `framework: ${detected.backendFrameworks.join(', ')}` : null,
          detected.hasNextApiRoutes ? 'next-api-routes' : null,
          detected.backendDirsPresent.length > 0 ? `dirs: ${detected.backendDirsPresent.join(', ')}` : null
        ]
          .filter(Boolean)
          .join('; ')
      : 'no backend framework, no next API routes, no backend dirs'
  });

  signals.push({
    name: 'swagger-or-proto',
    matched: detected.hasSwaggerOrProto,
    detail: detected.hasSwaggerOrProto ? detected.swaggerPaths.join(', ') : 'no swagger/openapi/proto'
  });

  signals.push({
    name: 'monorepo-config',
    matched: detected.hasMonorepoConfig,
    detail: detected.hasMonorepoConfig ? detected.monorepoConfigs.join(', ') : 'no monorepo config'
  });

  signals.push({
    name: 'src-size',
    matched: detected.srcFileCount >= 20,
    detail: `${detected.srcFileCount} source files in src/`
  });

  signals.push({
    name: 'lockfile-age',
    matched: detected.lockfileAgeDays !== null && detected.lockfileAgeDays > 180,
    detail: detected.lockfileAgeDays === null ? 'no lockfile' : `${detected.lockfileAgeDays} days`
  });

  if (!detected.hasPackageJson) {
    return { archetype: 'unknown', confidence: 'low', signals };
  }

  if (detected.hasMonorepoConfig && !hasBackend) {
    return { archetype: 'frontend-monorepo', confidence: 'high', signals };
  }

  if (hasBackend && detected.srcFileCount >= 20) {
    return { archetype: 'legacy-fullstack', confidence: 'high', signals };
  }

  const greenfieldSignals = [
    detected.srcFileCount < 20,
    detected.lockfileAgeDays === null || detected.lockfileAgeDays <= 30,
    !detected.hasSwaggerOrProto
  ];
  const greenfieldSignalCount = greenfieldSignals.filter(Boolean).length;
  // Greenfield must show both a small src AND a fresh/missing lockfile — otherwise an empty-src legacy stub still looks like greenfield.
  if (!hasBackend && greenfieldSignals[0] === true && greenfieldSignals[1] === true) {
    return { archetype: 'greenfield', confidence: greenfieldSignalCount === 3 ? 'high' : 'medium', signals };
  }

  const legacySignalCount = [
    !hasBackend,
    !detected.hasSwaggerOrProto,
    (detected.lockfileAgeDays !== null && detected.lockfileAgeDays > 180) || detected.srcFileCount >= 20
  ].filter(Boolean).length;

  if (!hasBackend && legacySignalCount >= 2) {
    return { archetype: 'legacy-frontend', confidence: legacySignalCount === 3 ? 'high' : 'medium', signals };
  }

  if (hasBackend) {
    return { archetype: 'legacy-fullstack', confidence: 'medium', signals };
  }

  return { archetype: 'unknown', confidence: 'low', signals };
}

function decideFrontendOnly(report: Omit<ArchetypeReport, 'frontendOnly' | 'frontendOnlyReason'>): {
  frontendOnly: boolean;
  reason: string;
} {
  if (report.archetype === 'legacy-frontend' || report.archetype === 'frontend-monorepo') {
    return { frontendOnly: true, reason: `archetype=${report.archetype}` };
  }
  const noBackend = !report.detected.hasBackendFramework && !report.detected.hasNextApiRoutes && report.detected.backendDirsPresent.length === 0;
  if (noBackend && !report.detected.hasSwaggerOrProto) {
    return { frontendOnly: true, reason: 'no-backend-no-swagger' };
  }
  if (report.detected.hasBackendFramework || report.detected.hasNextApiRoutes || report.detected.backendDirsPresent.length > 0) {
    return { frontendOnly: false, reason: 'backend-detected' };
  }
  return { frontendOnly: false, reason: 'swagger-or-proto-present' };
}

export async function scanArchetype(options: ArchetypeScanOptions): Promise<ArchetypeReport> {
  const { projectRoot } = options;
  const { exists: hasPackageJson, deps } = await readPackageJsonDeps(projectRoot);
  const backendFrameworks = await detectBackendFrameworks(deps);
  const hasNext = Object.prototype.hasOwnProperty.call(deps, 'next');
  const hasNextApiRoutes = await detectNextApiRoutes(projectRoot, hasNext);
  const backendDirsPresent = await detectBackendDirs(projectRoot);
  const swaggerPaths = await detectSwagger(projectRoot);
  const monorepoConfigs = await detectMonorepoConfigs(projectRoot);
  const srcFileCount = await countSrcFiles(projectRoot);
  const ageDays = await lockfileAgeDays(projectRoot);

  const detected: ArchetypeReport['detected'] = {
    hasPackageJson,
    hasBackendFramework: backendFrameworks.length > 0,
    backendFrameworks,
    hasSwaggerOrProto: swaggerPaths.length > 0,
    swaggerPaths,
    hasMonorepoConfig: monorepoConfigs.length > 0,
    monorepoConfigs,
    hasNextApiRoutes,
    srcFileCount,
    backendDirsPresent,
    lockfileAgeDays: ageDays
  };

  const { archetype, confidence, signals } = decideArchetype(detected);
  const base: Omit<ArchetypeReport, 'frontendOnly' | 'frontendOnlyReason'> = { archetype, confidence, signals, detected };
  const { frontendOnly, reason } = decideFrontendOnly(base);

  return { ...base, frontendOnly, frontendOnlyReason: reason };
}
