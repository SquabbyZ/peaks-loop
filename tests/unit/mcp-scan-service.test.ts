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

  test('falls back to default global and managed marker paths in homedir when options are omitted', async () => {
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
