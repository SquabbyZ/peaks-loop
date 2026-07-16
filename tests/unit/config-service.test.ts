import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

function canCreateFileSymlink(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'peaks-symlink-check-'));
  try {
    const target = join(root, 'target.txt');
    const link = join(root, 'link.txt');
    writeFileSync(target, 'target', 'utf8');
    symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fileSymlinkTest = canCreateFileSymlink() ? test : test.skip;

const configTestHome = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return mkdtempSync(join(tmpdir(), 'peaks-config-home-'));
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => configTestHome };
});

import { addWorkspace, bootstrapProjectLanguageConfig, containsSensitiveConfigValue, ensureWorkspaceConfigForPath, getConfig, getWorkspaceConfigForPath, isConfigLayer, isSensitiveConfigPath, readConfig, redactConfigSecrets, removeWorkspace, resolveProjectRootForConfig, setConfig, setCurrentWorkspace, writeConfig } from '../../src/services/config/config-service.js';

// Test helper path parsing logic directly
// The actual config service uses these functions internally

describe('path parsing utilities', () => {
  test('parses dot notation paths correctly', () => {
    const obj = { a: { b: { c: 1 } }, d: 2 };
    // Simulate getNestedValue logic
    const path = 'a.b.c';
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    expect(parts).toEqual(['a', 'b', 'c']);
  });

  test('parses array index notation', () => {
    const path = 'workspaces[0].workspaceId';
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    expect(parts).toEqual(['workspaces', '0', 'workspaceId']);
  });

  test('handles empty path parts', () => {
    const path = 'a..b';
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    expect(parts).toEqual(['a', 'b']);
  });
});

describe('nested value operations', () => {
  test('getNestedValue returns deep nested value', () => {
    const obj = { a: { b: { c: 42 } } };
    const parts = 'a.b.c'.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    expect(current).toBe(42);
  });

  test('getNestedValue returns undefined for non-existent path', () => {
    const obj = { a: { b: 1 } };
    const parts = 'a.c'.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[part];
    }
    expect(current).toBeUndefined();
  });

  test('setNestedValue sets deep nested value', () => {
    const obj: Record<string, unknown> = {};
    const parts = 'a.b.c'.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    current[last] = 42;

    expect((obj as { a: { b: { c: number } } }).a.b.c).toBe(42);
  });

  test('setNestedValue creates intermediate objects', () => {
    const obj: Record<string, unknown> = {};
    const parts = 'x.y.z'.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i] as string;
      if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    current[last] = 'value';

    expect((obj as { x: { y: { z: string } } }).x.y.z).toBe('value');
  });
});

