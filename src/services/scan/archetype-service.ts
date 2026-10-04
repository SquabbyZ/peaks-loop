import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory } from 'peaks-loop-shared/fs';

import type {
  ArchetypeReport,
  ArchetypeSignal,
  IntegrationMode,
  ProjectArchetype
} from './scan-types.js';
import {
  detectBackendDirs,
  detectBackendFrameworks,
  detectMonorepoConfigs,
  detectNestedServiceEvidence,
  detectNextApiRoutes,
  detectNextServerActions,
  detectSwagger,
  GREENFIELD_MAX_SRC_FILES,
  GREENFIELD_MAX_LOCKFILE_DAYS,
  HIGH_CONFIDENCE_SIGNAL_COUNT,
  LEGACY_MIN_SRC_FILES,
  lockfileAgeDays,
  LOCKFILE_STALE_DAYS,
  readPackageJsonDeps
} from './archetype-detection.js';

export type ArchetypeScanOptions = {
  projectRoot: string;
};

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

/**
 * THE backend predicate — one answer, three callers.
 *
 * `decideArchetype`, `decideFrontendOnly` and `decideIntegrationMode` each
 * spelled the same triple out inline, so a signal added for one of them left
 * the other two reading a different project. The report then contradicted
 * itself, which is the failure `54ba0cc4` ("one answer for where frontendOnly
 * lives") was meant to end but did not. Anything that asks "does this repo
 * have a backend?" asks here.
 */
function hasBackendEvidence(detected: ArchetypeReport['detected']): boolean {
  return (
    detected.hasBackendFramework ||
    detected.hasNextApiRoutes ||
    detected.hasNextServerActions ||
    detected.backendDirsPresent.length > 0 ||
    detected.nestedServiceEvidence.length > 0
  );
}

function decideArchetype(detected: ArchetypeReport['detected']): {
  archetype: ProjectArchetype;
  confidence: 'high' | 'medium' | 'low';
  signals: ArchetypeSignal[];
} {
  const signals: ArchetypeSignal[] = [];

  const hasBackend = hasBackendEvidence(detected);
  signals.push({
    name: 'backend-presence',
    matched: hasBackend,
    detail: hasBackend
      ? [
          detected.backendFrameworks.length > 0
            ? `framework: ${detected.backendFrameworks.join(', ')}`
            : null,
          detected.hasNextApiRoutes ? 'next-api-routes' : null,
          detected.hasNextServerActions ? 'next-server-actions' : null,
          detected.backendDirsPresent.length > 0
            ? `dirs: ${detected.backendDirsPresent.join(', ')}`
            : null,
          detected.nestedServiceEvidence.length > 0
            ? `nested: ${detected.nestedServiceEvidence.join(', ')}`
            : null
        ]
          .filter(Boolean)
          .join('; ')
      : 'no backend framework, no next API routes, no backend dirs'
  });

  signals.push({
    name: 'swagger-or-proto',
    matched: detected.hasSwaggerOrProto,
    detail: detected.hasSwaggerOrProto
      ? detected.swaggerPaths.join(', ')
      : 'no swagger/openapi/proto'
  });

  signals.push({
    name: 'monorepo-config',
    matched: detected.hasMonorepoConfig,
    detail: detected.hasMonorepoConfig ? detected.monorepoConfigs.join(', ') : 'no monorepo config'
  });

  signals.push({
    name: 'src-size',
    matched: detected.srcFileCount >= GREENFIELD_MAX_SRC_FILES,
    detail: `${detected.srcFileCount} source files in src/`
  });

  signals.push({
    name: 'lockfile-age',
    matched: detected.lockfileAgeDays !== null && detected.lockfileAgeDays > LOCKFILE_STALE_DAYS,
    detail: detected.lockfileAgeDays === null ? 'no lockfile' : `${detected.lockfileAgeDays} days`
  });

  if (!detected.hasPackageJson) {
    return { archetype: 'unknown', confidence: 'low', signals };
  }

  // Monorepo detection runs BEFORE the backend check: a monorepo with
  // a packages/server dir is a fullstack-monorepo, NOT legacy-fullstack.
  // Slice 2026-07-15 ice-cola hot-fix: previously a monorepo with a
  // backend sub-package fell through to `legacy-fullstack` because
  // `hasBackend` includes `backendDirsPresent.length > 0`, which the
  // L199 guard above couldn't handle. We now treat `hasMonorepoConfig`
  // as a top-level classifier: any monorepo with a backend sub-package
  // is `fullstack-monorepo`; without a backend it is `frontend-monorepo`.
  if (detected.hasMonorepoConfig) {
    return {
      archetype: hasBackend ? 'fullstack-monorepo' : 'frontend-monorepo',
      confidence: 'high',
      signals
    };
  }

  if (hasBackend && detected.srcFileCount >= LEGACY_MIN_SRC_FILES) {
    return { archetype: 'legacy-fullstack', confidence: 'high', signals };
  }

  const greenfieldSignals = [
    detected.srcFileCount < GREENFIELD_MAX_SRC_FILES,
    detected.lockfileAgeDays === null || detected.lockfileAgeDays <= GREENFIELD_MAX_LOCKFILE_DAYS,
    !detected.hasSwaggerOrProto
  ];
  const greenfieldSignalCount = greenfieldSignals.filter(Boolean).length;
  // Greenfield must show both a small src AND a fresh/missing lockfile — otherwise an empty-src legacy stub still looks like greenfield.
  if (!hasBackend && greenfieldSignals[0] === true && greenfieldSignals[1] === true) {
    return {
      archetype: 'greenfield',
      confidence: greenfieldSignalCount === HIGH_CONFIDENCE_SIGNAL_COUNT ? 'high' : 'medium',
      signals
    };
  }

  const legacySignalCount = [
    !hasBackend,
    !detected.hasSwaggerOrProto,
    (detected.lockfileAgeDays !== null && detected.lockfileAgeDays > LOCKFILE_STALE_DAYS) ||
      detected.srcFileCount >= LEGACY_MIN_SRC_FILES
  ].filter(Boolean).length;

  if (!hasBackend && legacySignalCount >= 2) {
    return {
      archetype: 'legacy-frontend',
      confidence: legacySignalCount === HIGH_CONFIDENCE_SIGNAL_COUNT ? 'high' : 'medium',
      signals
    };
  }

  if (hasBackend) {
    return { archetype: 'legacy-fullstack', confidence: 'medium', signals };
  }

  return { archetype: 'unknown', confidence: 'low', signals };
}

