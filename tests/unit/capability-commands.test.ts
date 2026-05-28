import { describe, expect, test, vi, beforeEach } from 'vitest';

const mockReadConfig = vi.fn();
vi.mock('../../src/services/config/config-service.js', () => ({
  readConfig: () => mockReadConfig()
}));

import { getInstalledCapabilityIds, parseCapabilityMapSource, runCapabilityMap, runCapabilityStatus } from '../../src/cli/commands/capability-commands.js';
import type { PeaksConfig } from '../../src/services/config/config-types.js';

function createConfig(): PeaksConfig {
  return {
    version: '0.1.0', language: 'en', model: 'sonnet',
    economyMode: true, swarmMode: true,
    tokens: {}, providers: {}, proxy: {}
  };
}

function createIO() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    getStdout: () => stdout.join('\n'),
    getStderr: () => stderr.join('\n')
  };
}

describe('getInstalledCapabilityIds', () => {
  test('returns empty array', () => {
    expect(getInstalledCapabilityIds(createConfig())).toEqual([]);
  });
});

describe('parseCapabilityMapSource', () => {
  test('accepts all valid source filters', () => {
    expect(parseCapabilityMapSource('all')).toBe('all');
    expect(parseCapabilityMapSource('access-repo')).toBe('access-repo');
    expect(parseCapabilityMapSource('mcp-server')).toBe('mcp-server');
  });
  test('returns null for unsupported values', () => {
    expect(parseCapabilityMapSource('invalid')).toBeNull();
    expect(parseCapabilityMapSource('')).toBeNull();
  });
});

describe('runCapabilityStatus', () => {
  test('returns capability status with sources, items and availability', () => {
    const io = createIO();
    runCapabilityStatus(io, { json: true });
    const data = JSON.parse(io.getStdout());
    expect(data.ok).toBe(true);
    expect(data.command).toBe('capability.status');
    expect(data.data.sources).toBeDefined();
    expect(data.data.items).toBeDefined();
    expect(data.data.availability).toBeDefined();
  });
});

describe('runCapabilityMap', () => {
  beforeEach(() => { mockReadConfig.mockReturnValue(createConfig()); });

  test('returns plan for all source with json', () => {
    const io = createIO();
    runCapabilityMap(io, { source: 'all', json: true });
    const data = JSON.parse(io.getStdout());
    expect(data.ok).toBe(true);
    expect(data.command).toBe('capabilities.map');
  });

  test('returns plan for access-repo source', () => {
    const io = createIO();
    runCapabilityMap(io, { source: 'access-repo', json: true });
    expect(JSON.parse(io.getStdout()).ok).toBe(true);
  });

  test('returns plan for mcp-server source', () => {
    const io = createIO();
    runCapabilityMap(io, { source: 'mcp-server', json: true });
    expect(JSON.parse(io.getStdout()).ok).toBe(true);
  });

  test('returns error for unsupported source', () => {
    const io = createIO();
    runCapabilityMap(io, { source: 'invalid', json: true });
    const data = JSON.parse(io.getStdout());
    expect(data.ok).toBe(false);
    expect(data.code).toBe('UNSUPPORTED_CAPABILITY_SOURCE');
  });

  test('handles config with httpProxy', () => {
    const config = createConfig();
    config.proxy = { httpProxy: 'http://proxy:8080' };
    mockReadConfig.mockReturnValue(config);
    const io = createIO();
    runCapabilityMap(io, { source: 'all', json: true });
    expect(JSON.parse(io.getStdout()).ok).toBe(true);
  });
});

import { Command } from 'commander';
import { registerCapabilityCommands } from '../../src/cli/commands/capability-commands.js';

describe('registerCapabilityCommands', () => {
  test('registers capability, capabilities, and status commands', () => {
    const io = createIO();
    const program = new Command();
    program.exitOverride();
    registerCapabilityCommands(program, io);
    const cmds = program.commands.map(c => c.name());
    expect(cmds).toContain('capability');
    expect(cmds).toContain('capabilities');
    const capCmd = program.commands.find(c => c.name() === 'capability');
    expect(capCmd).toBeDefined();
    const subCmds = capCmd!.commands.map(c => c.name());
    expect(subCmds).toContain('status');
    expect(subCmds).toContain('map');
  });
});
