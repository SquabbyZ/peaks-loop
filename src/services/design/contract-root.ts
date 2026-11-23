/**
 * Resolve the design contract root for a repository.
 *
 * The contract follows the frontend app root, not the repository root. A
 * candidate is the repository root, any immediate subdirectory with a
 * `package.json`, and any directory under `apps/` or `packages/` with a
 * `package.json`; it qualifies only when `scanArchetype` observes frontend
 * evidence for it. One qualifying candidate wins, more than one without an
 * explicit `appPath` is ambiguous, and none is not a frontend project.
 */
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { isDirectory, pathExists } from 'peaks-loop-shared/fs';

import { normalizePath } from '../../shared/path-utils.js';
import { scanArchetype } from '../scan/archetype-service.js';
import type { ContractRoot, ContractRootResult } from './design-types.js';

export type ResolveContractRootInput = {
  projectRoot: string;
  /** Repository-relative path of the app to target, e.g. `apps/web`. */
  appPath?: string;
};

/** Installed and generated trees never hold the project's own frontend app. */
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage']);

/** Workspace containers whose children are apps in their own right. */
const WORKSPACE_DIR_NAMES = ['apps', 'packages'] as const;

function appRelPath(projectRoot: string, appRoot: string): string {
  return normalizePath(relative(projectRoot, appRoot));
}

/** The repo-relative path an `appPath` names, or `null` when it escapes the root. */
function normalizeAppPath(raw: string): string | null {
  const segments = normalizePath(raw)
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.includes('..')) return null;
  return segments.join('/');
}

async function childDirectoryNames(dir: string): Promise<string[]> {
  if (!(await isDirectory(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function hasManifest(dir: string): Promise<boolean> {
  return pathExists(join(dir, 'package.json'));
}

async function discoverCandidates(projectRoot: string): Promise<string[]> {
  const candidates: string[] = [projectRoot];
  for (const name of await childDirectoryNames(projectRoot)) {
    const dir = join(projectRoot, name);
    if (await hasManifest(dir)) candidates.push(dir);
  }
  for (const workspace of WORKSPACE_DIR_NAMES) {
    const workspaceDir = join(projectRoot, workspace);
    for (const name of await childDirectoryNames(workspaceDir)) {
      const dir = join(workspaceDir, name);
      if (await hasManifest(dir)) candidates.push(dir);
    }
  }
  return [...new Set(candidates)];
}

async function hasFrontendEvidence(appRoot: string): Promise<boolean> {
  const report = await scanArchetype({ projectRoot: appRoot });
  return report.detected.frontendEvidence !== null || report.frontendOnly;
}

function success(projectRoot: string, appRoot: string): ContractRootResult {
  const root: ContractRoot = {
    appRoot,
    designRoot: join(appRoot, 'design'),
    appRelPath: appRelPath(projectRoot, appRoot)
  };
  return { ok: true, root };
}

export async function resolveContractRoot(
  input: ResolveContractRootInput
): Promise<ContractRootResult> {
  const { projectRoot } = input;
  const found: string[] = [];
  for (const candidate of await discoverCandidates(projectRoot)) {
    if (await hasFrontendEvidence(candidate)) found.push(candidate);
  }
  const foundRelPaths = found.map((appRoot) => appRelPath(projectRoot, appRoot)).sort();

  if (input.appPath !== undefined) {
    const requested = normalizeAppPath(input.appPath);
    const matched =
      requested === null
        ? undefined
        : found.find((appRoot) => appRelPath(projectRoot, appRoot) === requested);
    if (matched === undefined) {
      return {
        ok: false,
        code: 'DESIGN_APP_NOT_FOUND',
        message: `--app '${input.appPath}' does not name a frontend app root in this repository.`,
        candidates: foundRelPaths
      };
    }
    return success(projectRoot, matched);
  }

  if (found.length === 0) {
    return {
      ok: false,
      code: 'DESIGN_NOT_FRONTEND',
      message:
        'No frontend app root was found; the design contract applies to frontend projects only.'
    };
  }

  if (found.length > 1) {
    return {
      ok: false,
      code: 'DESIGN_APP_AMBIGUOUS',
      message: `More than one frontend app root was found (${foundRelPaths.join(', ')}); name one with --app.`,
      candidates: foundRelPaths
    };
  }

  const only = found[0];
  return success(projectRoot, only as string);
}
