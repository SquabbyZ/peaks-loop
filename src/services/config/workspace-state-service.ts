import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { WorkspaceConfig } from './config-types.js';
import { SIDECAR_SCHEMA_VERSION, ensureSidecarVersion, workspacesConfigPath, readSidecarJson, writeSidecarJson } from './sidecar-store.js';
import { stablePath } from '../../shared/path-utils.js';
import { isInsidePath } from './config-safety.js';

/**
 * Workspace state (registered workspaces + current-workspace pointer)
 * lives in `~/.peaks/workspaces.json` — NOT in the slim
 * `~/.peaks/config.json`. The slim config only carries `version` +
 * `ocr.llm.*`; the user's workspace bookmarks live here.
 *
 * This module is the only owner of workspaces.json. Back-compat reads
 * from `~/.peaks/config.json.workspaces` / `.currentWorkspace` are
 * tolerated for legacy configs (1.x); the next write promotes the
 * state into `~/.peaks/workspaces.json` and the legacy config.json
 * fields are stripped by `loadGlobalConfig` governance.
 */

type WorkspacesSidecar = {
  version: string;
  workspaces: WorkspaceConfig[];
  currentWorkspace: string | null;
};

const EMPTY_WORKSPACES: WorkspacesSidecar = {
  version: SIDECAR_SCHEMA_VERSION,
  workspaces: [],
  currentWorkspace: null
};

const UNSAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSafeSegment(value: string): boolean {
  return UNSAFE_SEGMENT_PATTERN.test(value) && !value.includes('..') && !value.endsWith('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeArtifactRemoteRepo(value: unknown): WorkspaceConfig['artifactRepo'] | null {
  if (!isRecord(value) || (value.provider !== 'github' && value.provider !== 'gitlab') || typeof value.owner !== 'string' || typeof value.name !== 'string') return null;
  if (!isSafeSegment(value.owner) || !isSafeSegment(value.name)) return null;
  return { provider: value.provider, owner: value.owner, name: value.name };
}

function sanitizeArtifactStorage(value: unknown): WorkspaceConfig['artifactStorage'] | null {
  if (!isRecord(value)) return null;
  const localPath = typeof value.localPath === 'string' ? { localPath: value.localPath } : {};
  if (value.mode === 'local') return { mode: 'local', ...localPath };
  const remote = sanitizeArtifactRemoteRepo(value.remote);
  if (value.mode === 'local-with-remote-sync' && remote) return { mode: 'local-with-remote-sync', ...localPath, remote };
  return null;
}

function sanitizeWorkspace(value: unknown): WorkspaceConfig | null {
  if (!isRecord(value)) return null;
  const { workspaceId, name, rootPath, installedCapabilityIds } = value;
  if (typeof workspaceId !== 'string' || !isSafeSegment(workspaceId) || typeof name !== 'string' || typeof rootPath !== 'string' || !Array.isArray(installedCapabilityIds) || !installedCapabilityIds.every((id) => typeof id === 'string')) return null;
  const artifactRepo = sanitizeArtifactRemoteRepo(value.artifactRepo);
  const artifactStorage = sanitizeArtifactStorage(value.artifactStorage);
  return {
    workspaceId,
    name,
    rootPath,
    installedCapabilityIds,
    ...(artifactRepo ? { artifactRepo } : {}),
    ...(artifactStorage ? { artifactStorage } : {})
  };
}

function sanitizeWorkspaces(value: unknown): WorkspaceConfig[] {
  return Array.isArray(value) ? value.map(sanitizeWorkspace).filter((w): w is WorkspaceConfig => w !== null) : [];
}

function loadWorkspacesSidecar(): WorkspacesSidecar {
  const raw = readSidecarJson<Partial<WorkspacesSidecar>>(workspacesConfigPath(), EMPTY_WORKSPACES);
  const version = ensureSidecarVersion(raw).version;
  const workspaces = sanitizeWorkspaces(raw.workspaces);
  const currentWorkspace = typeof raw.currentWorkspace === 'string' ? raw.currentWorkspace : null;
  return { version, workspaces, currentWorkspace };
}

function saveWorkspacesSidecar(data: WorkspacesSidecar): void {
  writeSidecarJson(workspacesConfigPath(), {
    ...data,
    version: SIDECAR_SCHEMA_VERSION
  });
}

export function getWorkspaces(): WorkspaceConfig[] {
  return loadWorkspacesSidecar().workspaces;
}

export function getCurrentWorkspace(): string | null {
  return loadWorkspacesSidecar().currentWorkspace;
}

export function setCurrentWorkspace(workspaceId: string | null): boolean {
  if (workspaceId !== null && !isSafeSegment(workspaceId)) return false;
  const data = loadWorkspacesSidecar();
  if (workspaceId !== null) {
    const exists = data.workspaces.some((w) => w.workspaceId === workspaceId);
    if (!exists) return false;
  }
  saveWorkspacesSidecar({ ...data, currentWorkspace: workspaceId });
  return true;
}

export function addWorkspace(workspace: WorkspaceConfig): void {
  if (!isSafeSegment(workspace.workspaceId)) {
    throw new Error('Workspace id must only contain letters, numbers, dots, underscores, or hyphens and must not contain path traversal');
  }
  const data = loadWorkspacesSidecar();
  const existingIndex = data.workspaces.findIndex((w) => w.workspaceId === workspace.workspaceId);
  const nextWorkspaces = existingIndex >= 0
    ? data.workspaces.map((w) => (w.workspaceId === workspace.workspaceId ? workspace : w))
    : [...data.workspaces, workspace];
  saveWorkspacesSidecar({ ...data, workspaces: nextWorkspaces });
}

export function removeWorkspace(workspaceId: string): boolean {
  if (!isSafeSegment(workspaceId)) return false;
  const data = loadWorkspacesSidecar();
  const idx = data.workspaces.findIndex((w) => w.workspaceId === workspaceId);
  if (idx < 0) return false;
  const nextWorkspaces = data.workspaces.filter((w) => w.workspaceId !== workspaceId);
  const nextCurrent = data.currentWorkspace === workspaceId ? nextWorkspaces[0]?.workspaceId ?? null : data.currentWorkspace;
  saveWorkspacesSidecar({ ...data, workspaces: nextWorkspaces, currentWorkspace: nextCurrent });
  return true;
}

export function getWorkspaceConfig(workspaceId: string): WorkspaceConfig | null {
  return getWorkspaces().find((w) => w.workspaceId === workspaceId) ?? null;
}

export function getCurrentWorkspaceConfig(): WorkspaceConfig | null {
  const data = loadWorkspacesSidecar();
  if (!data.currentWorkspace) return null;
  return data.workspaces.find((w) => w.workspaceId === data.currentWorkspace) ?? null;
}

function findWorkspaceForPath(workspaces: WorkspaceConfig[], path: string): WorkspaceConfig | null {
  const targetPath = stablePath(path);
  const matches = workspaces.flatMap((workspace) => {
    if (!isAbsolute(workspace.rootPath) || !existsSync(workspace.rootPath)) return [];
    const rootPath = stablePath(workspace.rootPath);
    return isInsidePath(targetPath, rootPath) ? [{ workspace, rootPath }] : [];
  });
  if (matches.length === 0) return null;
  return matches.reduce((best, match) => (match.rootPath.length > best.rootPath.length ? match : best)).workspace;
}

export function getWorkspaceConfigForPath(path: string): WorkspaceConfig | null {
  return findWorkspaceForPath(getWorkspaces(), path);
}

export function getWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return getWorkspaceConfigForPath(process.cwd());
}

export function ensureWorkspaceConfigForPath(path: string): WorkspaceConfig | null {
  return getWorkspaceConfigForPath(path);
}

export function ensureWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return ensureWorkspaceConfigForPath(process.cwd());
}

export type { WorkspacesSidecar };