describe('secret config handling', () => {
  test('identifies config layers and sensitive config paths', () => {
    expect(isConfigLayer('user')).toBe(true);
    expect(isConfigLayer('project')).toBe(true);
    expect(isConfigLayer('other')).toBe(false);
    expect(isSensitiveConfigPath('providers.anthropic.apiKey')).toBe(true);
    expect(isSensitiveConfigPath('tokens.GitHubToken')).toBe(true);
    expect(isSensitiveConfigPath('providers.anthropic.baseUrl')).toBe(false);
  });

  test('detects nested sensitive config values', () => {
    expect(containsSensitiveConfigValue({ anthropic: { apiKey: 'secret' } })).toBe(true);
    expect(containsSensitiveConfigValue([{ token: 'secret' }])).toBe(true);
    expect(containsSensitiveConfigValue({ anthropic: { baseUrl: 'https://api.example.com/anthropic' } })).toBe(false);
  });

  test('redacts nested secret values without mutating the input', () => {
    const config = {
      providers: {
        anthropic: {
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: { value: 'plain-secret' },
          emptyToken: ''
        },
        customProvider: {
          baseUrl: 'https://user:pass@example.com/anthropic?token=secret#key=secret'
        }
      },
      list: [{ token: ['token-secret'] }]
    };

    const redacted = redactConfigSecrets(config);
    const redactedConfig = redacted as { providers: { anthropic: { baseUrl: string; apiKey: string; emptyToken: string }; customProvider: { baseUrl: string } }; list: { token: string }[] };

    expect(redactedConfig.providers.anthropic.baseUrl).toBe('https://api.example.com/anthropic');
    expect(redactedConfig.providers.anthropic.apiKey).toBe('***');
    expect(redactedConfig.providers.anthropic.emptyToken).toBe('***');
    expect(redactedConfig.providers.customProvider.baseUrl).toBe('https://example.com/anthropic');
    expect(redactedConfig.list[0]?.token).toBe('***');
    expect(config.providers.anthropic.apiKey.value).toBe('plain-secret');
  });

  test('rejects insecure provider base URLs through all config write paths', () => {
    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'http://api.example.com/anthropic' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.anthropic', value: { baseUrl: 'http://api.example.com/anthropic' } })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers', value: { anthropic: { baseUrl: 'http://api.example.com/anthropic' } } })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => writeConfig({ providers: { anthropic: { baseUrl: 'http://api.example.com/anthropic' } } }, 'user')).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'https://user:pass@api.example.com/anthropic' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'https://api.example.com/anthropic?apiKey=secret' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'https://api.example.com/anthropic#token=secret' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');

    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'https://api.example.com/anthropic' })).not.toThrow();
  });

  test('rejects unsafe generic provider base URLs', () => {
    expect(() => setConfig({ key: 'providers.customProvider.baseUrl', value: 'http://example.com/anthropic' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.customProvider.baseUrl', value: 'https://user:pass@example.com/anthropic' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.customProvider.baseUrl', value: 'https://example.com/anthropic?apiKey=secret' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.customProvider.baseUrl', value: 'https://example.com/anthropic#token=secret' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers.customProvider', value: { baseUrl: 'http://example.com/anthropic' } })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => setConfig({ key: 'providers', value: { customProvider: { baseUrl: 'https://user:pass@example.com/anthropic' } } })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
    expect(() => writeConfig({ providers: { customProvider: { baseUrl: 'https://example.com/anthropic?apiKey=secret' } } }, 'user')).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');

    expect(() => setConfig({ key: 'providers.customProvider.baseUrl', value: 'https://example.com/anthropic' })).not.toThrow();
    expect(() => setConfig({ key: 'providers.customProvider', value: { baseUrl: 'https://example.com/anthropic' } })).not.toThrow();
    expect(() => setConfig({ key: 'providers', value: { customProvider: { baseUrl: 'https://example.com/anthropic' } } })).not.toThrow();
  });

  test('reads configurable HTTP proxy with validation and no default', () => {
    // 2.0.1 slim: proxy is not synthesised by DEFAULT_CONFIG; the
    // user-side `proxy` key may or may not be present. When absent
    // the read-side path returns `undefined` for the parent.
    expect(readConfig().proxy?.httpProxy).toBeUndefined();

    writeConfig({ proxy: { httpProxy: 'https://proxy.example:8443' } }, 'user');
    expect(readConfig().proxy?.httpProxy).toBe('https://proxy.example:8443');

    expect(() => setConfig({ key: 'proxy.httpProxy', value: '127.0.0.1:58309' })).toThrow('Proxy URL must be an HTTP or HTTPS URL without embedded credentials');
    expect(() => setConfig({ key: 'proxy.httpProxy', value: 'http://user:pass@127.0.0.1:58309' })).toThrow('Proxy URL must be an HTTP or HTTPS URL without embedded credentials');
    expect(() => setConfig({ key: 'proxy.httpProxy', value: 'https://proxy.example:8443/route?token=secret' })).toThrow('Proxy URL must be an HTTP or HTTPS URL without embedded credentials');
    expect(() => setConfig({ key: 'proxy.httpProxy', value: 'http://127.0.0.1:58309' })).not.toThrow();
  });

  test('keeps project proxy from overriding user proxy', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeConfig({ proxy: { httpProxy: 'https://user-proxy.example:8443' } }, 'user');
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ proxy: { httpProxy: 'https://project-proxy.example:8443' } }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig().proxy?.httpProxy).toBe('https://user-proxy.example:8443');
      expect(getConfig()).toMatchObject({ proxy: { httpProxy: 'https://user-proxy.example:8443' } });
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('keeps project tokens from overriding user tokens', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeConfig({ tokens: { GitHubToken: { env: 'USER_GITHUB_TOKEN' } } }, 'user');
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ tokens: { GitHubToken: { env: 'PROJECT_GITHUB_TOKEN' } } }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig().tokens?.GitHubToken).toEqual({ env: 'USER_GITHUB_TOKEN' });
      expect(getConfig({ key: 'tokens.GitHubToken.env' })).toBe('USER_GITHUB_TOKEN');
      expect(getConfig({ layer: 'project', key: 'tokens.GitHubToken.env' })).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('ignores project-only proxy config', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    // 2.0.1 slim: proxy is a legacy key — writeConfig rejects it; seed
    // the file directly to verify the read-side project-only filter still
    // applies.
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({}), 'utf8');
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ proxy: { httpProxy: 'https://project-proxy.example:8443' } }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig().proxy?.httpProxy).toBeUndefined();
      expect(getConfig({ key: 'proxy.httpProxy' })).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects project-layer sensitive writes', () => {
    expect(() => setConfig({ key: 'providers.anthropic.apiKey', value: 'secret', layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'providers.anthropic', value: { apiKey: 'secret' }, layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'https://api.example.com/anthropic', layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'proxy.httpProxy', value: 'http://127.0.0.1:58309', layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'safe', value: { nested: { token: 'secret' } }, layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => writeConfig({ providers: { anthropic: { baseUrl: 'https://api.example.com/anthropic' } } }, 'project')).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => writeConfig({ proxy: { httpProxy: 'http://127.0.0.1:58309' } }, 'project')).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'safe', value: 'value', layer: 'invalid' as 'project' })).toThrow('Invalid config layer');
  });

  test('normalizes external config shapes before exposing provider config', () => {
    writeConfig({ providers: { anthropic: { model: 'claude-opus-4-7', baseUrl: 'https://api.example.com/anthropic', apiKey: 'plain-secret' } as never } }, 'user');
    const providerConfig = getConfig({ layer: 'user', key: 'providers.anthropic' }) as { model: string; baseUrl: string; apiKey?: string };
    expect(providerConfig.model).toBe('claude-opus-4-7');
    expect(providerConfig.baseUrl).toBe('https://api.example.com/anthropic');
    expect(providerConfig.apiKey).toBe('plain-secret');
  });

  test('normalizes token refs and drops malformed token config entries', () => {
    writeConfig({
      tokens: {
        GitHubToken: { ghCli: true },
        OpenAiApiKey: { env: '  OPENAI_KEY  ' },
        AnthropicApiKey: { env: '' } as never,
        GitLabToken: { keychain: ' ' } as never,
        ExtraToken: { env: 'SHOULD_NOT_SURVIVE' } as never
      }
    } as never, 'user');

    const config = getConfig({ layer: 'user' }) as { tokens?: Record<string, unknown> };
    expect(config.tokens).toMatchObject({
      GitHubToken: { ghCli: true },
      OpenAiApiKey: { env: 'OPENAI_KEY' }
    });
    expect(config.tokens?.AnthropicApiKey).toBeUndefined();
    expect(config.tokens?.GitLabToken).toBeUndefined();
    expect(config.tokens?.ExtraToken).toBeUndefined();
  });

  test('accepts local and remote artifactStorage entries for workspaces', () => {
    writeConfig({
      workspaces: [
        {
          workspaceId: 'ws-local-artifacts',
          name: 'Local Artifacts',
          rootPath: '/tmp/ws-local-artifacts',
          installedCapabilityIds: [],
          artifactStorage: { mode: 'local' }
        },
        {
          workspaceId: 'ws-remote-artifacts',
          name: 'Remote Artifacts',
          rootPath: '/tmp/ws-remote-artifacts',
          installedCapabilityIds: [],
          artifactStorage: {
            mode: 'local-with-remote-sync',
            remote: { provider: 'gitlab', owner: 'acme', name: 'peaks-artifacts' }
          }
        }
      ]
    } as never, 'user');

    const userConfig = getConfig({ layer: 'user' }) as { workspaces?: Array<{ workspaceId: string; artifactStorage?: unknown }> };
    expect(userConfig.workspaces).toMatchObject([
      { workspaceId: 'ws-local-artifacts', artifactStorage: { mode: 'local' } },
      { workspaceId: 'ws-remote-artifacts', artifactStorage: { mode: 'local-with-remote-sync', remote: { provider: 'gitlab', owner: 'acme', name: 'peaks-artifacts' } } }
    ]);
  });

  test('drops invalid artifactStorage entries while preserving valid workspace fields', () => {
    writeConfig({
      workspaces: [
        {
          workspaceId: 'ws-invalid-artifacts',
          name: 'Invalid Artifacts',
          rootPath: '/tmp/ws-invalid-artifacts',
          installedCapabilityIds: [],
          artifactStorage: { mode: 'remote', remote: { provider: 'gitea', owner: 'acme', name: 'repo' } }
        }
      ]
    } as never, 'user');

    const userConfig = getConfig({ layer: 'user' }) as { workspaces?: Array<{ workspaceId: string; name: string; artifactStorage?: unknown }> };
    const workspace = userConfig.workspaces?.find((item) => item.workspaceId === 'ws-invalid-artifacts');

    expect(workspace).toMatchObject({ workspaceId: 'ws-invalid-artifacts', name: 'Invalid Artifacts' });
    expect((workspace as { artifactStorage?: unknown } | undefined)?.artifactStorage).toBeUndefined();
  });

  test('drops workspaces with unsafe workspace ids', () => {
    writeConfig({
      workspaces: [
        { workspaceId: '../escape', name: 'Escape', rootPath: '/tmp/escape', installedCapabilityIds: [] },
        { workspaceId: 'nested/path', name: 'Nested', rootPath: '/tmp/nested', installedCapabilityIds: [] },
        { workspaceId: 'safe-workspace_1', name: 'Safe', rootPath: '/tmp/safe', installedCapabilityIds: [] }
      ]
    } as never, 'user');

    const userConfig = getConfig({ layer: 'user' }) as { workspaces?: Array<{ workspaceId: string }> };
    expect(userConfig.workspaces?.map((workspace) => workspace.workspaceId)).toEqual(['safe-workspace_1']);
  });

  test('drops artifact remote repos with unsafe owner or name segments', () => {
    writeConfig({
      workspaces: [
        {
          workspaceId: 'unsafe-legacy-remote',
          name: 'Unsafe Legacy Remote',
          rootPath: '/tmp/unsafe-legacy-remote',
          installedCapabilityIds: [],
          artifactRepo: { provider: 'github', owner: '../acme', name: 'repo' }
        },
        {
          workspaceId: 'unsafe-storage-remote',
          name: 'Unsafe Storage Remote',
          rootPath: '/tmp/unsafe-storage-remote',
          installedCapabilityIds: [],
          artifactStorage: { mode: 'local-with-remote-sync', remote: { provider: 'gitlab', owner: 'acme', name: 'repo/escape' } }
        }
      ]
    } as never, 'user');

    const userConfig = getConfig({ layer: 'user' }) as { workspaces?: Array<{ workspaceId: string; artifactRepo?: unknown; artifactStorage?: unknown }> };
    expect(userConfig.workspaces?.find((workspace) => workspace.workspaceId === 'unsafe-legacy-remote')?.artifactRepo).toBeUndefined();
    expect(userConfig.workspaces?.find((workspace) => workspace.workspaceId === 'unsafe-storage-remote')?.artifactStorage).toBeUndefined();
  });

  test('finds the most specific workspace containing a path', () => {
    const parentRoot = mkdtempSync(join(tmpdir(), 'peaks-config-parent-workspace-'));
    const childRoot = join(parentRoot, 'packages', 'app');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-workspace-'));
    mkdirSync(childRoot, { recursive: true });
    writeConfig({
      workspaces: [
        { workspaceId: 'parent-ws', name: 'Parent WS', rootPath: parentRoot, installedCapabilityIds: [] },
        { workspaceId: 'child-ws', name: 'Child WS', rootPath: childRoot, installedCapabilityIds: [] },
        { workspaceId: 'relative-ws', name: 'Relative WS', rootPath: '.', installedCapabilityIds: [] },
        { workspaceId: 'missing-ws', name: 'Missing WS', rootPath: join(parentRoot, 'missing'), installedCapabilityIds: [] }
      ]
    } as never, 'user');

    expect(getWorkspaceConfigForPath(join(childRoot, 'src', 'index.ts'))?.workspaceId).toBe('child-ws');
    expect(getWorkspaceConfigForPath(outsideRoot)).toBeNull();
  });

  test('ensureWorkspaceConfigForPath returns null when no workspace matches', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-auto-workspace-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });

    const workspace = ensureWorkspaceConfigForPath(projectRoot);
    expect(workspace).toBeNull();
  });

  test('user workspaces are stored in user config layer', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-shadow-project-'));
    const userArtifactRoot = mkdtempSync(join(tmpdir(), 'peaks-config-user-artifacts-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeConfig({
      workspaces: [{ workspaceId: 'repo-ws', name: 'User Repo WS', rootPath: projectRoot, installedCapabilityIds: [], artifactStorage: { mode: 'local', localPath: userArtifactRoot } }]
    } as never, 'user');
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ workspaces: [{ workspaceId: 'repo-ws', name: 'Project Shadow WS', rootPath: '/tmp/project-shadow', installedCapabilityIds: [] }] }), 'utf8');

    const userConfig = getConfig({ layer: 'user' }) as { workspaces?: Array<{ workspaceId: string; name: string; rootPath: string }> };
    const workspace = userConfig.workspaces?.find((item) => item.workspaceId === 'repo-ws');
    expect(workspace).toMatchObject({ name: 'User Repo WS', rootPath: projectRoot });
  });

  test('workspace helpers tolerate malformed layer config and use the requested layer', () => {
    writeConfig({ workspaces: 'broken' as never, currentWorkspace: 123 as never } as never, 'user');
    addWorkspace({ workspaceId: 'ws-a', name: 'Workspace A', rootPath: '/tmp/ws-a', installedCapabilityIds: [] }, 'user');
    const userConfig = getConfig({ layer: 'user' }) as { workspaces?: Array<{ workspaceId: string }> };
    expect(userConfig.workspaces).toMatchObject([{ workspaceId: 'ws-a' }]);
    expect(setCurrentWorkspace('ws-a', 'user')).toBe(true);
    expect(removeWorkspace('ws-a', 'user')).toBe(true);
  });

  test('rejects unsafe nested config paths and ignores polluted reads', () => {
    expect(() => setConfig({ key: '__proto__.polluted', value: true })).toThrow('Unsafe config path');
    expect(() => setConfig({ key: 'constructor.prototype.polluted', value: true })).toThrow('Unsafe config path');
    expect(() => setConfig({ key: 'safe.path', value: 'ok' })).not.toThrow();
    expect(getConfig({ key: '__proto__.polluted' })).toBeUndefined();
  });

  test('normalizes malformed persisted configs when reading the full config', () => {
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({ workspaces: 'broken', currentWorkspace: 123 }), 'utf8');
    const config = readConfig();

    expect(config.version).toBeDefined();
    // 2.0.1 slim: `model` is no longer synthesised by DEFAULT_CONFIG;
    // assert `ocr.llm` is the new always-present placeholder block.
    expect(config.ocr?.llm).toBeDefined();
  });

  test('rejects user config writes when config.json is hardlinked', () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    const outsideConfigPath = join(outsideRoot, 'config.json');
    const configPath = join(configTestHome, '.peaks', 'config.json');
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(outsideConfigPath, '{}', 'utf8');
    if (existsSync(configPath)) unlinkSync(configPath);
    linkSync(outsideConfigPath, configPath);

    try {
      expect(() => writeConfig({ language: 'zh-CN' }, 'user')).toThrow('Config path must not be hardlinked');
      expect(() => getConfig({ layer: 'user' })).toThrow('Config path must not be hardlinked');
      expect(readFileSync(outsideConfigPath, 'utf8')).toBe('{}');
    } finally {
      if (existsSync(configPath)) unlinkSync(configPath);
      writeFileSync(configPath, '{}', 'utf8');
    }
  });

  fileSymlinkTest('rejects user config writes when config.json is a symlink', () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    const outsideConfigPath = join(outsideRoot, 'config.json');
    const configPath = join(configTestHome, '.peaks', 'config.json');
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(outsideConfigPath, '{}', 'utf8');
    if (existsSync(configPath)) unlinkSync(configPath);
    symlinkSync(outsideConfigPath, configPath);

    // Slice 2026-06-13-repair-pre-existing-test-failures: use
    // `writeConfig` (which does not apply the 2.0.1 legacy-key guard)
    // instead of `setConfig({ key: 'language', ... })`, so the symlink
    // path guard fires BEFORE the legacy-key rejection. The legacy
    // guard intentionally short-circuits on `language`, masking the
    // symlink guard on the older API surface.
    try {
      expect(() => writeConfig({ language: 'zh-CN' }, 'user')).toThrow('User config path must stay inside the user root');
      expect(() => getConfig({ layer: 'user' })).toThrow('User config path must stay inside the user root');
      expect(readFileSync(outsideConfigPath, 'utf8')).toBe('{}');
    } finally {
      // try/finally so a mid-test failure does not leak the symlink
      // into later tests in this file (cascade caused 5 other
      // config-service tests to fail with `validateUserConfigPathForWrite`
      // throwing on a stale symlink at configPath).
      if (existsSync(configPath)) unlinkSync(configPath);
      writeFileSync(configPath, '{}', 'utf8');
    }
  });

  test('rejects artifact marker creation when artifact .peaks is a symlink', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-project-'));
    const artifactRoot = mkdtempSync(join(tmpdir(), 'peaks-config-artifacts-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    symlinkSync(outsideRoot, join(artifactRoot, '.peaks'), 'junction');
    writeConfig({
      workspaces: [{ workspaceId: 'unsafe-artifact-marker', name: 'Unsafe Artifact Marker', rootPath: projectRoot, installedCapabilityIds: [], artifactStorage: { mode: 'local', localPath: artifactRoot } }]
    } as never, 'user');

    expect(() => ensureWorkspaceConfigForPath(projectRoot)).toThrow('Artifact workspace marker must stay inside the artifact workspace');
    expect(existsSync(join(outsideRoot, 'config.json'))).toBe(false);
  });

  test('rejects artifact marker creation when artifact root is a symlink into the project', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-project-'));
    const artifactTarget = join(projectRoot, 'artifacts');
    const artifactRoot = join(tmpdir(), `peaks-config-linked-artifacts-${Date.now()}`);
    mkdirSync(artifactTarget, { recursive: true });
    symlinkSync(artifactTarget, artifactRoot, 'junction');
    writeConfig({
      workspaces: [{ workspaceId: 'unsafe-artifact-root', name: 'Unsafe Artifact Root', rootPath: projectRoot, installedCapabilityIds: [], artifactStorage: { mode: 'local', localPath: artifactRoot } }]
    } as never, 'user');

    expect(() => ensureWorkspaceConfigForPath(projectRoot)).toThrow('Artifact workspace marker must stay inside the artifact workspace');
    expect(existsSync(join(artifactTarget, '.peaks', 'config.json'))).toBe(false);
  });

  test('rejects provider updates when an existing stored URL is invalid', () => {
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({ providers: { anthropic: { baseUrl: 'http://example.com/anthropic' } } }), 'utf8');
    expect(() => setConfig({ key: 'providers.anthropic.baseUrl', value: 'http://example.com/anthropic' })).toThrow('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
  });
});

