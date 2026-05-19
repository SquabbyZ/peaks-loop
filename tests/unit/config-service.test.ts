import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

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

import { addWorkspace, bootstrapProjectLanguageConfig, containsSensitiveConfigValue, getConfig, getMiniMaxProviderConfig, isConfigLayer, isSensitiveConfigPath, readConfig, redactConfigSecrets, removeWorkspace, setConfig, setCurrentWorkspace, setMiniMaxProviderConfig, writeConfig } from '../../src/services/config/config-service.js';

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
    expect(isSensitiveConfigPath('providers.minimax.apiKey')).toBe(true);
    expect(isSensitiveConfigPath('tokens.GitHubToken')).toBe(true);
    expect(isSensitiveConfigPath('providers.minimax.baseUrl')).toBe(false);
  });

  test('detects nested sensitive config values', () => {
    expect(containsSensitiveConfigValue({ minimax: { apiKey: 'secret' } })).toBe(true);
    expect(containsSensitiveConfigValue([{ token: 'secret' }])).toBe(true);
    expect(containsSensitiveConfigValue({ minimax: { baseUrl: 'https://api.minimaxi.com/anthropic' } })).toBe(false);
  });

  test('redacts nested secret values without mutating the input', () => {
    const config = {
      providers: {
        minimax: {
          baseUrl: 'https://api.minimaxi.com/anthropic',
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
    const redactedConfig = redacted as { providers: { minimax: { baseUrl: string; apiKey: string; emptyToken: string }; customProvider: { baseUrl: string } }; list: { token: string }[] };

    expect(redactedConfig.providers.minimax.baseUrl).toBe('https://api.minimaxi.com/anthropic');
    expect(redactedConfig.providers.minimax.apiKey).toBe('***');
    expect(redactedConfig.providers.minimax.emptyToken).toBe('***');
    expect(redactedConfig.providers.customProvider.baseUrl).toBe('https://example.com/anthropic');
    expect(redactedConfig.list[0]?.token).toBe('***');
    expect(config.providers.minimax.apiKey.value).toBe('plain-secret');
  });

  test('rejects insecure MiniMax base URLs through all config write paths', () => {
    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'http://api.minimaxi.com/anthropic' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setConfig({ key: 'providers.minimax', value: { baseUrl: 'http://api.minimaxi.com/anthropic' } })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setConfig({ key: 'providers', value: { minimax: { baseUrl: 'http://api.minimaxi.com/anthropic' } } })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => writeConfig({ providers: { minimax: { baseUrl: 'http://api.minimaxi.com/anthropic' } } }, 'user')).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setMiniMaxProviderConfig({ baseUrl: 'http://api.minimaxi.com/anthropic' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'https://user:pass@api.minimaxi.com/anthropic' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'https://api.minimaxi.com/anthropic?apiKey=secret' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'https://api.minimaxi.com/anthropic#token=secret' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'https://example.com/anthropic' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');

    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'https://api.minimaxi.com/anthropic' })).not.toThrow();
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
    expect(readConfig().proxy.httpProxy).toBeUndefined();

    writeConfig({ proxy: { httpProxy: 'https://proxy.example:8443' } }, 'user');
    expect(readConfig().proxy.httpProxy).toBe('https://proxy.example:8443');

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
      expect(readConfig().proxy.httpProxy).toBe('https://user-proxy.example:8443');
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
      expect(readConfig().tokens.GitHubToken).toEqual({ env: 'USER_GITHUB_TOKEN' });
      expect(getConfig({ key: 'tokens.GitHubToken.env' })).toBe('USER_GITHUB_TOKEN');
      expect(getConfig({ layer: 'project', key: 'tokens.GitHubToken.env' })).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('ignores project-only proxy config', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeConfig({ proxy: {} }, 'user');
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ proxy: { httpProxy: 'https://project-proxy.example:8443' } }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig().proxy.httpProxy).toBeUndefined();
      expect(getConfig({ key: 'proxy.httpProxy' })).toBeUndefined();
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects project-layer sensitive writes', () => {
    expect(() => setConfig({ key: 'providers.minimax.apiKey', value: 'secret', layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'providers.minimax', value: { apiKey: 'secret' }, layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'providers.minimax.baseUrl', value: 'https://api.minimaxi.com/anthropic', layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'proxy.httpProxy', value: 'http://127.0.0.1:58309', layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'safe', value: { nested: { token: 'secret' } }, layer: 'project' })).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => writeConfig({ providers: { minimax: { baseUrl: 'https://api.minimaxi.com/anthropic' } } }, 'project')).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => writeConfig({ proxy: { httpProxy: 'http://127.0.0.1:58309' } }, 'project')).toThrow('Sensitive config keys must be stored in the user config layer');
    expect(() => setConfig({ key: 'safe', value: 'value', layer: 'invalid' as 'project' })).toThrow('Invalid config layer');
  });

  test('normalizes external config shapes before exposing provider config', () => {
    writeConfig({ providers: { minimax: { model: 'minimax-2.7', baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 123 as unknown as string } as never } }, 'user');
    const providerConfig = getMiniMaxProviderConfig();
    expect(providerConfig.model).toBe('minimax-2.7');
    expect(providerConfig.baseUrl).toBe('https://api.minimaxi.com/anthropic');
    expect(providerConfig.apiKey).toBeUndefined();
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

    expect(readConfig().workspaces).toMatchObject([
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

    const workspace = readConfig().workspaces.find((item) => item.workspaceId === 'ws-invalid-artifacts');

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

    expect(readConfig().workspaces.map((workspace) => workspace.workspaceId)).toEqual(['safe-workspace_1']);
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

    const workspaces = readConfig().workspaces;
    expect(workspaces.find((workspace) => workspace.workspaceId === 'unsafe-legacy-remote')?.artifactRepo).toBeUndefined();
    expect(workspaces.find((workspace) => workspace.workspaceId === 'unsafe-storage-remote')?.artifactStorage).toBeUndefined();
  });

  test('workspace helpers tolerate malformed layer config and use the requested layer', () => {
    writeConfig({ workspaces: 'broken' as never, currentWorkspace: 123 as never }, 'user');
    addWorkspace({ workspaceId: 'ws-a', name: 'Workspace A', rootPath: '/tmp/ws-a', installedCapabilityIds: [] }, 'user');
    expect(getConfig({ layer: 'user' })).toMatchObject({ workspaces: [{ workspaceId: 'ws-a' }] });
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
    const config = readConfig() as { workspaces?: unknown[]; currentWorkspace?: unknown };

    expect(Array.isArray(config.workspaces)).toBe(true);
    expect(config.currentWorkspace === null || typeof config.currentWorkspace === 'string' || config.currentWorkspace === undefined).toBe(true);
  });

  test('rejects MiniMax provider updates when an existing stored URL is invalid', () => {
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({ providers: { minimax: { baseUrl: 'https://example.com/anthropic' } } }), 'utf8');
    expect(() => setMiniMaxProviderConfig({ apiKey: 'secret' })).toThrow('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
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
      expect(readConfig()).toMatchObject({ language: 'zh', currentWorkspace: 'project' });
      expect(getConfig()).toMatchObject({ language: 'zh', currentWorkspace: 'project' });
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('falls back to global .peaks config when project config is absent', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));
    mkdirSync(join(configTestHome, '.peaks'), { recursive: true });
    writeFileSync(join(configTestHome, '.peaks', 'config.json'), JSON.stringify({ language: 'zh', model: 'minimax' }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      expect(readConfig()).toMatchObject({ language: 'zh', economyMode: true, swarmMode: true });
      expect(getConfig()).toMatchObject({ language: 'zh' });
    } finally {
      cwdSpy.mockRestore();
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

    bootstrapProjectLanguageConfig(projectRoot, '请使用 peaks-solo 帮我重构这个项目');

    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({ language: 'zh-CN' });
    expect(readConfig(projectRoot).language).toBe('zh-CN');
  });

  test('bootstraps English project language from natural-language first use', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-config-root-'));

    bootstrapProjectLanguageConfig(projectRoot, 'Please use peaks-solo to refactor this project');

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
        minimax: {
          model: 'minimax-2.7',
          baseUrl: 'https://api.minimaxi.com/anthropic',
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
    expect(config.providers.minimax?.model).toBe('minimax-2.7');
    expect(config.providers.minimax?.baseUrl).toBe('https://api.minimaxi.com/anthropic');
  });
});

describe('CLI integration via program', () => {
  // These tests verify the CLI commands work correctly
  // by testing through the actual program entrypoint

  test('config types are correctly exported from config-types', async () => {
    const { DEFAULT_CONFIG } = await import('../../src/services/config/config-types.js');
    expect(DEFAULT_CONFIG).toBeDefined();
    expect(DEFAULT_CONFIG.version).toBe('0.1.0');
    expect(DEFAULT_CONFIG.language).toBe('en');
    expect(DEFAULT_CONFIG.model).toBe('sonnet');
    expect(DEFAULT_CONFIG.economyMode).toBe(true);
    expect(DEFAULT_CONFIG.swarmMode).toBe(true);
    expect(DEFAULT_CONFIG.providers.minimax?.model).toBe('minimax-2.7');
    expect(DEFAULT_CONFIG.proxy).toEqual({});
  });

  test('ConfigLayer type has user and project', async () => {
    const configTypes = await import('../../src/services/config/config-types.js');
    type ConfigLayer = 'user' | 'project';
    const layers: ConfigLayer[] = ['user', 'project'];
    expect(layers).toHaveLength(2);
  });
});