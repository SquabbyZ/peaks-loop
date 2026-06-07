/**
 * Integration test: playwright MCP is fully decoupled from peak-skill
 * consumers via `peaks mcp plan/apply/call`.
 *
 * Decoupling contract:
 *  - peaks-solo / peaks-rd / peaks-qa / peaks-ui SKILL.md bodies that need
 *    a Playwright browser must:
 *      1. Detect install: `peaks mcp list --json | grep playwright`
 *      2. Plan:          `peaks mcp plan --capability playwright-mcp.browser-validation --json`
 *      3. Apply:         `peaks mcp apply --capability playwright-mcp.browser-validation --yes --json`
 *      4. Call tools:    `peaks mcp call --capability playwright-mcp.browser-validation --tool <toolName> --args-json '<args>' --json`
 *  - The capability id must be exactly `playwright-mcp.browser-validation`.
 *  - The skill body must NEVER bake in the `mcp__playwright__` tool prefix;
 *    the prefix is owned by Claude Code's runtime, not by the skill.
 *
 * This integration test asserts all three contracts at the CLI surface,
 * not at the skill body (skill body is enforced by `peaks skill doctor`).
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

describe('playwright MCP decouple integration', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('capability id `playwright-mcp.browser-validation` is in the install registry', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    const spec = registry.findMcpInstallSpec('playwright-mcp.browser-validation');
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe('playwright');
    expect(spec!.command).toBe('npx');
    expect(spec!.scope).toBe('global');
  });

  test('full plan → apply → list cycle installs playwright into .claude/settings.json', async () => {
    const plan = await runCommand(['mcp', 'plan', '--capability', 'playwright-mcp.browser-validation', '--json']);
    const planOut = parseJsonOutput<{ action: string; spec: { name: string } | null }>(plan.stdout);
    expect(planOut.ok).toBe(true);
    expect(planOut.data.action).toBe('add');
    expect(planOut.data.spec?.name).toBe('playwright');

    const apply = await runCommand(
      ['mcp', 'apply', '--capability', 'playwright-mcp.browser-validation', '--yes', '--json']
    );
    const applyOut = parseJsonOutput<{ action: string }>(apply.stdout);
    expect(applyOut.ok).toBe(true);
    expect(applyOut.data.action).toBe('add');

    const list = await runCommand(['mcp', 'list', '--json']);
    const listOut = parseJsonOutput<{ servers: Array<{ name: string; scope: string }> }>(list.stdout);
    expect(listOut.data.servers.some((s: { name: string; scope: string }) => s.name === 'playwright' && s.scope === 'global')).toBe(true);
  });

  test('playwright tool call is routed through peaks mcp call (not direct mcp__ invocation)', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'playwright-mcp.browser-validation',
      toolName: 'browser_navigate',
      result: { ok: true }
    });

    const result = await runCommand([
      'mcp', 'call',
      '--capability', 'playwright-mcp.browser-validation',
      '--tool', 'browser_navigate',
      '--args-json', '{"url":"http://localhost:3000"}',
      '--json'
    ]);
    const out = parseJsonOutput<{ result: { ok: boolean } }>(result.stdout);

    expect(out.ok).toBe(true);
    expect(out.data.result.ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: 'playwright-mcp.browser-validation',
      toolName: 'browser_navigate',
      args: { url: 'http://localhost:3000' }
    }));
    spy.mockRestore();
  });

  test('playwright-mcp capability is the canonical id (no aliases)', async () => {
    const registry = await import('../../../src/services/mcp/mcp-install-registry.js');
    // Reject common misspellings / aliases that the skill body must not introduce
    for (const alias of ['playwright', 'playwright.browser', 'playwright-mcp', 'browser', 'browser-validation']) {
      expect(registry.findMcpInstallSpec(alias)).toBeNull();
    }
    expect(registry.findMcpInstallSpec('playwright-mcp.browser-validation')).not.toBeNull();
  });
});