describe('project config discovery', () => {
  test('prefers project .peaks config over global .peaks config', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({ language: 'en', currentWorkspace: 'global' }), 'utf8');
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ language: 'zh', currentWorkspace: 'project' }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig()).toMatchObject({ language: 'zh' });
      expect(getConfig()).toMatchObject({ language: 'zh', currentWorkspace: 'project' });
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('falls back to global .peaks config when project config is absent', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    // 2.0.1 slim: legacy fields can still be present in pre-2.0.1
    // config files and must be exposed via getConfig (loader is tolerant).
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({ language: 'zh', model: 'opus' }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig()).toMatchObject({ language: 'zh' });
      expect(getConfig()).toMatchObject({ language: 'zh' });
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('does not treat the user home .peaks config as a project config through a symlinked home path', () => {
    const realHomeRoot = mkdtempSync(join(tmpdir(), 'peaks-real-home-'));
    const linkedHomeRoot = join(tmpdir(), `peaks-linked-home-${Date.now()}`);
    symlinkSync(realHomeRoot, linkedHomeRoot, 'junction');
    mkdirSync(join(realHomeRoot, '.peaks'), { recursive: true });
    writeFileSync(join(realHomeRoot, '.peaks', 'config.json'), JSON.stringify({ language: 'zh-CN' }), 'utf8');

    const originalHome = process.env.HOME;
    process.env.HOME = linkedHomeRoot;
    try {
      expect(resolveProjectRootForConfig(join(realHomeRoot, 'nested'))).toBe(join(realHomeRoot, 'nested'));
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  test('does not read project config when marker resolves outside the candidate root', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    mkdirSync(outsideRoot, { recursive: true });
    writeFileSync(join(outsideRoot, 'config.json'), JSON.stringify({ unsafeProjectMarker: true }), 'utf8');
    symlinkSync(outsideRoot, join(projectRoot, '.peaks'), 'junction');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const config = getConfig() as { unsafeProjectMarker?: boolean };

      expect(config.unsafeProjectMarker).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('bootstraps project language config from natural-language first use', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const configPath = join(projectRoot, '.peaks', 'config.json');

    expect(existsSync(configPath)).toBe(false);

    bootstrapProjectLanguageConfig(projectRoot, '请使用 peaks-code 帮我重构这个项目');

    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ language: 'zh-CN' });
    expect(readConfig(projectRoot).language).toBe('zh-CN');
  });

  test('bootstraps English project language from natural-language first use', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));

    bootstrapProjectLanguageConfig(projectRoot, 'Please use peaks-code to refactor this project');

    expect(JSON.parse(readFileSync(join(projectRoot, '.peaks', 'config.json'), 'utf8'))).toEqual({ language: 'en' });
  });

  test('rejects bootstrap when the project .peaks directory resolves outside the project root', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    symlinkSync(outsideRoot, join(projectRoot, '.peaks'), 'junction');

    expect(() => bootstrapProjectLanguageConfig(projectRoot, 'zh-CN')).toThrow('Project config path must stay inside the project root');
    expect(existsSync(join(outsideRoot, 'config.json'))).toBe(false);
  });

  test('rejects bootstrap when the project .peaks directory resolves to another project directory', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const sourceRoot = join(projectRoot, 'src');
    mkdirSync(sourceRoot, { recursive: true });
    symlinkSync(sourceRoot, join(projectRoot, '.peaks'), 'junction');

    expect(() => bootstrapProjectLanguageConfig(projectRoot, 'zh-CN')).toThrow('Project config path must stay inside the project root');
    expect(existsSync(join(sourceRoot, 'config.json'))).toBe(false);
  });

  test('rejects bootstrap when project config is a symlink outside the project root', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    symlinkSync(outsideRoot, join(projectRoot, '.peaks', 'config.json'), 'junction');

    expect(() => bootstrapProjectLanguageConfig(projectRoot, 'zh-CN')).toThrow('Project config path must stay inside the project root');
    expect(existsSync(join(outsideRoot, 'language'))).toBe(false);
  });

  test('rejects bootstrap when project config is hardlinked', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-config-outside-'));
    const outsideConfigPath = join(outsideRoot, 'config.json');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(outsideConfigPath, '{}', 'utf8');
    linkSync(outsideConfigPath, join(projectRoot, '.peaks', 'config.json'));

    expect(() => bootstrapProjectLanguageConfig(projectRoot, 'zh-CN')).toThrow('Config path must not be hardlinked');
    expect(readFileSync(outsideConfigPath, 'utf8')).toBe('{}');
  });

  test('keeps existing project language when bootstrap runs again', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ language: 'zh-CN', economyMode: false }), 'utf8');

    bootstrapProjectLanguageConfig(projectRoot, 'en');

    expect(JSON.parse(readFileSync(join(projectRoot, '.peaks', 'config.json'), 'utf8'))).toEqual({ language: 'zh-CN', economyMode: false });
  });

  test('does not overwrite malformed project config during language bootstrap', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    const configPath = join(projectRoot, '.peaks', 'config.json');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(configPath, '{bad', 'utf8');

    expect(() => bootstrapProjectLanguageConfig(projectRoot, 'zh-CN')).toThrow('Project config must contain valid JSON');
    expect(readFileSync(configPath, 'utf8')).toBe('{bad');
  });
});

