import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function cleanMcpHomeState(): Promise<void> {
  for (const sub of ['.claude', '.peaks-artifacts']) {
    if (existsSync(join(homeDir, sub))) {
      await rm(join(homeDir, sub), { recursive: true, force: true });
    }
  }
  if (existsSync(join(homeDir, '.peaks', 'mcp-managed.json'))) {
    await rm(join(homeDir, '.peaks', 'mcp-managed.json'), { force: true });
  }
}

describe('peaks mcp commands', () => {
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

  test('refuses mcp apply without --yes', async () => {
    const result = await runCommand(['mcp', 'apply', '--capability', 'context7.docs-lookup', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_APPLY_REQUIRES_YES');
    expect(result.exitCode).toBe(1);
  });

  test('applies an MCP install with --yes and reports the action', async () => {
    const result = await runCommand(
      ['mcp', 'apply', '--capability', 'context7.docs-lookup', '--yes', '--json'],
      { CONTEXT7_API_KEY: 'x' }
    );
    const output = parseJsonOutput<{ action: string; written: { settingsPath: string } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.action).toBe('add');

    const settings = JSON.parse(await readFile(join(homeDir, '.claude', 'settings.json'), 'utf8')) as { mcpServers: Record<string, unknown> };
    expect(settings.mcpServers.context7).toBeDefined();
  });

  test('returns MCP_APPLY_FAILED envelope on conflict without --claim', async () => {
    await mkdir(join(homeDir, '.claude'), { recursive: true });
    await writeFile(
      join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { context7: { command: 'node', args: [], env: {} } } }),
      'utf8'
    );

    const result = await runCommand(
      ['mcp', 'apply', '--capability', 'context7.docs-lookup', '--yes', '--json'],
      { CONTEXT7_API_KEY: 'x' }
    );
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_APPLY_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('applies with --claim when an existing server is non-peaks-managed', async () => {
    await mkdir(join(homeDir, '.claude'), { recursive: true });
    await writeFile(
      join(homeDir, '.claude', 'settings.json'),
      JSON.stringify({ mcpServers: { context7: { command: 'node', args: [], env: {} } } }),
      'utf8'
    );

    const result = await runCommand(
      ['mcp', 'apply', '--capability', 'context7.docs-lookup', '--yes', '--claim', '--json'],
      { CONTEXT7_API_KEY: 'x' }
    );
    const output = parseJsonOutput<{ action: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.action).toBe('claimed');
  });

  test('passes --project through to apply', async () => {
    const project = join(homeDir, 'apply-project');
    await mkdir(project, { recursive: true });

    const result = await runCommand(
      ['mcp', 'apply', '--capability', 'context7.docs-lookup', '--yes', '--project', project, '--json'],
      { CONTEXT7_API_KEY: 'x' }
    );
    const output = parseJsonOutput<{ action: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.action).toBe('add');
  });

  test('rolls back to a backup file', async () => {
    const backupDir = join(homeDir, 'backup-snapshot');
    await mkdir(backupDir, { recursive: true });
    const backupPath = join(backupDir, 'settings.json');
    await writeFile(backupPath, JSON.stringify({ mcpServers: { context7: { command: 'restored', args: [], env: {} } } }), 'utf8');

    const result = await runCommand(['mcp', 'rollback', '--backup', backupPath, '--json']);
    const output = parseJsonOutput<{ restoredTo: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.restoredTo).toBe(join(homeDir, '.claude', 'settings.json'));

    const settings = JSON.parse(await readFile(join(homeDir, '.claude', 'settings.json'), 'utf8')) as { mcpServers: Record<string, { command: string }> };
    expect(settings.mcpServers.context7?.command).toBe('restored');
  });

  test('returns MCP_ROLLBACK_FAILED when backup file does not exist', async () => {
    const result = await runCommand(['mcp', 'rollback', '--backup', join(homeDir, 'missing.json'), '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_ROLLBACK_FAILED');
    expect(result.exitCode).toBe(1);
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
