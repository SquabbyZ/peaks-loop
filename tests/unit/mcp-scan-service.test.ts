import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

const mcpScanTestState = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir: tmpdirSync } = require('node:os') as typeof import('node:os');
  const { join: joinSync } = require('node:path') as typeof import('node:path');
  return { home: mkdtempSync(joinSync(tmpdirSync(), 'peaks-mcp-scan-home-')) };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => mcpScanTestState.home };
});

const { scanMcpServers } = await import('../../src/services/mcp/mcp-scan-service.js');

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-mcp-scan-'));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data), 'utf8');
}

describe('scanMcpServers', () => {
  test('returns empty server list with both scopes marked missing when no settings exist', async () => {
    const home = await makeRoot();
    const project = await makeRoot();

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      projectRoot: project
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.global.exists).toBe(false);
    expect(report.scopes.project?.exists).toBe(false);
  });

  test('returns null project scope when projectRoot is not provided', async () => {
    const home = await makeRoot();

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    expect(report.scopes.project).toBeNull();
  });

  test('parses global mcpServers and labels them unknown when no managed marker exists', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: {
        context7: {
          command: 'npx',
          args: ['-y', '@upstash/context7-mcp@latest'],
          env: { CONTEXT7_API_KEY: 'placeholder', OTHER: 'value' }
        }
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json')
    });

    expect(report.servers).toHaveLength(1);
    expect(report.servers[0]).toMatchObject({
      name: 'context7',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp@latest'],
      source: 'unknown',
      scope: 'global'
    });
    expect(report.servers[0]?.envKeys).toEqual(['CONTEXT7_API_KEY', 'OTHER']);
  });

  test('labels servers from the managed marker as peaks-managed', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(join(home, '.peaks'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: {
        context7: { command: 'npx', args: [], env: {} },
        figma: { command: 'figma-mcp', args: [], env: {} }
      }
    });
    await writeJson(join(home, '.peaks', 'mcp-managed.json'), {
      servers: ['context7']
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json')
    });

    const context7 = report.servers.find((server) => server.name === 'context7');
    const figma = report.servers.find((server) => server.name === 'figma');

    expect(context7?.source).toBe('peaks');
    expect(figma?.source).toBe('unknown');
  });

  test('merges project-scope servers and reports them with project scope', async () => {
    const home = await makeRoot();
    const project = await makeRoot();
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeJson(join(project, '.claude', 'settings.json'), {
      mcpServers: {
        chrome: { command: 'chrome-devtools-mcp', args: ['--port', '9223'] }
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      projectRoot: project
    });

    expect(report.servers).toHaveLength(1);
    expect(report.servers[0]).toMatchObject({
      name: 'chrome',
      command: 'chrome-devtools-mcp',
      args: ['--port', '9223'],
      envKeys: [],
      scope: 'project'
    });
  });

  test('returns unknown source when settings.json is unreadable JSON', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '{ not json', 'utf8');

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.global.exists).toBe(true);
    expect(report.scopes.global.parseError).toMatch(/JSON|parse/i);
  });

  test('skips mcpServers entries that are not objects', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: {
        good: { command: 'ok', args: [], env: {} },
        bad: 'not-an-object',
        nameless: { args: [] }
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    const names = report.servers.map((server) => server.name);
    expect(names).toContain('good');
    expect(names).not.toContain('bad');
    expect(names).not.toContain('nameless');
  });

  test('returns empty servers when settings.json has no mcpServers field', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), { theme: 'dark' });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.global.exists).toBe(true);
  });

  test('ignores managed marker when it is not valid JSON', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(join(home, '.peaks'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'npx', args: [], env: {} } }
    });
    await writeFile(join(home, '.peaks', 'mcp-managed.json'), 'not json', 'utf8');

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json')
    });

    expect(report.servers[0]?.source).toBe('unknown');
  });

  test('ignores managed marker servers field when it is not an array of strings', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(join(home, '.peaks'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'npx', args: [], env: {} } }
    });
    await writeJson(join(home, '.peaks', 'mcp-managed.json'), { servers: 'context7' });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json')
    });

    expect(report.servers[0]?.source).toBe('unknown');
  });

  test('treats settings.json that is an array as having no servers', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '[]', 'utf8');

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.global.exists).toBe(true);
    expect(report.scopes.global.parseError).toBeUndefined();
  });

  test('treats managed marker that is an array as having no peaks-managed names', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await mkdir(join(home, '.peaks'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'npx', args: [], env: {} } }
    });
    await writeFile(join(home, '.peaks', 'mcp-managed.json'), '[]', 'utf8');

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json')
    });

    expect(report.servers[0]?.source).toBe('unknown');
  });

  test('resolves homedir-based settings and managed marker paths when no options are passed', async () => {
    await mkdir(join(mcpScanTestState.home, '.claude'), { recursive: true });
    await mkdir(join(mcpScanTestState.home, '.peaks'), { recursive: true });
    await writeJson(join(mcpScanTestState.home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'npx', args: [], env: {} } }
    });
    await writeJson(join(mcpScanTestState.home, '.peaks', 'mcp-managed.json'), {
      servers: ['context7']
    });

    const report = await scanMcpServers();

    expect(report.scopes.global.path).toBe(join(mcpScanTestState.home, '.claude', 'settings.json'));
    expect(report.servers[0]?.source).toBe('peaks');
    expect(report.scopes.project).toBeNull();
  });

  test('coerces non-array args and missing env to safe defaults', async () => {
    const home = await makeRoot();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: {
        weird: { command: 'tool', args: 'not-array' }
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    expect(report.servers[0]?.args).toEqual([]);
    expect(report.servers[0]?.envKeys).toEqual([]);
  });
});

