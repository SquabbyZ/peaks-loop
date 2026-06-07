/**
 * Integration test: figma MCP is fully decoupled from peak-skill consumers
 * via `peaks mcp plan/apply/call`.
 *
 * Decoupling contract:
 *  - Capability id must be exactly `figma-context-mcp.design-context`.
 *  - The install requires env var FIGMA_API_KEY (enforced at plan time).
 *  - Skill bodies that need Figma data must use `peaks mcp call`
 *    with capability `figma-context-mcp.design-context`. Tool names
 *    include `get_figma_data`, `download_figma_images`, etc.
 *  - Plan must report envCheck.missing = ['FIGMA_API_KEY'] when the
 *    env var is unset, and apply must refuse until the env var is set.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from '../../unit/cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function cleanMcpHomeState(): Promise<void> {
  for (const sub of ['.claude', '.peaks-artifacts']) {
    if (existsSync(join(homeDir, sub))) {
      await (await import('node:fs/promises')).rm(join(homeDir, sub), { recursive: true, force: true });
    }
  }
  if (existsSync(join(homeDir, '.peaks', 'mcp-managed.json'))) {
    await (await import('node:fs/promises')).rm(join(homeDir, '.peaks', 'mcp-managed.json'), { force: true });
  }
}

describe('figma MCP decouple integration', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('capability id `figma-context-mcp.design-context` is in the install registry', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    const spec = registry.findMcpInstallSpec('figma-context-mcp.design-context');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('figma');
    expect(spec!.command).toBe('npx');
    expect(spec!.scope).toBe('global');
    expect(spec!.envKeys).toContain('FIGMA_API_KEY');
  });

  test('plan reports FIGMA_API_KEY as missing when env var is unset', async () => {
    const plan = await runCommand(['mcp', 'plan', '--capability', 'figma-context-mcp.design-context', '--json']);
    const planOut = parseJsonOutput<{ envCheck: { missing: string[] }; nextActions: string[] }>(plan.stdout);
    expect(planOut.ok).toBe(true);
    expect(planOut.data.envCheck.missing).toContain('FIGMA_API_KEY');
    expect(planOut.data.nextActions.some((a) => a.includes('FIGMA_API_KEY'))).toBe(true);
  });

  test('apply refuses when FIGMA_API_KEY is missing (load-bearing env check)', async () => {
    const apply = await runCommand(
      ['mcp', 'apply', '--capability', 'figma-context-mcp.design-context', '--yes', '--json']
    );
    const applyOut = parseJsonOutput(apply.stdout);
    expect(applyOut.ok).toBe(false);
    expect(applyOut.code).toBe('MCP_APPLY_FAILED');
    expect(applyOut.message).toMatch(/FIGMA_API_KEY/);
  });

  test('apply succeeds with FIGMA_API_KEY and figma is listed', async () => {
    const apply = await runCommand(
      ['mcp', 'apply', '--capability', 'figma-context-mcp.design-context', '--yes', '--json'],
      { FIGMA_API_KEY: 'figd_test_token' }
    );
    const applyOut = parseJsonOutput<{ action: string }>(apply.stdout);
    expect(applyOut.ok).toBe(true);
    expect(applyOut.data.action).toBe('add');

    const list = await runCommand(['mcp', 'list', '--json']);
    const listOut = parseJsonOutput<{ servers: Array<{ name: string }> }>(list.stdout);
    expect(listOut.data.servers.some((s: { name: string }) => s.name === 'figma')).toBe(true);
  });

  test('figma tool call is routed through peaks mcp call', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'figma-context-mcp.design-context',
      toolName: 'get_figma_data',
      result: { document: { name: 'mock' } }
    });

    const result = await runCommand([
      'mcp', 'call',
      '--capability', 'figma-context-mcp.design-context',
      '--tool', 'get_figma_data',
      '--args-json', '{"fileKey":"abc123"}',
      '--json'
    ]);
    const out = parseJsonOutput(result.stdout);

    expect(out.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: 'figma-context-mcp.design-context',
      toolName: 'get_figma_data',
      args: { fileKey: 'abc123' }
    }));
    spy.mockRestore();
  });

  test('figma-context-mcp capability is the canonical id (no aliases)', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    for (const alias of ['figma', 'figma-mcp', 'design-context', 'figma-developer', 'figma-developer-mcp']) {
      expect(registry.findMcpInstallSpec(alias)).toBeNull();
    }
    expect(registry.findMcpInstallSpec('figma-context-mcp.design-context')).not.toBeNull();
  });
});
