import { beforeEach, describe, expect, test, vi } from 'vitest';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';

let currentWorkspace: WorkspaceConfig | null = null;
let localDirExists = false;
type ExecCall = { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv };
let execCalls: ExecCall[] = [];

vi.mock('../../src/services/config/config-service.js', () => ({
  getCurrentWorkspaceConfig: () => currentWorkspace,
  readConfig: () => ({ workspaces: currentWorkspace ? [currentWorkspace] : [] })
}));

vi.mock('../../src/shared/fs.js', () => ({
  pathExists: () => Promise.resolve(localDirExists)
}));

vi.mock('../../src/shared/process.js', () => ({
  execCommand: async (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    const call: ExecCall = { command, args };
    if (options?.cwd) call.cwd = options.cwd;
    if (options?.env) call.env = options.env;
    execCalls.push(call);
    return 'ok';
  }
}));

const { executeArtifactSync } = await import('../../src/services/artifacts/workspace-service.js');

describe('executeArtifactSync git auth', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    localDirExists = false;
    execCalls = [];
    currentWorkspace = {
      workspaceId: 'ws-auth',
      name: 'Auth Workspace',
      rootPath: join(tmpdir(), `peaks-auth-${Date.now()}`),
      artifactRepo: { provider: 'github', owner: 'acme', name: 'artifact-repo' },
      installedCapabilityIds: []
    };
  });

  test('uses public clone URL and passes GitHub auth separately', async () => {
    vi.stubEnv('GH_TOKEN', 'secret-token');

    const result = await executeArtifactSync();

    expect(result.success).toBe(true);
    expect(result.remoteUrl).toBe('https://github.com/acme/artifact-repo.git');
    expect(result.commands.join('\n')).not.toContain('secret-token');
    expect(execCalls[0]).toMatchObject({
      command: 'git',
      args: ['clone', 'https://github.com/acme/artifact-repo.git', join(dirname((currentWorkspace as WorkspaceConfig).rootPath), `${basename((currentWorkspace as WorkspaceConfig).rootPath)}.peaks-artifacts`)]
    });
    expect(execCalls[0]?.env?.GIT_CONFIG_COUNT).toBe('1');
    expect(execCalls[0]?.env?.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(execCalls[0]?.env?.GIT_CONFIG_VALUE_0).toContain('AUTHORIZATION: basic ');
    expect(execCalls[0]?.env?.GIT_CONFIG_VALUE_0).not.toContain('secret-token');
  });
});
