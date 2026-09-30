import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { stablePath } from '../../shared/path-utils.js';
import type { WorkspaceConfig } from '../config/config-types.js';

export type SyncStatus = 'synced' | 'pending' | 'out-of-sync' | 'unknown';

export type ArtifactWorkspaceStatus = {
  workspaceId: string;
  localPath: string;
  configured: boolean;
  syncStatus: SyncStatus;
  lastSync: string | null;
  hasLocalChanges: boolean;
  artifactRepo: WorkspaceConfig['artifactRepo'] | null;
  nextActions: string[];
};

export type SyncResult = {
  workspaceId: string;
  success: boolean;
  localPath: string;
  remoteUrl: string | null;
  commands: string[];
  output: string[];
  error?: string;
};

export function canonicalPath(path: string): string {
  return stablePath(path);
}

export function canonicalChildPath(parentPath: string, ...segments: string[]): string {
  return stablePath(resolve(parentPath, ...segments));
}

export function getLocalArtifactPath(workspace: WorkspaceConfig): string {
  if (workspace.artifactStorage?.localPath) {
    return resolve(workspace.artifactStorage.localPath);
  }
  return resolve(workspace.rootPath, '.peaks', 'artifacts');
}

export function getArtifactRemoteRepo(
  workspace: WorkspaceConfig
): WorkspaceConfig['artifactRepo'] | null {
  if (workspace.artifactStorage?.mode === 'local-with-remote-sync') {
    return workspace.artifactStorage.remote;
  }
  if (workspace.artifactStorage?.mode === 'local') {
    return null;
  }
  return workspace.artifactRepo ?? null;
}

export function getPublicRemoteUrl(
  artifactRepo: WorkspaceConfig['artifactRepo'] | null
): string | null {
  if (!artifactRepo) return null;
  return artifactRepo.provider === 'github'
    ? `https://github.com/${artifactRepo.owner}/${artifactRepo.name}.git`
    : `https://gitlab.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
}

export function getGitAuthEnv(
  artifactRepo: WorkspaceConfig['artifactRepo'] | null
): NodeJS.ProcessEnv | undefined {
  if (!artifactRepo || artifactRepo.provider !== 'github') return undefined;

  const token = process.env.GH_TOKEN;
  if (!token) return undefined;

  const authValue = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authValue}`
  };
}

export function redactSecrets(message: string): string {
  const token = process.env.GH_TOKEN;
  const urlRedacted = message.replace(
    /https:\/\/x-access-token:[^@]+@/g,
    'https://x-access-token:***@'
  );
  const headerRedacted = urlRedacted.replace(
    /AUTHORIZATION:\s*basic\s+[A-Za-z0-9+/=]+/gi,
    'AUTHORIZATION: basic ***'
  );

  if (!token) return headerRedacted;

  const encoded = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');
  return headerRedacted.replaceAll(token, '***').replaceAll(encoded, '***');
}
