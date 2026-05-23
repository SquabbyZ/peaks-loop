import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findMcpInstallSpec, seedMcpInstalls } from '../../src/services/mcp/mcp-install-registry.js';
import { planMcpInstall } from '../../src/services/mcp/mcp-plan-service.js';

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-mcp-plan-'));
}

async function writeGlobalSettings(home: string, settings: unknown): Promise<void> {
  await mkdir(join(home, '.claude'), { recursive: true });
  await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify(settings), 'utf8');
}

async function writeManagedMarker(home: string, names: string[]): Promise<void> {
  await mkdir(join(home, '.peaks'), { recursive: true });
  await writeFile(join(home, '.peaks', 'mcp-managed.json'), JSON.stringify({ servers: names }), 'utf8');
}

describe('mcp-install-registry', () => {
  test('exports at least one seed install spec', () => {
    expect(seedMcpInstalls.length).toBeGreaterThan(0);
  });

  test('finds a seeded install spec by capability id', () => {
    const spec = findMcpInstallSpec('context7.docs-lookup');

    expect(spec).not.toBeNull();
    expect(spec?.name).toBe('context7');
    expect(spec?.envKeys).toContain('CONTEXT7_API_KEY');
  });

  test('returns null for unknown capability id', () => {
    expect(findMcpInstallSpec('does.not.exist')).toBeNull();
  });

  test('exposes a Playwright MCP install spec with no required env vars', () => {
    const spec = findMcpInstallSpec('playwright-mcp.browser-validation');

    expect(spec).not.toBeNull();
    expect(spec?.name).toBe('playwright');
    expect(spec?.command).toBe('npx');
    expect(spec?.envKeys).toEqual([]);
  });

  test('exposes a Chrome DevTools MCP install spec with no required env vars', () => {
    const spec = findMcpInstallSpec('chrome-devtools-mcp.browser-debug');

    expect(spec).not.toBeNull();
    expect(spec?.name).toBe('chrome-devtools');
    expect(spec?.envKeys).toEqual([]);
  });

  test('exposes a Figma Context MCP install spec that requires FIGMA_API_KEY', () => {
    const spec = findMcpInstallSpec('figma-context-mcp.design-context');

    expect(spec).not.toBeNull();
    expect(spec?.name).toBe('figma');
    expect(spec?.envKeys).toEqual(['FIGMA_API_KEY']);
  });

  test('every seed install spec uses npx so peaks mcp apply can write a portable settings entry', () => {
    for (const spec of seedMcpInstalls) {
      expect.soft(spec.command, `${spec.capabilityId} should be invoked through npx for portability`).toBe('npx');
      expect.soft(spec.scope, `${spec.capabilityId} should default to global scope`).toBe('global');
    }
  });
});

describe('planMcpInstall', () => {
  test('returns unknown-capability when capabilityId has no install spec', async () => {
    const home = await makeHome();

    const plan = await planMcpInstall('does.not.exist', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(plan.action).toBe('unknown-capability');
    expect(plan.spec).toBeNull();
    expect(plan.current).toBeNull();
    expect(plan.nextActions[0]).toMatch(/capability/i);
  });

  test('returns add action when server is not present and reports missing env keys', async () => {
    const home = await makeHome();

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      env: {}
    });

    expect(plan.action).toBe('add');
    expect(plan.spec?.name).toBe('context7');
    expect(plan.current).toBeNull();
    expect(plan.envCheck.missing).toEqual(['CONTEXT7_API_KEY']);
    expect(plan.diff).toBeNull();
  });

  test('returns add action with empty envCheck when env provides all required keys', async () => {
    const home = await makeHome();

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      env: { CONTEXT7_API_KEY: 'real-key' }
    });

    expect(plan.action).toBe('add');
    expect(plan.envCheck.missing).toEqual([]);
  });

  test('returns conflict action when server exists but is not peaks-managed', async () => {
    const home = await makeHome();
    await writeGlobalSettings(home, {
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'], env: { CONTEXT7_API_KEY: 'x' } }
      }
    });

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json'),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(plan.action).toBe('conflict');
    expect(plan.current?.source).toBe('unknown');
    expect(plan.nextActions.join(' ')).toMatch(/--claim|claim/i);
  });

  test('returns noop action when peaks-managed server already matches spec', async () => {
    const home = await makeHome();
    await writeGlobalSettings(home, {
      mcpServers: {
        context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'], env: { CONTEXT7_API_KEY: 'x' } }
      }
    });
    await writeManagedMarker(home, ['context7']);

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json'),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(plan.action).toBe('noop');
    expect(plan.diff).toBeNull();
  });

  test('returns update action with diff when peaks-managed server differs in args or command', async () => {
    const home = await makeHome();
    await writeGlobalSettings(home, {
      mcpServers: {
        context7: { command: 'node', args: ['old.js'], env: {} }
      }
    });
    await writeManagedMarker(home, ['context7']);

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      managedMarkerPath: join(home, '.peaks', 'mcp-managed.json'),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(plan.action).toBe('update');
    expect(plan.diff?.command).toEqual({ before: 'node', after: 'npx' });
    expect(plan.diff?.args?.before).toEqual(['old.js']);
    expect(plan.diff?.envKeys?.before).toEqual([]);
    expect(plan.diff?.envKeys?.after).toEqual(['CONTEXT7_API_KEY']);
  });

  test('falls back to process.env when env option is omitted', async () => {
    const home = await makeHome();
    const previous = process.env.CONTEXT7_API_KEY;
    process.env.CONTEXT7_API_KEY = 'real';

    try {
      const plan = await planMcpInstall('context7.docs-lookup', {
        globalSettingsPath: join(home, '.claude', 'settings.json')
      });

      expect(plan.action).toBe('add');
      expect(plan.envCheck.missing).toEqual([]);
    } finally {
      if (previous === undefined) {
        delete process.env.CONTEXT7_API_KEY;
      } else {
        process.env.CONTEXT7_API_KEY = previous;
      }
    }
  });

  test('passes projectRoot through to the scan when provided', async () => {
    const home = await makeHome();
    const project = await makeHome();

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      projectRoot: project,
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(plan.action).toBe('add');
  });

  test('treats empty-string env values as missing', async () => {
    const home = await makeHome();

    const plan = await planMcpInstall('context7.docs-lookup', {
      globalSettingsPath: join(home, '.claude', 'settings.json'),
      env: { CONTEXT7_API_KEY: '' }
    });

    expect(plan.envCheck.missing).toEqual(['CONTEXT7_API_KEY']);
  });
});
