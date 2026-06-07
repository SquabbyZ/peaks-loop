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

describe('peaks mcp apply', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('refuses mcp apply without --yes', async () => {
    const result = await runCommand(['mcp', 'apply', '--capability', 'context7.docs-lookup', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_APPLY_REQUIRES_YES');
    expect(result.exitCode).toBe(1);
  });

  test('applies an MCP install with --yes and reports the action', async () => {
    const { readFile } = await import('node:fs/promises');
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
    const { mkdir, writeFile } = await import('node:fs/promises');
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
    const { mkdir, writeFile } = await import('node:fs/promises');
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
    const { mkdir } = await import('node:fs/promises');
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
});
