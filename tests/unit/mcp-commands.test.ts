import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join: joinSync } = require('node:path') as typeof import('node:path');
  return mkdtempSync(joinSync(tmpdir(), 'peaks-mcp-cli-home-'));
});

describe('peaks mcp commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('prints empty mcp list when no settings exist', async () => {
    const result = await runCommand(['mcp', 'list', '--json']);
    const output = parseJsonOutput<{ servers: unknown[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('mcp.list');
    expect(output.data.servers).toEqual([]);
  });

  test('scan alias also runs mcp list', async () => {
    const result = await runCommand(['mcp', 'scan', '--json']);
    const output = parseJsonOutput<{ servers: unknown[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('mcp.list');
  });

  test('scans project-scope settings when --project is provided', async () => {
    const project = join(homeDir, 'projectA');
    await mkdir(join(project, '.claude'), { recursive: true });
    await writeFile(
      join(project, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { chrome: { command: 'chrome-devtools-mcp', args: [], env: {} } } }),
      'utf8'
    );

    const result = await runCommand(['mcp', 'list', '--project', project, '--json']);
    const output = parseJsonOutput<{ servers: Array<{ name: string; scope: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.servers.some((server) => server.name === 'chrome' && server.scope === 'project')).toBe(true);
  });

  test('plans an MCP install for a known capability and returns add action when missing', async () => {
    const result = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--json']);
    const output = parseJsonOutput<{ action: string; envCheck: { missing: string[] } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('mcp.plan');
    expect(output.data.action).toBe('add');
  });

  test('rejects unknown capability with MCP_UNKNOWN_CAPABILITY envelope', async () => {
    const result = await runCommand(['mcp', 'plan', '--capability', 'nope.nope', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_UNKNOWN_CAPABILITY');
    expect(result.exitCode).toBe(1);
  });

  test('rejects non-dry-run mcp plan', async () => {
    const result = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
    expect(result.exitCode).toBe(1);
  });

  test('returns MCP_PLAN_FAILED envelope when planner throws', async () => {
    const planModule = await import('../../src/services/mcp/mcp-plan-service.js');
    const spy = vi.spyOn(planModule, 'planMcpInstall').mockRejectedValueOnce(new Error('synthetic plan failure'));

    const result = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_PLAN_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('plan accepts --project option', async () => {
    const project = join(homeDir, 'plan-project');
    await mkdir(project, { recursive: true });
    const result = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--project', project, '--json']);
    const output = parseJsonOutput<{ action: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.action).toBe('add');
  });

  test('returns MCP_LIST_FAILED envelope when scan throws', async () => {
    const mcpModule = await import('../../src/services/mcp/mcp-scan-service.js');
    const spy = vi.spyOn(mcpModule, 'scanMcpServers').mockRejectedValueOnce(new Error('synthetic mcp failure'));

    const result = await runCommand(['mcp', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_LIST_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});
