import { existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function makeProject(name: string): Promise<string> {
  const project = join(homeDir, name);
  if (existsSync(project)) {
    await rm(project, { recursive: true, force: true });
  }
  await mkdir(project, { recursive: true });
  return project;
}

describe('peaks hooks install/uninstall/status', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('install writes a project PreToolUse hook and is idempotent', async () => {
    const project = await makeProject('hooks-install');
    const first = await runCommand(['hooks', 'install', '--project', project, '--json']);
    const firstOut = parseJsonOutput<{ applied: boolean; settingsPath: string; entries: Array<{ matcher: string; sentinel: string }> }>(first.stdout);
    expect(firstOut.ok).toBe(true);
    expect(firstOut.data.applied).toBe(true);
    expect(existsSync(firstOut.data.settingsPath)).toBe(true);
    // Slice #014: only the gate-enforce entry is installed.
    expect(firstOut.data.entries).toHaveLength(1);
    expect(firstOut.data.entries[0]?.sentinel).toBe('peaks gate enforce');

    const second = await runCommand(['hooks', 'install', '--project', project, '--json']);
    expect(parseJsonOutput<{ applied: boolean }>(second.stdout).data.applied).toBe(false);
  });

  test('dry-run does not write', async () => {
    const project = await makeProject('hooks-dryrun');
    const result = await runCommand(['hooks', 'install', '--project', project, '--dry-run', '--json']);
    const out = parseJsonOutput<{ applied: boolean; settingsPath: string; entries: Array<{ matcher: string; sentinel: string }> }>(result.stdout);
    expect(out.data.applied).toBe(false);
    expect(existsSync(out.data.settingsPath)).toBe(false);
    // Slice #014: dry-run preview also reports the gate-enforce-only shape.
    expect(out.data.entries).toHaveLength(1);
    expect(out.data.entries[0]?.sentinel).toBe('peaks gate enforce');
  });

  test('status reflects install then uninstall (read ACTUAL on-disk entries, not the IDE-expected list)', async () => {
    const project = await makeProject('hooks-status');
    // Before install: status reports no peaks-managed entries on disk.
    const before = parseJsonOutput<{ installed: boolean; entries: Array<{ matcher: string; sentinel: string }> }>((await runCommand(['hooks', 'status', '--project', project, '--json'])).stdout);
    expect(before.data.installed).toBe(false);
    expect(before.data.entries).toHaveLength(0);

    // After install: status reports ONLY the gate-enforce entry.
    await runCommand(['hooks', 'install', '--project', project, '--json']);
    const installed = parseJsonOutput<{ installed: boolean; entries: Array<{ matcher: string; sentinel: string }> }>((await runCommand(['hooks', 'status', '--project', project, '--json'])).stdout);
    expect(installed.data.installed).toBe(true);
    expect(installed.data.entries).toHaveLength(1);
    expect(installed.data.entries[0]?.sentinel).toBe('peaks gate enforce');
    expect(installed.data.entries[0]?.matcher).toBe('Bash');

    // After uninstall: status reports no peaks-managed entries on disk.
    const removed = await runCommand(['hooks', 'uninstall', '--project', project, '--json']);
    expect(parseJsonOutput<{ removed: boolean }>(removed.stdout).data.removed).toBe(true);
    const after = parseJsonOutput<{ installed: boolean; entries: Array<{ matcher: string; sentinel: string }> }>((await runCommand(['hooks', 'status', '--project', project, '--json'])).stdout);
    expect(after.data.installed).toBe(false);
    expect(after.data.entries).toHaveLength(0);
  });
});

/**
 * Slice #014 (Part A — status command bug fix): the pre-#014 status
 * command used `listInstalledEntriesForIde` (an IDE-EXPECTED list) and
 * reported `entries: [Bash, Task]` even when the file only had
 * `Bash`. The new helper `readInstalledEntriesFromSettings` reads
 * the actual settings.json. This test guards the regression by
 * seeding a settings.json with ONLY the gate-enforce entry and
 * asserting the status envelope's `entries` field reflects that —
 * NOT a hardcoded [Bash, Task] list.
 */
describe('slice 014: peaks hooks status reads ACTUAL on-disk entries (not the IDE-expected list)', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('status with only gate-enforce installed reports entries=[{matcher:Bash, sentinel:peaks gate enforce}] (no Task entry)', async () => {
    const project = await makeProject('hooks-status-gate-only');
    await runCommand(['hooks', 'install', '--project', project, '--ide', 'claude-code', '--json']);
    const result = await runCommand(['hooks', 'status', '--project', project, '--ide', 'claude-code', '--json']);
    const out = parseJsonOutput<{ entries: Array<{ matcher: string; sentinel: string }> }>(result.stdout);
    // Slice #014: only gate-enforce. No Task / progress-start entry.
    expect(out.data.entries).toHaveLength(1);
    expect(out.data.entries[0]?.matcher).toBe('Bash');
    expect(out.data.entries[0]?.sentinel).toBe('peaks gate enforce');
    expect(out.data.entries.find((e) => e.sentinel === 'peaks progress start')).toBeUndefined();
  });

  test('status for trae reports entries=[{matcher:terminal, sentinel:peaks hook handle}]', async () => {
    const project = await makeProject('hooks-status-trae-gate');
    await runCommand(['hooks', 'install', '--project', project, '--ide', 'trae', '--json']);
    const result = await runCommand(['hooks', 'status', '--project', project, '--ide', 'trae', '--json']);
    const out = parseJsonOutput<{ entries: Array<{ matcher: string; sentinel: string }> }>(result.stdout);
    expect(out.data.entries).toHaveLength(1);
    expect(out.data.entries[0]?.matcher).toBe('terminal');
    expect(out.data.entries[0]?.sentinel).toBe('peaks hook handle');
  });
});
