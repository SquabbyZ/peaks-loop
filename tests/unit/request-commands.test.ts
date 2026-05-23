import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

describe('peaks request init command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns a preview for every role without writing files', async () => {
    const project = await makeProject('request-init-preview');

    for (const role of ['prd', 'ui', 'rd', 'qa'] as const) {
      const result = await runCommand(['request', 'init', '--role', role, '--id', '2026-05-23-preview', '--project', project, '--session-id', 'test-session', '--json']);
      const output = parseJsonOutput<{ applied: boolean; path: string }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.command).toBe('request.init');
      expect(output.data.applied).toBe(false);
      expect(output.data.path).toBe(join(project, '.peaks', 'test-session', role, 'requests', '2026-05-23-preview.md'));
      expect(existsSync(output.data.path)).toBe(false);
    }
  });

  test('writes the artifact file for every role when --apply is passed', async () => {
    const project = await makeProject('request-init-apply');

    for (const role of ['prd', 'ui', 'rd', 'qa'] as const) {
      const result = await runCommand(['request', 'init', '--role', role, '--id', '2026-05-23-apply', '--project', project, '--session-id', 'test-session', '--apply', '--json']);
      const output = parseJsonOutput<{ applied: boolean; path: string }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.applied).toBe(true);
      const body = await readFile(output.data.path, 'utf8');
      expect(body).toMatch(new RegExp(`^# ${role.toUpperCase()} Request 2026-05-23-apply`, 'm'));
    }
  });

  test('refuses to overwrite an existing artifact via --apply', async () => {
    const project = await makeProject('request-init-conflict');
    const dir = join(project, '.peaks', 'test-session', 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, '2026-05-23-existing.md'), 'existing', 'utf8');

    const result = await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-existing', '--project', project, '--session-id', 'test-session', '--apply', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('rejects an invalid role via the Commander parser', async () => {
    const project = await makeProject('request-init-bad-role');

    await expect(
      runCommand(['request', 'init', '--role', 'unknown', '--id', '2026-05-23-x', '--project', project, '--json'])
    ).rejects.toThrowError(/one of prd, ui, rd, qa/);
  });

  test('returns REQUEST_INIT_FAILED on invalid request id format', async () => {
    const project = await makeProject('request-init-bad-id');

    const result = await runCommand(['request', 'init', '--role', 'prd', '--id', '../escape', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('uses a date-stamped session id when --session-id is omitted', async () => {
    const project = await makeProject('request-init-default-session');

    const result = await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-23-default-session', '--project', project, '--json']);
    const output = parseJsonOutput<{ sessionId: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
