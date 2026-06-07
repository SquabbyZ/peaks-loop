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

describe('peaks mcp rollback', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('rolls back to a backup file', async () => {
    const { mkdir, writeFile, readFile } = await import('node:fs/promises');
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
});
