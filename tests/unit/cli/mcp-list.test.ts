import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from '../cli-program-test-utils.js';

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

describe('peaks mcp list', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
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
    const { mkdir, writeFile } = await import('node:fs/promises');
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

  test('returns MCP_LIST_FAILED envelope when scan throws', async () => {
    const mcpModule = await import('../../../src/services/mcp/mcp-scan-service.js');
    const spy = vi.spyOn(mcpModule, 'scanMcpServers').mockRejectedValueOnce(new Error('synthetic mcp failure'));

    const result = await runCommand(['mcp', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_LIST_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});
