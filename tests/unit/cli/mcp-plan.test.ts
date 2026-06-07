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

describe('peaks mcp plan', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    const planModule = await import('../../../src/services/mcp/mcp-plan-service.js');
    const spy = vi.spyOn(planModule, 'planMcpInstall').mockRejectedValueOnce(new Error('synthetic plan failure'));

    const result = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_PLAN_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('plan accepts --project option', async () => {
    const { mkdir } = await import('node:fs/promises');
    const project = join(homeDir, 'plan-project');
    await mkdir(project, { recursive: true });
    const result = await runCommand(['mcp', 'plan', '--capability', 'context7.docs-lookup', '--project', project, '--json']);
    const output = parseJsonOutput<{ action: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.action).toBe('add');
  });
});
