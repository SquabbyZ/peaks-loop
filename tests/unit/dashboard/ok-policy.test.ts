import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadProjectDashboard, resolveDashboardOk, type ProjectDashboardDoctor, type ProjectDashboardRunbookHealth } from '../../../src/services/dashboard/project-dashboard-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-ok-policy-'));
}

const HEALTHY_RUNBOOK: ProjectDashboardRunbookHealth = { ok: true, required: 8, healthy: 8, missingRunbook: [], applyNoteFailed: [] };
const PASSING_DOCTOR: ProjectDashboardDoctor = { ok: true, passed: 35, failed: 0 };
const FAILING_DOCTOR: ProjectDashboardDoctor = { ok: false, passed: 34, failed: 1 };

describe('dashboard ok-policy (G1)', () => {
  test('resolveDashboardOk returns ok: true in workspace-only mode when only the doctor fails', () => {
    const verdict = resolveDashboardOk({
      okPolicy: 'workspace-only',
      doctor: FAILING_DOCTOR,
      runbookHealth: HEALTHY_RUNBOOK
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.okPolicy).toBe('workspace-only');
  });

  test('resolveDashboardOk returns ok: false in strict mode when the doctor fails', () => {
    const verdict = resolveDashboardOk({
      okPolicy: 'strict',
      doctor: FAILING_DOCTOR,
      runbookHealth: HEALTHY_RUNBOOK
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.okPolicy).toBe('strict');
  });

  test('loadProjectDashboard defaults to workspace-only and surfaces okPolicy in the envelope', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      doctorReport: FAILING_DOCTOR,
      runbookHealth: HEALTHY_RUNBOOK
    });
    expect(dashboard.okPolicy).toBe('workspace-only');
    expect(dashboard.ok).toBe(true);
  });

  test('loadProjectDashboard honours --strict (okPolicy: strict) and flips ok to false on a failing doctor', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      doctorReport: FAILING_DOCTOR,
      runbookHealth: HEALTHY_RUNBOOK,
      okPolicy: 'strict'
    });
    expect(dashboard.okPolicy).toBe('strict');
    expect(dashboard.ok).toBe(false);
  });
});
