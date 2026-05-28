import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import { isInsidePath, stablePath } from '../../shared/path-utils.js';
import { getWorkspaceConfig, getWorkspaceConfigForCurrentPath } from '../config/config-service.js';
import type { WorkspaceConfig } from '../config/config-types.js';
import { pathExists } from '../../shared/fs.js';
import { execCommand } from '../../shared/process.js';

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

function canonicalPath(path: string): string {
  return stablePath(path);
}

function canonicalChildPath(parentPath: string, ...segments: string[]): string {
  return stablePath(resolve(parentPath, ...segments));
}

export function getLocalArtifactPath(workspace: WorkspaceConfig): string {
  if (workspace.artifactStorage?.localPath) {
    return resolve(workspace.artifactStorage.localPath);
  }
  return resolve(workspace.rootPath, '.peaks', 'artifacts');
}

export function isArtifactWorkspaceOutsideTarget(_workspace: WorkspaceConfig, _artifactWorkspacePath?: string): boolean {
  return true;
}

export function hasValidArtifactWorkspace(workspace: WorkspaceConfig, artifactWorkspacePath = getLocalArtifactPath(workspace)): boolean {
  if (!isArtifactWorkspaceOutsideTarget(workspace, artifactWorkspacePath)) return false;

  const artifactRoot = canonicalPath(artifactWorkspacePath);
  const peaksRoot = canonicalChildPath(artifactWorkspacePath, '.peaks');
  const changesRoot = canonicalChildPath(artifactWorkspacePath, '.peaks', 'changes');
  const configPath = canonicalChildPath(artifactWorkspacePath, '.peaks', 'config.json');

  if (!existsSync(resolve(artifactWorkspacePath, '.peaks', 'config.json'))) return false;
  if (!isInsidePath(peaksRoot, artifactRoot)) return false;
  if (!isInsidePath(changesRoot, artifactRoot)) return false;
  if (!isInsidePath(configPath, artifactRoot)) return false;

  return true;
}

export function getArtifactRemoteRepo(workspace: WorkspaceConfig): WorkspaceConfig['artifactRepo'] | null {
  if (workspace.artifactStorage?.mode === 'local-with-remote-sync') {
    return workspace.artifactStorage.remote;
  }
  if (workspace.artifactStorage?.mode === 'local') {
    return null;
  }
  return workspace.artifactRepo ?? null;
}

