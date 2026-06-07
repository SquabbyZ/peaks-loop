/**
 * Integration test: context7 MCP is fully decoupled from peak-skill
 * consumers via `peaks mcp plan/apply/call`.
 *
 * Decoupling contract:
 *  - Capability id must be exactly `context7.docs-lookup`.
 *  - The install requires env var CONTEXT7_API_KEY.
 *  - Skill bodies that need library docs must use `peaks mcp call`
 *    with capability `context7.docs-lookup`. Tool names include
 *    `resolve-library-id`, `get-library-docs`, etc.
 *  - Apply must refuse without CONTEXT7_API_KEY set.
 *  - Apply must succeed with the env var set; subsequent call must
 *    be able to invoke a tool.
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

describe('context7 MCP decouple integration', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('capability id `context7.docs-lookup` is in the install registry', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    const spec = registry.findMcpInstallSpec('context7.docs-lookup');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('context7');
    expect(spec!.command).toBe('npx');
    expect(spec!.scope).toBe('global');
    expect(spec!.envKeys).toContain('CONTEXT7_API_KEY');
  });

  test('plan reports CONTEXT7_API_KEY as missing when env var is unset', async () => {
    const plan = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--json']);
    const planOut = parseJsonOutput<{ envCheck: { missing: string[] } }>(plan.stdout);
    expect(planOut.ok).toBe(true);
    expect(planOut.data.envCheck.missing).toContain('CONTEXT7_API_KEY');
  });

  test('apply refuses when CONTEXT7_API_KEY is missing', async () => {
    const apply = await runCommand(
      ['mcp', 'apply', '--capability', 'context7.docs-lookup', '--yes', '--json']
    );
    const applyOut = parseJsonOutput(apply.stdout);
    expect(applyOut.ok).toBe(false);
    expect(applyOut.code).toBe('MCP_APPLY_FAILED');
    expect(applyOut.message).toMatch(/CONTEXT7_API_KEY/);
  });

  test('apply succeeds with CONTEXT7_API_KEY and context7 is listed', async () => {
    const apply = await runCommand(
      ['mcp', 'apply', '--capability', 'context7.docs-lookup', '--yes', '--json'],
      { CONTEXT7_API_KEY: 'ctx7_test_token' }
    );
    const applyOut = parseJsonOutput<{ action: string }>(apply.stdout);
    expect(applyOut.ok).toBe(true);
    expect(applyOut.data.action).toBe('add');

    const list = await runCommand(['mcp', 'list', '--json']);
    const listOut = parseJsonOutput<{ servers: Array<{ name: string }> }>(list.stdout);
    expect(listOut.data.servers.some((s: { name: string }) => s.name === 'context7')).toBe(true);
  });

  test('context7 tool call is routed through peaks mcp call', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'context7.docs-lookup',
      toolName: 'resolve-library-id',
      result: { libraryId: '/react/dom' }
    });

    const result = await runCommand([
      'mcp', 'call',
      '--capability', 'context7.docs-lookup',
      '--tool', 'resolve-library-id',
      '--args-json', '{"query":"react"}',
      '--json'
    ]);
    const out = parseJsonOutput(result.stdout);

    expect(out.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: 'context7.docs-lookup',
      toolName: 'resolve-library-id',
      args: { query: 'react' }
    }));
    spy.mockRestore();
  });

  test('context7 capability is the canonical id (no aliases)', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    for (const alias of ['context7', 'docs-lookup', 'c7', 'upstash', 'context7-mcp', 'context7.docs']) {
      expect(registry.findMcpInstallSpec(alias)).toBeNull();
    }
    expect(registry.findMcpInstallSpec('context7.docs-lookup')).not.toBeNull();
  });
});
