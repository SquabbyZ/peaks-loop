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
    const firstOut = parseJsonOutput<{ applied: boolean; settingsPath: string }>(first.stdout);
    expect(firstOut.ok).toBe(true);
    expect(firstOut.data.applied).toBe(true);
    expect(existsSync(firstOut.data.settingsPath)).toBe(true);

    const second = await runCommand(['hooks', 'install', '--project', project, '--json']);
    expect(parseJsonOutput<{ applied: boolean }>(second.stdout).data.applied).toBe(false);
  });

  test('dry-run does not write', async () => {
    const project = await makeProject('hooks-dryrun');
    const result = await runCommand(['hooks', 'install', '--project', project, '--dry-run', '--json']);
    const out = parseJsonOutput<{ applied: boolean; settingsPath: string }>(result.stdout);
    expect(out.data.applied).toBe(false);
    expect(existsSync(out.data.settingsPath)).toBe(false);
  });

  test('status reflects install then uninstall', async () => {
    const project = await makeProject('hooks-status');
    expect(parseJsonOutput<{ installed: boolean }>((await runCommand(['hooks', 'status', '--project', project, '--json'])).stdout).data.installed).toBe(false);
    await runCommand(['hooks', 'install', '--project', project, '--json']);
    expect(parseJsonOutput<{ installed: boolean }>((await runCommand(['hooks', 'status', '--project', project, '--json'])).stdout).data.installed).toBe(true);
    const removed = await runCommand(['hooks', 'uninstall', '--project', project, '--json']);
    expect(parseJsonOutput<{ removed: boolean }>(removed.stdout).data.removed).toBe(true);
    expect(parseJsonOutput<{ installed: boolean }>((await runCommand(['hooks', 'status', '--project', project, '--json'])).stdout).data.installed).toBe(false);
  });
});

/**
 * Slice 2026-06-06-sub-agent-spawn-bug-and-decouple: the `entries` list
 * surfaced by `peaks hooks status` and `peaks hooks install` must read
 * the progress matcher from `adapter.subAgentToolMatcher` (per-IDE), not
 * from a hardcoded 'Task' literal. For the built-in adapters (claude-code,
 * trae) the matcher is 'Task' — same as before the refactor — but the
 * data flow is now adapter-driven.
 */
describe('slice 2026-06-06: peaks hooks status --ide derives progress matcher from adapter', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('peaks hooks status --ide claude-code surfaces matcher "Task" for the progress entry', async () => {
    const project = await makeProject('hooks-status-claude-code');
    await runCommand(['hooks', 'install', '--project', project, '--ide', 'claude-code', '--json']);
    const result = await runCommand(['hooks', 'status', '--project', project, '--ide', 'claude-code', '--json']);
    const out = parseJsonOutput<{ entries: Array<{ matcher: string; sentinel: string }> }>(result.stdout);
    const progressEntry = out.data.entries.find((e) => e.sentinel === 'peaks progress start');
    expect(progressEntry?.matcher).toBe('Task');
  });

  test('peaks hooks status --ide trae surfaces matcher "Task" for the progress entry (UNVERIFIED but matches current byte-level output)', async () => {
    const project = await makeProject('hooks-status-trae');
    await runCommand(['hooks', 'install', '--project', project, '--ide', 'trae', '--json']);
    const result = await runCommand(['hooks', 'status', '--project', project, '--ide', 'trae', '--json']);
    const out = parseJsonOutput<{ entries: Array<{ matcher: string; sentinel: string }> }>(result.stdout);
    const progressEntry = out.data.entries.find((e) => e.sentinel === 'peaks progress start');
    expect(progressEntry?.matcher).toBe('Task');
  });
});

/**
 * Slice #013 (`--no-progress` flag): commander.js translates `--no-progress`
 * to `options.progress = false` (it does NOT set `options.noProgress`). The
 * CLI must therefore check `options.progress === false` to detect that the
 * user passed `--no-progress`. These tests guard against the regression
 * where the CLI checked `options.noProgress === true` (a key commander
 * never sets), which made `--no-progress` a silent no-op even though the
 * service layer accepted `skipProgress: true` correctly.
 */
describe('slice 013: peaks hooks install --no-progress threads through the CLI parser', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('peaks hooks install --no-progress strips the progress entry from the JSON envelope (entries=[Bash] only)', async () => {
    const project = await makeProject('hooks-no-progress-strip');
    const result = await runCommand(['hooks', 'install', '--project', project, '--no-progress', '--json']);
    const out = parseJsonOutput<{
      skipProgress: boolean;
      entries: Array<{ matcher: string; sentinel: string }>;
    }>(result.stdout);
    expect(out.ok).toBe(true);
    expect(out.data.skipProgress).toBe(true);
    // Only the gate-enforce entry should be present; the progress-start
    // entry must be filtered out.
    expect(out.data.entries).toHaveLength(1);
    expect(out.data.entries[0]?.sentinel).toBe('peaks gate enforce');
    expect(out.data.entries.find((e) => e.sentinel === 'peaks progress start')).toBeUndefined();
  });

  test('peaks hooks install (default) preserves the progress entry in the JSON envelope (regression guard)', async () => {
    const project = await makeProject('hooks-no-progress-default');
    const result = await runCommand(['hooks', 'install', '--project', project, '--json']);
    const out = parseJsonOutput<{
      skipProgress: boolean;
      entries: Array<{ matcher: string; sentinel: string }>;
    }>(result.stdout);
    expect(out.ok).toBe(true);
    expect(out.data.skipProgress).toBe(false);
    // Both gate-enforce and progress-start entries must be present.
    expect(out.data.entries).toHaveLength(2);
    expect(out.data.entries.find((e) => e.sentinel === 'peaks gate enforce')).toBeDefined();
    expect(out.data.entries.find((e) => e.sentinel === 'peaks progress start')).toBeDefined();
  });

  test('peaks hooks install --no-progress --dry-run previews the stripped entry list (no settings.json written)', async () => {
    const project = await makeProject('hooks-no-progress-dryrun');
    const result = await runCommand([
      'hooks', 'install', '--project', project, '--no-progress', '--dry-run', '--json'
    ]);
    const out = parseJsonOutput<{
      skipProgress: boolean;
      dryRun: boolean;
      applied: boolean;
      entries: Array<{ matcher: string; sentinel: string }>;
    }>(result.stdout);
    expect(out.ok).toBe(true);
    expect(out.data.skipProgress).toBe(true);
    expect(out.data.dryRun).toBe(true);
    expect(out.data.applied).toBe(false);
    expect(out.data.entries).toHaveLength(1);
    expect(out.data.entries[0]?.sentinel).toBe('peaks gate enforce');
    // The settings.json must NOT have been written on dry-run.
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(false);
  });
});