/** The report before the derived mode fields are attached to it. */
type ArchetypeFacts = Omit<
  ArchetypeReport,
  'frontendOnly' | 'frontendOnlyReason' | 'integrationMode' | 'integrationModeReason'
>;

function decideFrontendOnly(report: ArchetypeFacts): {
  frontendOnly: boolean;
  reason: string;
} {
  if (report.archetype === 'legacy-frontend' || report.archetype === 'frontend-monorepo') {
    return { frontendOnly: true, reason: `archetype=${report.archetype}` };
  }
  const noBackend = !hasBackendEvidence(report.detected);
  if (noBackend && !report.detected.hasSwaggerOrProto) {
    return { frontendOnly: true, reason: 'no-backend-no-swagger' };
  }
  if (noBackend) {
    return { frontendOnly: false, reason: 'swagger-or-proto-present' };
  }
  return { frontendOnly: false, reason: 'backend-detected' };
}

/**
 * Three frontend integration scenarios, from the signals `detected`
 * already holds. Backend presence is the SAME predicate `decideArchetype`
 * uses (`hasBackendEvidence`), because one report cannot be
 * `legacy-fullstack` and `prd-only` at once — a Next project with server
 * actions, or an express service under `apps/`, is a backend for both.
 */
function decideIntegrationMode(report: ArchetypeFacts): {
  integrationMode: IntegrationMode;
  reason: string;
} {
  if (hasBackendEvidence(report.detected)) {
    return { integrationMode: 'full-stack', reason: 'backend-detected' };
  }
  if (report.detected.hasSwaggerOrProto) {
    return { integrationMode: 'prd-plus-interface-doc', reason: 'interface-doc-present' };
  }
  return { integrationMode: 'prd-only', reason: 'no-backend-no-interface-doc' };
}

export async function scanArchetype(options: ArchetypeScanOptions): Promise<ArchetypeReport> {
  const { projectRoot } = options;
  const { exists: hasPackageJson, deps } = await readPackageJsonDeps(projectRoot);
  const backendFrameworks = await detectBackendFrameworks(deps);
  const hasNext = Object.prototype.hasOwnProperty.call(deps, 'next');
  const hasNextApiRoutes = await detectNextApiRoutes(projectRoot, hasNext);
  const backendDirsPresent = await detectBackendDirs(projectRoot);
  const nestedServiceEvidence = await detectNestedServiceEvidence(projectRoot);
  const hasNextServerActions = hasNext ? await detectNextServerActions(projectRoot) : false;
  const swaggerPaths = await detectSwagger(projectRoot);
  const monorepoConfigs = await detectMonorepoConfigs(projectRoot);
  const srcFileCount = await countSrcFiles(projectRoot);
  const ageDays = await lockfileAgeDays(projectRoot);

  const detected: ArchetypeReport['detected'] = {
    hasPackageJson,
    hasBackendFramework: backendFrameworks.length > 0,
    backendFrameworks,
    nestedServiceEvidence,
    hasNextServerActions,
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
  const base: ArchetypeFacts = { archetype, confidence, signals, detected };
  const { frontendOnly, reason } = decideFrontendOnly(base);
  const { integrationMode, reason: integrationReason } = decideIntegrationMode(base);

  return {
    ...base,
    frontendOnly,
    frontendOnlyReason: reason,
    integrationMode,
    integrationModeReason: integrationReason
  };
}
