/**
 * Integration test: chrome-devtools MCP is fully decoupled from peak-skill
 * consumers via `peaks mcp plan/apply/call`.
 *
 * Decoupling contract:
 *  - Capability id must be exactly `chrome-devtools-mcp.browser-debug`.
 *  - The install command is `npx -y chrome-devtools-mcp@latest`.
 *  - chrome-devtools MCP is a SECONDARY surface (CDP to an existing Chrome
 *    on :9222); it does NOT launch a browser. SKILL.md bodies must not
 *    call chrome-devtools MCP for user-flow E2E — playwright is the
 *    primary surface.
 *  - Skill bodies that need CDP inspection must use `peaks mcp call`
 *    with capability `chrome-devtools-mcp.browser-debug`.
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

describe('chrome-devtools MCP decouple integration', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('capability id `chrome-devtools-mcp.browser-debug` is in the install registry', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    const spec = registry.findMcpInstallSpec('chrome-devtools-mcp.browser-debug');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('chrome-devtools');
    expect(spec!.command).toBe('npx');
    expect(spec!.scope).toBe('global');
  });

  test('full plan → apply → list cycle installs chrome-devtools into .claude/settings.json', async () => {
    const plan = await runCommand(['mcp', 'plan', '--capability', 'chrome-devtools-mcp.browser-debug', '--json']);
    const planOut = parseJsonOutput<{ action: string }>(plan.stdout);
    expect(planOut.ok).toBe(true);
    expect(planOut.data.action).toBe('add');

    const apply = await runCommand(
      ['mcp', 'apply', '--capability', 'chrome-devtools-mcp.browser-debug', '--yes', '--json']
    );
    const applyOut = parseJsonOutput<{ action: string }>(apply.stdout);
    expect(applyOut.ok).toBe(true);
    expect(applyOut.data.action).toBe('add');

    const list = await runCommand(['mcp', 'list', '--json']);
    const listOut = parseJsonOutput<{ servers: Array<{ name: string }> }>(list.stdout);
    expect(listOut.data.servers.some((s: { name: string }) => s.name === 'chrome-devtools')).toBe(true);
  });

  test('chrome-devtools tool call is routed through peaks mcp call', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'chrome-devtools-mcp.browser-debug',
      toolName: 'list_pages',
      result: { pages: [] }
    });

    const result = await runCommand([
      'mcp', 'call',
      '--capability', 'chrome-devtools-mcp.browser-debug',
      '--tool', 'list_pages',
      '--args-json', '{}',
      '--json'
    ]);
    const out = parseJsonOutput(result.stdout);

    expect(out.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: 'chrome-devtools-mcp.browser-debug',
      toolName: 'list_pages'
    }));
    spy.mockRestore();
  });

  test('chrome-devtools-mcp capability is the canonical id (no aliases)', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    for (const alias of ['chrome-devtools', 'cdp', 'chrome-devtools-mcp', 'browser-debug', 'devtools']) {
      expect(registry.findMcpInstallSpec(alias)).toBeNull();
    }
    expect(registry.findMcpInstallSpec('chrome-devtools-mcp.browser-debug')).not.toBeNull();
  });
});
