import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function makeProject(name: string): Promise<string> {
  const project = join(homeDir, name);
  await mkdir(project, { recursive: true });
  return project;
}

describe('peaks project dashboard command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns a project dashboard envelope with all top-level sections', async () => {
    const project = await makeProject('project-dashboard-empty');

    const result = await runCommand(['project', 'dashboard', '--project', project, '--json']);
    const output = parseJsonOutput<{
      generatedAt: string;
      requests: { count: number };
      openspec: { exists: boolean };
      understand: { exists: boolean };
      mcp: { servers: unknown[] };
      doctor: { ok: boolean };
      capabilities: { count: number };
    }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('project.dashboard');
    expect(output.data.requests.count).toBe(0);
    expect(output.data.openspec.exists).toBe(false);
    expect(output.data.understand.exists).toBe(false);
    expect(output.data.mcp.servers).toEqual(expect.any(Array));
    expect(output.data.doctor.ok).toBe(true);
    expect(output.data.capabilities.count).toBeGreaterThan(0);
  });

  test('includes per-request artifacts after they are created', async () => {
    const project = await makeProject('project-dashboard-with-requests');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-24-feature', '--project', project, '--session-id', 's', '--apply', '--json']);

    const result = await runCommand(['project', 'dashboard', '--project', project, '--json']);
    const output = parseJsonOutput<{ requests: { count: number; byRole: Record<string, unknown[]> } }>(result.stdout);

    expect(output.data.requests.count).toBe(1);
    expect(output.data.requests.byRole.prd).toHaveLength(1);
  });

  test('returns PROJECT_DASHBOARD_FAILED when the service throws', async () => {
    const module = await import('../../src/services/dashboard/project-dashboard-service.js');
    const spy = vi.spyOn(module, 'loadProjectDashboard').mockRejectedValueOnce(new Error('synthetic dashboard failure'));

    const project = await makeProject('project-dashboard-failure');
    const result = await runCommand(['project', 'dashboard', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('PROJECT_DASHBOARD_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});
