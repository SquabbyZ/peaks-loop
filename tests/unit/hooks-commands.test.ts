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
