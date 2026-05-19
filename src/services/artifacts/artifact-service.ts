import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { getCurrentWorkspaceConfig } from '../config/config-service.js';
import { getLocalArtifactPath } from './workspace-service.js';

export type ArtifactProvider = 'github' | 'gitlab';

export type ArtifactInitPlan = {
  provider: ArtifactProvider;
  name: string;
  visibility: 'private';
  localPath: string;
  remoteFirst: boolean;
  dryRun: boolean;
  plannedActions: string[];
  tokenPolicy: string;
};

export type GuidedArtifactSetup = {
  step: 'detect' | 'configure' | 'validate' | 'complete';
  workspaceId: string | null;
  workspacePath: string | null;
  provider: ArtifactProvider | null;
  repoOwner: string | null;
  repoName: string | null;
  localPath: string;
  remoteUrl: string | null;
  validationResult: {
    workspaceExists: boolean;
    gitAvailable: boolean;
    ghTokenAvailable: boolean;
    sshKeyAvailable: boolean;
  };
  nextStep: string;
  guidance: string[];
};

function getRemoteUrl(artifactRepo: { provider: ArtifactProvider; owner: string; name: string } | undefined): string | null {
  if (!artifactRepo) return null;
  if (artifactRepo.provider === 'github') {
    return `https://github.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
  }
  return `https://gitlab.com/${artifactRepo.owner}/${artifactRepo.name}.git`;
}

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function hasSshKey(): boolean {
  const sshDir = resolve(process.env.HOME ?? homedir(), '.ssh');
  const keyNames = ['id_ed25519', 'id_rsa', 'id_ecdsa', 'id_dsa'];
  return keyNames.some((keyName) => existsSync(resolve(sshDir, keyName)));
}

export function createArtifactInitPlan(options: {
  provider: ArtifactProvider;
  name: string;
  localPath?: string;
  dryRun?: boolean;
}): ArtifactInitPlan {
  return {
    provider: options.provider,
    name: options.name,
    visibility: 'private',
    localPath: options.localPath ?? '.peaks-artifacts',
    remoteFirst: true,
    dryRun: options.dryRun ?? true,
    plannedActions: [
      `confirm creation of private ${options.provider} artifact repository`,
      'verify authentication without storing tokens',
      `create or link remote artifact repository ${options.name}`,
      `prepare local working copy at ${options.localPath ?? '.peaks-artifacts'}`,
      'write artifact repository creation report'
    ],
    tokenPolicy: 'Use provider auth/CLI or environment tokens only; never write tokens to skills, artifacts, config, or reports.'
  };
}

export function createGuidedArtifactSetup(): GuidedArtifactSetup {
  const workspace = getCurrentWorkspaceConfig();
  const artifactRepo = workspace?.artifactRepo ?? null;
  const validationResult = {
    workspaceExists: workspace !== null,
    gitAvailable: hasGit(),
    ghTokenAvailable: Boolean(process.env.GH_TOKEN?.trim()),
    sshKeyAvailable: hasSshKey()
  };

  const localPath = workspace ? getLocalArtifactPath(workspace) : '.peaks-artifacts';
  const remoteUrl = getRemoteUrl(artifactRepo ?? undefined);

  return {
    step: 'detect',
    workspaceId: workspace?.workspaceId ?? null,
    workspacePath: workspace?.rootPath ?? null,
    provider: artifactRepo?.provider ?? null,
    repoOwner: artifactRepo?.owner ?? null,
    repoName: artifactRepo?.name ?? null,
    localPath,
    remoteUrl,
    validationResult,
    nextStep: workspace ? (artifactRepo ? 'validate' : 'configure') : 'configure',
    guidance: [
      'Step 1: Detect current workspace and environment',
      `  - Workspace: ${workspace?.workspaceId ?? 'not configured'}`,
      `  - Git available: ${validationResult.gitAvailable ? 'yes' : 'no'}`,
      `  - GH_TOKEN environment variable: ${validationResult.ghTokenAvailable ? 'available' : 'not set'}`,
      `  - SSH key for code push: ${validationResult.sshKeyAvailable ? 'available' : 'not found'}`,
      '',
      'Step 2: Configure artifact repository',
      '  - Run: peaks artifacts init --provider github --name <repo> --dry-run',
      '  - Or add to workspace: peaks config workspace add --id <id> --provider github --repo-owner <owner> --repo-name <name>',
      '',
      'Step 3: Validate setup',
      '  - Run: peaks sc status',
      '  - Run: peaks artifacts workspace',
      '',
      'Step 4: Complete',
      '  - Artifact sync is ready when workspace has artifactRepo configured'
    ]
  };
}

export function getArtifactStatus() {
  return {
    mode: 'remote-first',
    supportedProviders: ['github', 'gitlab'] as ArtifactProvider[],
    localPath: '.peaks-artifacts',
    configured: false,
    nextActions: ['Run peaks artifacts init --provider gitlab --name <repo> --dry-run']
  };
}