function getPublicRemoteUrl(artifactRepo: WorkspaceConfig['artifactRepo'] | null): string | null {
  if (!artifactRepo) return null;
  return artifactRepo.provider === 'github'
    ? `https://github.com/${artifactRepo.owner}/${artifactRepo.name}.git`
    : `https://gitlab.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
}

function getGitAuthEnv(artifactRepo: WorkspaceConfig['artifactRepo'] | null): NodeJS.ProcessEnv | undefined {
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

function redactSecrets(message: string): string {
  const token = process.env.GH_TOKEN;
  const urlRedacted = message.replace(/https:\/\/x-access-token:[^@]+@/g, 'https://x-access-token:***@');
  const headerRedacted = urlRedacted.replace(/AUTHORIZATION:\s*basic\s+[A-Za-z0-9+/=]+/gi, 'AUTHORIZATION: basic ***');

  if (!token) return headerRedacted;

  const encoded = Buffer.from(`x-access-token:${token}`, 'utf-8').toString('base64');
  return headerRedacted.replaceAll(token, '***').replaceAll(encoded, '***');
}

export async function executeArtifactSync(workspaceId?: string): Promise<SyncResult> {
  const workspace = workspaceId
    ? getWorkspaceConfig(workspaceId)
    : getWorkspaceConfigForCurrentPath();

  if (!workspace) {
    return {
      workspaceId: workspaceId ?? 'unknown',
      success: false,
      localPath: '.peaks-artifacts',
      remoteUrl: null,
      commands: [],
      output: [],
      error: 'Workspace not found'
    };
  }

  const localPath = getLocalArtifactPath(workspace);
  if (!isArtifactWorkspaceOutsideTarget(workspace, localPath)) {
    return {
      workspaceId: workspace.workspaceId,
      success: false,
      localPath,
      remoteUrl: null,
      commands: [],
      output: [],
      error: 'Artifact workspace must be outside the target repository'
    };
  }

  const artifactRepo = getArtifactRemoteRepo(workspace);
  if (!artifactRepo) {
    return {
      workspaceId: workspace.workspaceId,
      success: true,
      localPath,
      remoteUrl: null,
      commands: [],
      output: ['Local artifact storage is configured']
    };
  }

  const remoteUrl = getPublicRemoteUrl(artifactRepo);
  const gitAuthEnv = getGitAuthEnv(artifactRepo);
  if (!remoteUrl) {
    return {
      workspaceId: workspace.workspaceId,
      success: false,
      localPath,
      remoteUrl: null,
      commands: [],
      output: [],
      error: 'Invalid artifact repository configuration'
    };
  }

  const commands: string[] = [];
  const output: string[] = [];

  const hasLocalDir = await pathExists(localPath);

  if (!hasLocalDir) {
    commands.push(`git clone ${remoteUrl} "${localPath}"`);
    try {
      await execCommand('git', ['clone', remoteUrl, localPath], { env: gitAuthEnv });
      output.push(`Cloned artifact repository to ${localPath}`);
    } catch (err) {
      return {
        workspaceId: workspace.workspaceId,
        success: false,
        localPath,
        remoteUrl,
        commands,
        output,
        error: `Clone failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`
      };
    }
  } else {
    commands.push(`cd "${localPath}" && git fetch origin`);
    commands.push(`cd "${localPath}" && git pull origin main`);

    try {
      await execCommand('git', ['fetch', 'origin'], { cwd: localPath, env: gitAuthEnv });
      output.push('Fetched latest from remote');

      await execCommand('git', ['pull', 'origin', 'main'], { cwd: localPath, env: gitAuthEnv });
      output.push('Pulled latest changes');
    } catch (err) {
      return {
        workspaceId: workspace.workspaceId,
        success: false,
        localPath,
        remoteUrl,
        commands,
        output,
        error: `Sync failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`
      };
    }
  }

  return {
    workspaceId: workspace.workspaceId,
    success: true,
    localPath,
    remoteUrl,
    commands,
    output
  };
}

export function getArtifactWorkspaceStatus(workspaceId?: string): ArtifactWorkspaceStatus {
  const workspace = workspaceId
    ? getWorkspaceConfig(workspaceId)
    : getWorkspaceConfigForCurrentPath();

  if (!workspace) {
    return {
      workspaceId: workspaceId ?? 'unknown',
      localPath: '.peaks-artifacts',
      configured: false,
      syncStatus: 'unknown',
      lastSync: null,
      hasLocalChanges: false,
      artifactRepo: null,
      nextActions: ['Add a workspace with: peaks config workspace add --id <id> --name <name> --path <path>']
    };
  }

  const localPath = getLocalArtifactPath(workspace);
  const hasLocalDir = existsSync(localPath);
  const artifactRepo = getArtifactRemoteRepo(workspace);
  const hasSafeBoundary = isArtifactWorkspaceOutsideTarget(workspace, localPath);

  const syncStatus: SyncStatus = !hasSafeBoundary
    ? 'unknown'
    : !hasLocalDir
    ? 'pending'
    : 'synced';

  return {
    workspaceId: workspace.workspaceId,
    localPath,
    configured: hasSafeBoundary,
    syncStatus,
    lastSync: null,
    hasLocalChanges: false,
    artifactRepo,
    nextActions: !hasSafeBoundary
      ? ['Configure artifact workspace outside the target repository.']
      : artifactRepo
      ? [`Run peaks artifacts sync --workspace ${workspace.workspaceId} --dry-run`]
      : [`Local artifact storage ready at ${localPath}`]
  };
}

export function planArtifactSync(workspaceId?: string, dryRun = true): {
  workspaceId: string;
  dryRun: boolean;
  localPath: string;
  remoteUrl: string | null;
  plannedCommands: string[];
} {
  const workspace = workspaceId
    ? getWorkspaceConfig(workspaceId)
    : getWorkspaceConfigForCurrentPath();

  if (!workspace) {
    return {
      workspaceId: workspaceId ?? 'unknown',
      dryRun,
      localPath: '.peaks-artifacts',
      remoteUrl: null,
      plannedCommands: ['No artifact repo configured — add one with peaks config workspace add --provider github --repo-owner <owner> --repo-name <name>']
    };
  }

  const localPath = getLocalArtifactPath(workspace);
  if (!isArtifactWorkspaceOutsideTarget(workspace, localPath)) {
    return {
      workspaceId: workspace.workspaceId,
      dryRun,
      localPath,
      remoteUrl: null,
      plannedCommands: ['Artifact workspace must be outside the target repository']
    };
  }

  const artifactRepo = getArtifactRemoteRepo(workspace);
  const remoteUrl = getPublicRemoteUrl(artifactRepo);

  const plannedCommands = artifactRepo
    ? dryRun
      ? [
          `# Sync plan for workspace ${workspace.workspaceId}`,
          `# Local: ${localPath}`,
          `# Remote: ${remoteUrl}`,
          '# peaks artifacts sync --workspace ' + workspace.workspaceId,
          '# (dry-run only — no changes made)'
        ]
      : [
          `# Sync execution for workspace ${workspace.workspaceId}`,
          `# Confirm: will sync ${localPath} with ${remoteUrl}`,
          '# Exit 1 if not confirmed'
        ]
    : [
        `# Local artifact storage for workspace ${workspace.workspaceId}`,
        `# Local: ${localPath}`,
        '# No remote repository is configured or required'
      ];

  return {
    workspaceId: workspace.workspaceId,
    dryRun,
    localPath,
    remoteUrl,
    plannedCommands
  };
}