describe('config types', () => {
  test('TokenRef supports all variants', () => {
    const envRef = { env: 'MY_KEY' };
    const keychainRef = { keychain: 'service' };
    const ghCliRef = { ghCli: true };
    expect(envRef.env).toBe('MY_KEY');
    expect(keychainRef.keychain).toBe('service');
    expect(ghCliRef.ghCli).toBe(true);
  });

  test('WorkspaceConfig with artifact repo', () => {
    const ws = {
      workspaceId: 'test',
      name: 'Test',
      rootPath: '/test',
      installedCapabilityIds: ['cap1'],
      artifactRepo: { provider: 'github' as const, owner: 'user', name: 'repo' }
    };
    expect(ws.artifactRepo?.provider).toBe('github');
    expect(ws.artifactRepo?.owner).toBe('user');
  });

  test('PeaksConfig structure', () => {
    const config = {
      version: '0.1.0',
      currentWorkspace: 'ws1',
      workspaces: [],
      language: 'en',
      model: 'sonnet' as const,
      economyMode: true,
      swarmMode: true,
      tokens: { GitHubToken: { env: 'GH_TOKEN' } },
      providers: {
        anthropic: {
          model: 'claude-opus-4-7',
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'test-key'
        }
      },
      proxy: {}
    };
    expect(config.version).toBe('0.1.0');
    expect(config.currentWorkspace).toBe('ws1');
    expect(config.model).toBe('sonnet');
    expect(config.economyMode).toBe(true);
    expect(config.swarmMode).toBe(true);
    expect(config.providers.anthropic?.model).toBe('claude-opus-4-7');
    expect(config.providers.anthropic?.baseUrl).toBe('https://api.example.com/anthropic');
  });
});

