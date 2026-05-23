import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pathExists } from '../../src/shared/fs.js';
import { applyMcpInstall, rollbackMcpInstall } from '../../src/services/mcp/mcp-apply-service.js';

async function makeHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-mcp-apply-'));
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

const FIXED_TS = '2026-05-23T12-00-00-000Z';
const stableClock = (): string => FIXED_TS;

function applyOptions(home: string): {
  globalSettingsPath: string;
  managedMarkerPath: string;
  backupRoot: string;
  clock: () => string;
} {
  return {
    globalSettingsPath: join(home, '.claude', 'settings.json'),
    managedMarkerPath: join(home, '.peaks', 'mcp-managed.json'),
    backupRoot: join(home, '.peaks-artifacts', 'mcp-backups'),
    clock: stableClock
  };
}

describe('applyMcpInstall', () => {
  test('rejects unknown-capability without writing anything', async () => {
    const home = await makeHome();

    await expect(
      applyMcpInstall('does.not.exist', { ...applyOptions(home), env: { CONTEXT7_API_KEY: 'x' } })
    ).rejects.toThrowError(/unknown.*capability/i);

    expect(await pathExists(join(home, '.claude', 'settings.json'))).toBe(false);
  });

  test('rejects apply when required env vars are missing', async () => {
    const home = await makeHome();

    await expect(
      applyMcpInstall('context7.docs-lookup', { ...applyOptions(home), env: {} })
    ).rejects.toThrowError(/CONTEXT7_API_KEY/);

    expect(await pathExists(join(home, '.claude', 'settings.json'))).toBe(false);
  });

  test('adds a new server, backs up empty state, and registers it in the managed marker', async () => {
    const home = await makeHome();

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('add');
    expect(result.backup.path).toBeNull();
    expect(result.backup.skipped).toBe(false);
    expect(result.written.settingsPath).toBe(join(home, '.claude', 'settings.json'));

    const settings = await readJson(join(home, '.claude', 'settings.json'));
    const mcpServers = settings.mcpServers as Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    expect(mcpServers.context7?.command).toBe('npx');
    expect(mcpServers.context7?.env).toEqual({ CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}' });

    const marker = await readJson(join(home, '.peaks', 'mcp-managed.json'));
    expect(marker.servers).toEqual(['context7']);
  });

  test('updates a peaks-managed server when command or args differ and backs up prior settings', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'node', args: ['old.js'], env: {} } }
    });
    await writeJson(join(home, '.peaks', 'mcp-managed.json'), { servers: ['context7'] });

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('update');
    expect(result.backup.path).toBe(join(home, '.peaks-artifacts', 'mcp-backups', FIXED_TS, 'settings.json'));
    expect(result.backup.skipped).toBe(false);

    const backup = await readJson(result.backup.path as string);
    const backupMcp = backup.mcpServers as Record<string, { command: string }>;
    expect(backupMcp.context7?.command).toBe('node');

    const settings = await readJson(join(home, '.claude', 'settings.json'));
    const mcpServers = settings.mcpServers as Record<string, { command: string }>;
    expect(mcpServers.context7?.command).toBe('npx');
  });

  test('refuses to overwrite a non-peaks-managed server without claim', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'node', args: [], env: {} } }
    });

    await expect(
      applyMcpInstall('context7.docs-lookup', { ...applyOptions(home), env: { CONTEXT7_API_KEY: 'x' } })
    ).rejects.toThrowError(/conflict/i);

    const settings = await readJson(join(home, '.claude', 'settings.json'));
    expect((settings.mcpServers as Record<string, { command: string }>).context7?.command).toBe('node');
  });

  test('claims and overwrites a non-peaks-managed server when --claim is passed', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'node', args: [], env: {} } }
    });

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' },
      claim: true
    });

    expect(result.action).toBe('claimed');
    expect(result.backup.path).toBe(join(home, '.peaks-artifacts', 'mcp-backups', FIXED_TS, 'settings.json'));

    const marker = await readJson(join(home, '.peaks', 'mcp-managed.json'));
    expect(marker.servers).toEqual(['context7']);

    const settings = await readJson(join(home, '.claude', 'settings.json'));
    expect((settings.mcpServers as Record<string, { command: string }>).context7?.command).toBe('npx');
  });

  test('returns noop when peaks-managed server already matches and writes nothing new', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'], env: { CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}' } } }
    });
    await writeJson(join(home, '.peaks', 'mcp-managed.json'), { servers: ['context7'] });

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('noop');
    expect(result.backup.skipped).toBe(true);
    expect(result.backup.path).toBeNull();

    expect(await pathExists(join(home, '.peaks-artifacts', 'mcp-backups', FIXED_TS, 'settings.json'))).toBe(false);
  });

  test('preserves unrelated mcpServers entries when adding a new server', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { other: { command: 'noop', args: [], env: {} } }
    });

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('add');
    const settings = await readJson(join(home, '.claude', 'settings.json'));
    const mcpServers = settings.mcpServers as Record<string, unknown>;
    expect(Object.keys(mcpServers).sort()).toEqual(['context7', 'other']);
  });

  test('does not duplicate the managed marker entry when re-running update', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.peaks', 'mcp-managed.json'), { servers: ['context7'] });
    await writeJson(join(home, '.claude', 'settings.json'), {
      mcpServers: { context7: { command: 'node', args: ['old.js'], env: {} } }
    });

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('update');
    const marker = await readJson(join(home, '.peaks', 'mcp-managed.json'));
    expect(marker.servers).toEqual(['context7']);
  });

  test('treats empty settings.json file as having no servers and still backs it up', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '', 'utf8');

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('add');
    expect(result.backup.path).toBe(join(home, '.peaks-artifacts', 'mcp-backups', FIXED_TS, 'settings.json'));
    const settings = await readJson(join(home, '.claude', 'settings.json'));
    expect((settings.mcpServers as Record<string, unknown>).context7).toBeDefined();
  });

  test('treats non-object settings.json (array) as having no servers', async () => {
    const home = await makeHome();
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'settings.json'), '[]', 'utf8');

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('add');
    const settings = await readJson(join(home, '.claude', 'settings.json'));
    expect((settings.mcpServers as Record<string, unknown>).context7).toBeDefined();
  });

  test('handles a managed marker that lacks the servers field', async () => {
    const home = await makeHome();
    await writeJson(join(home, '.peaks', 'mcp-managed.json'), { other: 'value' });

    const result = await applyMcpInstall('context7.docs-lookup', {
      ...applyOptions(home),
      env: { CONTEXT7_API_KEY: 'x' }
    });

    expect(result.action).toBe('add');
    const marker = await readJson(join(home, '.peaks', 'mcp-managed.json'));
    expect(marker.servers).toEqual(['context7']);
    expect(marker.other).toBe('value');
  });

  test('falls back to homedir-based defaults when paths and clock are omitted', async () => {
    const home = await makeHome();
    const previous = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY
    };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.CONTEXT7_API_KEY = 'x';
    try {
      const result = await applyMcpInstall('context7.docs-lookup');

      expect(result.action).toBe('add');
      expect(result.written.settingsPath).toBe(join(home, '.claude', 'settings.json'));
      expect(result.written.managedMarkerPath).toBe(join(home, '.peaks', 'mcp-managed.json'));
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});

