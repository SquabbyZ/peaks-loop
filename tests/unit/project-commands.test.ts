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

  test('reports PROJECT_DASHBOARD_RUNBOOK_UNHEALTHY when skill runbook health fails', async () => {
    const module = await import('../../src/services/dashboard/project-dashboard-service.js');
    const fakeDashboard = {
      generatedAt: '2026-05-24T00:00:00.000Z',
      projectRoot: '/tmp/fake',
      requests: { count: 0, byRole: { prd: [], ui: [], rd: [], qa: [] }, byState: {} },
      openspec: { exists: false, count: 0, changes: [] },
      understand: { exists: false, graphExists: false, graphPath: '' },
      mcp: { servers: [], scopes: {} },
      doctor: { ok: true, passed: 1, failed: 0 },
      runbookHealth: {
        ok: false,
        required: 7,
        healthy: 6,
        missingRunbook: [],
        applyNoteFailed: ['peaks-txt']
      },
      capabilities: { count: 0, mcpCount: 0, sample: [] }
    } as unknown as Awaited<ReturnType<typeof module.loadProjectDashboard>>;
    const spy = vi.spyOn(module, 'loadProjectDashboard').mockResolvedValueOnce(fakeDashboard);

    const project = await makeProject('project-dashboard-runbook-unhealthy');
    const result = await runCommand(['project', 'dashboard', '--project', project, '--json']);
    const output = parseJsonOutput<{
      runbookHealth: { ok: boolean; healthy: number; required: number; applyNoteFailed: string[] };
    }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('PROJECT_DASHBOARD_RUNBOOK_UNHEALTHY');
    expect(output.data.runbookHealth.applyNoteFailed).toEqual(['peaks-txt']);
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('reports PROJECT_DASHBOARD_DOCTOR_FAILED when doctor fails but runbook health is ok', async () => {
    const module = await import('../../src/services/dashboard/project-dashboard-service.js');
    const fakeDashboard = {
      generatedAt: '2026-05-24T00:00:00.000Z',
      projectRoot: '/tmp/fake',
      requests: { count: 0, byRole: { prd: [], ui: [], rd: [], qa: [] }, byState: {} },
      openspec: { exists: false, count: 0, changes: [] },
      understand: { exists: false, graphExists: false, graphPath: '' },
      mcp: { servers: [], scopes: {} },
      doctor: { ok: false, passed: 5, failed: 2 },
      runbookHealth: {
        ok: true,
        required: 7,
        healthy: 7,
        missingRunbook: [],
        applyNoteFailed: []
      },
      capabilities: { count: 0, mcpCount: 0, sample: [] }
    } as unknown as Awaited<ReturnType<typeof module.loadProjectDashboard>>;
    const spy = vi.spyOn(module, 'loadProjectDashboard').mockResolvedValueOnce(fakeDashboard);

    const project = await makeProject('project-dashboard-doctor-failed');
    const result = await runCommand(['project', 'dashboard', '--project', project, '--json']);
    const output = parseJsonOutput<{ doctor: { ok: boolean; passed: number; failed: number } }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('PROJECT_DASHBOARD_DOCTOR_FAILED');
    expect(output.data.doctor).toEqual({ ok: false, passed: 5, failed: 2 });
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});
