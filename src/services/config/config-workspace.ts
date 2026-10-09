/**
 * Workspace registry: the raw `workspaces` / `currentWorkspace` fields and the artifact marker.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { stablePath } from '../../shared/path-utils.js';
import {
  getUserConfigPath,
  isInsidePath,
  resolveProjectRootForConfig,
  validateArtifactWorkspaceMarkerPath,
  validateArtifactWorkspaceRoot,
  validateProjectBootstrapConfigPathForWrite,
  validateUserConfigPathForWrite,
  writeConfigFileSafely,
  writeProjectConfigFile,
  writeUserConfigFile
} from './config-safety.js';
import { toWorkspaceConfigs } from './config-coercion.js';
import { ensureDir, getProjectWriteTarget, readJsonFile } from './config-file-io.js';
import { getConfig } from './config-get.js';
import { isRecord, isSafeConfigSegment } from './config-primitives.js';
import type { ConfigLayer, WorkspaceConfig } from './config-types.js';

interface RawWorkspaceData {
  currentWorkspace: string | null;
  workspaces: WorkspaceConfig[];
}

function readRawWorkspaceData(layer: ConfigLayer): RawWorkspaceData {
  const config = getConfig({ layer });
  return isRecord(config)
    ? {
        currentWorkspace:
          typeof config.currentWorkspace === 'string' ? config.currentWorkspace : null,
        workspaces: toWorkspaceConfigs(config.workspaces)
      }
    : { currentWorkspace: null, workspaces: [] };
}

function writeRawWorkspaceData(data: Partial<RawWorkspaceData>, layer: ConfigLayer): void {
  const projectTarget = layer === 'project' ? getProjectWriteTarget() : null;
  const targetPath = projectTarget?.configPath ?? getUserConfigPath();
  ensureDir(dirname(targetPath));
  const existing = projectTarget
    ? (readJsonFile(targetPath, () =>
        validateProjectBootstrapConfigPathForWrite(projectTarget.projectRoot, targetPath)
      ) ?? {})
    : (readJsonFile(targetPath, () => validateUserConfigPathForWrite(targetPath)) ?? {});
  const merged = { ...existing, ...data };
  const content = JSON.stringify(merged, null, 2);
  if (projectTarget) {
    writeProjectConfigFile(projectTarget.projectRoot, targetPath, content);
  } else {
    writeUserConfigFile(targetPath, content);
  }
}

function readAllWorkspaces(): { currentWorkspace: string | null; workspaces: WorkspaceConfig[] } {
  const userData = readRawWorkspaceData('user');
  const projectData = readRawWorkspaceData('project');
  const mergedWorkspaces = new Map<string, WorkspaceConfig>();
  for (const w of userData.workspaces) mergedWorkspaces.set(w.workspaceId, w);
  for (const w of projectData.workspaces) mergedWorkspaces.set(w.workspaceId, w);
  return {
    currentWorkspace: projectData.currentWorkspace ?? userData.currentWorkspace,
    workspaces: [...mergedWorkspaces.values()]
  };
}

export function getWorkspaceConfig(
  workspaceId: string,
  _projectRoot?: string | null
): WorkspaceConfig | null {
  // Accepted for signature stability: the registry spans the user and project
  // layers, so the id alone identifies the workspace.
  void _projectRoot;
  const { workspaces } = readAllWorkspaces();
  return workspaces.find((w) => w.workspaceId === workspaceId) ?? null;
}

function readLayerConfig(layer: ConfigLayer): {
  currentWorkspace: string | null;
  workspaces: WorkspaceConfig[];
} {
  return readRawWorkspaceData(layer);
}

export function addWorkspace(workspace: WorkspaceConfig, layer: ConfigLayer = 'user'): void {
  if (!isSafeConfigSegment(workspace.workspaceId)) {
    throw new Error(
      'Workspace id must only contain letters, numbers, dots, underscores, or hyphens and must not contain path traversal'
    );
  }
  const config = readRawWorkspaceData(layer);
  const workspaces = config.workspaces;
  const existing = workspaces.findIndex((w) => w.workspaceId === workspace.workspaceId);
  const updatedWorkspaces =
    existing >= 0
      ? workspaces.map((existingWorkspace) =>
          existingWorkspace.workspaceId === workspace.workspaceId ? workspace : existingWorkspace
        )
      : [...workspaces, workspace];
  writeRawWorkspaceData({ workspaces: updatedWorkspaces }, layer);
}

export function removeWorkspace(workspaceId: string, layer: ConfigLayer = 'user'): boolean {
  if (!isSafeConfigSegment(workspaceId)) return false;
  const config = readRawWorkspaceData(layer);
  const workspaces = config.workspaces;
  const idx = workspaces.findIndex((w) => w.workspaceId === workspaceId);
  if (idx < 0) return false;

  const updatedWorkspaces = workspaces.filter((w) => w.workspaceId !== workspaceId);
  const currentWorkspace =
    config.currentWorkspace === workspaceId
      ? (updatedWorkspaces[0]?.workspaceId ?? null)
      : (config.currentWorkspace ?? null);

  writeRawWorkspaceData({ workspaces: updatedWorkspaces, currentWorkspace }, layer);
  return true;
}

export function setCurrentWorkspace(workspaceId: string, layer: ConfigLayer = 'user'): boolean {
  if (!isSafeConfigSegment(workspaceId)) return false;
  const config = readRawWorkspaceData(layer);
  const workspaces = config.workspaces;
  const exists = workspaces.some((w) => w.workspaceId === workspaceId);
  if (!exists) return false;

  writeRawWorkspaceData({ currentWorkspace: workspaceId }, layer);
  return true;
}

export function getCurrentWorkspaceConfig(): WorkspaceConfig | null {
  const { currentWorkspace, workspaces } = readAllWorkspaces();
  if (!currentWorkspace) return null;
  return workspaces.find((w) => w.workspaceId === currentWorkspace) ?? null;
}

export function getWorkspaceConfigForPath(path = process.cwd()): WorkspaceConfig | null {
  const { workspaces } = readAllWorkspaces();
  return findWorkspaceForPath(workspaces, path);
}

function findWorkspaceForPath(workspaces: WorkspaceConfig[], path: string): WorkspaceConfig | null {
  const targetPath = stablePath(path);
  const matches = workspaces.flatMap((workspace) => {
    if (!isAbsolute(workspace.rootPath) || !existsSync(workspace.rootPath)) return [];
    const rootPath = stablePath(workspace.rootPath);
    return isInsidePath(targetPath, rootPath) ? [{ workspace, rootPath }] : [];
  });
  if (matches.length === 0) return null;

  return matches.reduce((best, match) =>
    match.rootPath.length > best.rootPath.length ? match : best
  ).workspace;
}

function getWorkspaceArtifactRoot(workspace: WorkspaceConfig): string {
  return workspace.artifactStorage?.localPath
    ? resolve(workspace.artifactStorage.localPath)
    : resolve(workspace.rootPath, '.peaks', 'artifacts');
}

function ensureArtifactWorkspaceMarker(workspace: WorkspaceConfig): void {
  const artifactRoot = getWorkspaceArtifactRoot(workspace);
  const peaksPath = resolve(artifactRoot, '.peaks');
  const markerPath = resolve(peaksPath, 'config.json');
  ensureDir(artifactRoot);
  validateArtifactWorkspaceRoot(artifactRoot, workspace.rootPath);

  ensureDir(peaksPath);
  validateArtifactWorkspaceMarkerPath(artifactRoot, peaksPath, markerPath);
  if (!existsSync(markerPath)) {
    writeConfigFileSafely(
      markerPath,
      '{}\n',
      () => validateArtifactWorkspaceMarkerPath(artifactRoot, peaksPath, markerPath),
      'Artifact workspace marker must stay inside the artifact workspace'
    );
  }
}

export function ensureWorkspaceConfigForPath(path = process.cwd()): WorkspaceConfig | null {
  const projectRoot = resolveProjectRootForConfig(path);
  if (!isAbsolute(projectRoot) || !existsSync(projectRoot)) return null;

  const config = readLayerConfig('user');
  const existingWorkspace = findWorkspaceForPath(config.workspaces, path);
  if (existingWorkspace) {
    ensureArtifactWorkspaceMarker(existingWorkspace);
    return existingWorkspace;
  }

  return null;
}

export function getWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return getWorkspaceConfigForPath(process.cwd());
}

export function ensureWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return ensureWorkspaceConfigForPath(process.cwd());
}