describe('rollbackMcpInstall', () => {
  test('restores settings.json from a named backup', async () => {
    const home = await makeHome();
    const backupPath = join(home, '.peaks-artifacts', 'mcp-backups', '2026-old', 'settings.json');
    await writeJson(backupPath, { mcpServers: { context7: { command: 'old-binary', args: [], env: {} } } });
    await writeJson(join(home, '.claude', 'settings.json'), { mcpServers: { context7: { command: 'npx', args: [] } } });

    const result = await rollbackMcpInstall({
      backupPath,
      globalSettingsPath: join(home, '.claude', 'settings.json')
    });

    expect(result.restoredFrom).toBe(backupPath);
    expect(result.restoredTo).toBe(join(home, '.claude', 'settings.json'));

    const settings = await readJson(join(home, '.claude', 'settings.json'));
    expect((settings.mcpServers as Record<string, { command: string }>).context7?.command).toBe('old-binary');
  });

  test('throws when backup path does not exist', async () => {
    const home = await makeHome();

    await expect(
      rollbackMcpInstall({
        backupPath: join(home, 'missing', 'settings.json'),
        globalSettingsPath: join(home, '.claude', 'settings.json')
      })
    ).rejects.toThrowError(/backup/i);
  });

  test('defaults globalSettingsPath to ~/.claude/settings.json when omitted', async () => {
    const home = await makeHome();
    const backupPath = join(home, 'backups', 'settings.json');
    await writeJson(backupPath, { mcpServers: {} });

    const previous = process.env.HOME;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      const result = await rollbackMcpInstall({ backupPath });
      expect(result.restoredTo).toBe(join(home, '.claude', 'settings.json'));
    } finally {
      if (previous === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previous;
      }
    }
  });
});
