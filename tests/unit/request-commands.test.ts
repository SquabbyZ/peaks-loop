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

describe('peaks request list command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists every per-request artifact when no filters are applied', async () => {
    const project = await makeProject('request-list-all');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-a', '--project', project, '--session-id', 's1', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-a', '--project', project, '--session-id', 's1', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-b', '--project', project, '--session-id', 's2', '--apply', '--json']);

    const result = await runCommand(['request', 'list', '--project', project, '--json']);
    const output = parseJsonOutput<{ count: number; items: Array<{ sessionId: string; role: string; requestId: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('request.list');
    expect(output.data.count).toBe(3);
  });

  test('filters by --session-id', async () => {
    const project = await makeProject('request-list-by-session');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-x', '--project', project, '--session-id', 'session-x', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-y', '--project', project, '--session-id', 'session-y', '--apply', '--json']);

    const result = await runCommand(['request', 'list', '--project', project, '--session-id', 'session-x', '--json']);
    const output = parseJsonOutput<{ count: number; items: Array<{ sessionId: string }> }>(result.stdout);

    expect(output.data.count).toBe(1);
    expect(output.data.items[0]?.sessionId).toBe('session-x');
  });

  test('filters by --role', async () => {
    const project = await makeProject('request-list-by-role');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-x', '--project', project, '--session-id', 's', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-23-x', '--project', project, '--session-id', 's', '--apply', '--json']);

    const result = await runCommand(['request', 'list', '--project', project, '--role', 'qa', '--json']);
    const output = parseJsonOutput<{ items: Array<{ role: string }> }>(result.stdout);

    expect(output.data.items).toHaveLength(1);
    expect(output.data.items[0]?.role).toBe('qa');
  });

  test('returns an empty list when the project has no artifacts', async () => {
    const project = await makeProject('request-list-empty');

    const result = await runCommand(['request', 'list', '--project', project, '--json']);
    const output = parseJsonOutput<{ count: number; items: unknown[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.count).toBe(0);
    expect(output.data.items).toEqual([]);
  });

  test('returns REQUEST_LIST_FAILED when the service throws', async () => {
    const module = await import('../../src/services/artifacts/request-artifact-service.js');
    const spy = vi.spyOn(module, 'listRequestArtifacts').mockRejectedValueOnce(new Error('synthetic list failure'));

    const result = await runCommand(['request', 'list', '--project', homeDir, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_LIST_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});

describe('peaks request show command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the artifact when sessionId is provided', async () => {
    const project = await makeProject('request-show-by-session');
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-shown', '--project', project, '--session-id', 'session-r', '--apply', '--json']);

    const result = await runCommand(['request', 'show', '2026-05-23-shown', '--role', 'rd', '--project', project, '--session-id', 'session-r', '--json']);
    const output = parseJsonOutput<{ content: string; sessionId: string; role: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('request.show');
    expect(output.data.sessionId).toBe('session-r');
    expect(output.data.role).toBe('rd');
    expect(output.data.content).toMatch(/^# RD Request 2026-05-23-shown/m);
  });

  test('searches across sessions when sessionId is omitted', async () => {
    const project = await makeProject('request-show-across');
    await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-23-wherever', '--project', project, '--session-id', 'somewhere', '--apply', '--json']);

    const result = await runCommand(['request', 'show', '2026-05-23-wherever', '--role', 'qa', '--project', project, '--json']);
    const output = parseJsonOutput<{ sessionId: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('somewhere');
  });

  test('returns REQUEST_NOT_FOUND when the artifact does not exist', async () => {
    const project = await makeProject('request-show-missing');

    const result = await runCommand(['request', 'show', '2026-05-23-missing', '--role', 'prd', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('returns REQUEST_SHOW_FAILED on invalid request id', async () => {
    const project = await makeProject('request-show-bad-id');

    const result = await runCommand(['request', 'show', '../escape', '--role', 'prd', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_SHOW_FAILED');
    expect(result.exitCode).toBe(1);
  });
});

describe('peaks request transition command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('moves a PRD artifact from draft to confirmed-by-user', async () => {
    const project = await makeProject('request-transition-ok');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-24-feature', '--project', project, '--session-id', 's1', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-24-feature', '--role', 'prd', '--state', 'confirmed-by-user', '--project', project, '--session-id', 's1', '--json']);
    const output = parseJsonOutput<{ state: string; previousState: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('request.transition');
    expect(output.data.state).toBe('confirmed-by-user');
    expect(output.data.previousState).toBe('draft');
  });

  test('appends a transition note when --reason is passed', async () => {
    const project = await makeProject('request-transition-reason');
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-24-blocked', '--project', project, '--session-id', 's1', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-24-blocked', '--role', 'rd', '--state', 'blocked', '--project', project, '--session-id', 's1', '--reason', 'awaiting QA bandwidth', '--json']);
    const output = parseJsonOutput<{ content: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.content).toContain('awaiting QA bandwidth');
  });

  test('searches across sessions when --session-id is omitted', async () => {
    const project = await makeProject('request-transition-cross');
    await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-24-anywhere', '--project', project, '--session-id', 'somewhere', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-24-anywhere', '--role', 'qa', '--state', 'running', '--project', project, '--json']);
    const output = parseJsonOutput<{ sessionId: string; state: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('somewhere');
    expect(output.data.state).toBe('running');
  });

  test('returns REQUEST_NOT_FOUND when the target artifact is missing', async () => {
    const project = await makeProject('request-transition-missing');

    const result = await runCommand(['request', 'transition', '2026-05-24-missing', '--role', 'prd', '--state', 'blocked', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('rejects --state values that are not allowed for the role via the Commander parser', async () => {
    const project = await makeProject('request-transition-bad-state');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-24-x', '--project', project, '--session-id', 's', '--apply', '--json']);

    await expect(
      runCommand(['request', 'transition', '2026-05-24-x', '--role', 'prd', '--state', 'verdict-issued', '--project', project, '--session-id', 's', '--json'])
    ).rejects.toThrowError(/must be one of/);
  });

  test('returns REQUEST_TRANSITION_FAILED when the service throws on invalid request id format', async () => {
    const project = await makeProject('request-transition-bad-id');

    const result = await runCommand(['request', 'transition', '../escape', '--role', 'prd', '--state', 'blocked', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_TRANSITION_FAILED');
    expect(result.exitCode).toBe(1);
  });
});