describe('CLI integration via program', () => {
  // These tests verify the CLI commands work correctly
  // by testing through the actual program entrypoint

  test('config types are correctly exported from config-types', async () => {
    const { DEFAULT_CONFIG } = await import('../../src/services/config/config-types.js');
    const { CLI_VERSION } = await import('../../src/shared/version.js');
    expect(DEFAULT_CONFIG).toBeDefined();
    // 2.0.1 slim: only `version` + `ocr` placeholders live in DEFAULT_CONFIG.
    // Legacy fields (language/model/etc.) are rejected by setConfig and live
    // in `<project>/.peaks/preferences.json`.
    expect(DEFAULT_CONFIG.version).toBe(CLI_VERSION);
    expect(DEFAULT_CONFIG.ocr?.llm).toEqual({
      url: '',
      authToken: '',
      model: '',
      useAnthropic: false,
      authHeader: 'authorization'
    });
    expect((DEFAULT_CONFIG as Record<string, unknown>).language).toBeUndefined();
    expect((DEFAULT_CONFIG as Record<string, unknown>).model).toBeUndefined();
    expect((DEFAULT_CONFIG as Record<string, unknown>).economyMode).toBeUndefined();
  });

  test('ConfigLayer type has user and project', async () => {
    const configTypes = await import('../../src/services/config/config-types.js');
    type ConfigLayer = 'user' | 'project';
    const layers: ConfigLayer[] = ['user', 'project'];
    expect(layers).toHaveLength(2);
  });
});

