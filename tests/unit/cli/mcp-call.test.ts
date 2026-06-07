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

describe('peaks mcp call', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await cleanMcpHomeState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('calls an MCP tool via injected transport factory and returns the result', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'context7.docs-lookup',
      toolName: 'lookup',
      result: { content: [{ type: 'text', text: 'spy-result' }] }
    });

    const result = await runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--args-json', '{"query":"react"}', '--json']);
    const output = parseJsonOutput<{ result: { content: Array<{ text: string }> } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('mcp.call');
    expect(output.data.result.content[0]?.text).toBe('spy-result');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      capabilityId: 'context7.docs-lookup',
      toolName: 'lookup',
      args: { query: 'react' }
    }));
    spy.mockRestore();
  });

  test('reads tool args from a JSON file when --args is passed', async () => {
    const { writeFile } = await import('node:fs/promises');
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'context7.docs-lookup',
      toolName: 'lookup',
      result: { ok: true }
    });
    const argsPath = join(homeDir, 'call-args.json');
    await writeFile(argsPath, JSON.stringify({ query: 'from-file' }), 'utf8');

    const result = await runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--args', argsPath, '--json']);

    expect(result.exitCode).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ args: { query: 'from-file' } }));
    spy.mockRestore();
  });

  test('forwards --timeout to the call service as timeoutMs', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockResolvedValueOnce({
      capabilityId: 'context7.docs-lookup',
      toolName: 'lookup',
      result: {}
    });

    await runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--timeout', '5000', '--json']);

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5000 }));
    spy.mockRestore();
  });

  test('rejects mcp call when both --args and --args-json are passed', async () => {
    const result = await runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--args', join(homeDir, 'irrelevant.json'), '--args-json', '{}', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_CALL_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('rejects mcp call when args JSON is not an object', async () => {
    const result = await runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--args-json', '"a string"', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_CALL_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('returns MCP_CALL_FAILED when the call service throws', async () => {
    const callModule = await import('../../../src/services/mcp/mcp-call-service.js');
    const spy = vi.spyOn(callModule, 'callMcpTool').mockRejectedValueOnce(new Error('synthetic call failure'));

    const result = await runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--args-json', '{}', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MCP_CALL_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('rejects --timeout with a non-positive value via the Commander parser', async () => {
    await expect(
      runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--timeout', '-5', '--json'])
    ).rejects.toThrowError(/positive integer/i);
  });

  test('rejects --timeout 0 via the Commander parser', async () => {
    await expect(
      runCommand(['mcp', 'call', '--capability', 'context7.docs-lookup', '--tool', 'lookup', '--timeout', '0', '--json'])
    ).rejects.toThrowError(/positive integer/i);
  });
});