describe('scanMcpServers plugin discovery', () => {
  test('discovers plugin-loaded MCP server with source plugin and the owning plugin id', async () => {
    const home = await makeRoot();
    const pluginInstall = await makeRoot();
    const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeJson(join(pluginInstall, '.mcp.json'), {
      playwright: { command: 'npx', args: ['@playwright/mcp@latest'] }
    });
    await writeJson(registryPath, {
      version: 2,
      plugins: {
        'playwright@claude-plugins-official': [
          { installPath: pluginInstall, version: '1.0.0' }
        ]
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: registryPath
    });

    const playwright = report.servers.find((server) => server.name === 'playwright');
    expect(playwright).toMatchObject({
      name: 'playwright',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      source: 'plugin',
      scope: 'plugin',
      pluginName: 'playwright@claude-plugins-official'
    });
    expect(report.scopes.plugins.exists).toBe(true);
    expect(report.scopes.plugins.pluginsScanned).toBe(1);
    expect(report.scopes.plugins.pluginsWithMcp).toBe(1);
  });

  test('accepts both wrapped-mcpServers and direct .mcp.json formats', async () => {
    const home = await makeRoot();
    const wrappedInstall = await makeRoot();
    const directInstall = await makeRoot();
    const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeJson(join(wrappedInstall, '.mcp.json'), {
      mcpServers: { figma: { command: 'figma-mcp', args: [] } }
    });
    await writeJson(join(directInstall, '.mcp.json'), {
      context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] }
    });
    await writeJson(registryPath, {
      plugins: {
        'figma@claude-plugins-official': [{ installPath: wrappedInstall }],
        'context7@claude-plugins-official': [{ installPath: directInstall }]
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: registryPath
    });

    const names = report.servers.map((server) => server.name);
    expect(names).toContain('figma');
    expect(names).toContain('context7');
    expect(report.scopes.plugins.pluginsScanned).toBe(2);
    expect(report.scopes.plugins.pluginsWithMcp).toBe(2);
  });

  test('skips plugins that do not ship an .mcp.json (e.g. chrome-devtools-mcp uses server.json)', async () => {
    const home = await makeRoot();
    const pluginInstall = await makeRoot();
    const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeJson(registryPath, {
      plugins: {
        'chrome-devtools-mcp@claude-plugins-official': [{ installPath: pluginInstall }]
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: registryPath
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.plugins.pluginsScanned).toBe(1);
    expect(report.scopes.plugins.pluginsWithMcp).toBe(0);
  });

  test('reports plugins scope as missing when installed_plugins.json does not exist', async () => {
    const home = await makeRoot();

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: join(home, '.claude', 'plugins', 'installed_plugins.json')
    });

    expect(report.scopes.plugins.exists).toBe(false);
    expect(report.scopes.plugins.pluginsScanned).toBe(0);
  });

  test('records parseError when installed_plugins.json is not valid JSON', async () => {
    const home = await makeRoot();
    const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeFile(registryPath, '{ not json', 'utf8');

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: registryPath
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.plugins.exists).toBe(true);
    expect(report.scopes.plugins.parseError).toMatch(/JSON|parse/i);
  });

  test('skips plugin entries whose .mcp.json is unreadable JSON', async () => {
    const home = await makeRoot();
    const pluginInstall = await makeRoot();
    const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeFile(join(pluginInstall, '.mcp.json'), 'not json', 'utf8');
    await writeJson(registryPath, {
      plugins: {
        'broken@claude-plugins-official': [{ installPath: pluginInstall }]
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: registryPath
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.plugins.pluginsScanned).toBe(1);
    expect(report.scopes.plugins.pluginsWithMcp).toBe(0);
  });

  test('skips plugin entries with missing installPath in the registry', async () => {
    const home = await makeRoot();
    const registryPath = join(home, '.claude', 'plugins', 'installed_plugins.json');
    await mkdir(join(home, '.claude', 'plugins'), { recursive: true });
    await writeJson(registryPath, {
      plugins: {
        'no-install@claude-plugins-official': [{ version: '1.0.0' }],
        'empty@claude-plugins-official': [],
        'not-array@claude-plugins-official': 'oops'
      }
    });

    const report = await scanMcpServers({
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      pluginsRegistryPath: registryPath
    });

    expect(report.servers).toEqual([]);
    expect(report.scopes.plugins.pluginsScanned).toBe(0);
  });
});