describe('Bug 1 — 2.0.1 slim config defaults', () => {
  // Slice 2.0.1-bug1-config-defaults — the on-disk `~/.peaks/config.json`
  // must hold only `version` + `ocr` placeholders. Per-project fields
  // (language, model, economyMode, swarmMode) are rejected at write
  // time and live in `<project>/.peaks/preferences.json` instead.

  test('case A — fresh migration writes slim 2-key form (version + ocr)', async () => {
    const { executeMigration } = await import('../../src/services/config/config-migration.js');
    const configPath = join(configTestHome, '.peaks', 'config.json');
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ version: '1.4.2', language: 'en', model: 'sonnet', economyMode: true }), 'utf8');

    executeMigration({ currentProjectRoot: configTestHome, apply: true });

    const onDisk = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(onDisk).sort()).toEqual(['ocr', 'version']);
    const ocr = onDisk.ocr as { llm?: Record<string, unknown> };
    expect(ocr).toBeDefined();
    expect(ocr.llm).toEqual({
      url: '',
      authToken: '',
      model: '',
      useAnthropic: false,
      authHeader: 'authorization'
    });
  });

  test('case B — existing old-format file loads without throwing and exposes legacy fields via getConfig', () => {
    const configPath = join(configTestHome, '.peaks', 'config.json');
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
      version: '1.4.2',
      language: 'zh-CN',
      model: 'sonnet',
      economyMode: true,
      swarmMode: false
    }), 'utf8');

    expect(() => getConfig({ layer: 'user' })).not.toThrow();
    const legacy = getConfig({ layer: 'user' }) as { language?: string; model?: string; economyMode?: boolean; swarmMode?: boolean };
    expect(legacy.language).toBe('zh-CN');
    expect(legacy.model).toBe('sonnet');
    expect(legacy.economyMode).toBe(true);
    expect(legacy.swarmMode).toBe(false);
  });

  test('case C — setConfig to a legacy key is rejected with a preferences.json pointer', () => {
    // 2.0.1 moved per-project fields to .peaks/preferences.json (per spec
    // §10.4). tokens / providers / proxy still live in the user config
    // and are not in this rejection set.
    const legacyKeys = ['language', 'model', 'economyMode', 'swarmMode'];
    for (const key of legacyKeys) {
      expect(() => setConfig({ key, value: 'zh-CN' as never }), `setConfig should reject legacy key "${key}"`).toThrow(/preferences\.json/);
    }
  });
});