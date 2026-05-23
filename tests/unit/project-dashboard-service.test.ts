import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadProjectDashboard } from '../../src/services/dashboard/project-dashboard-service.js';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-project-dashboard-'));
}

describe('loadProjectDashboard', () => {
  test('returns a project-scoped envelope even when no peaks artifacts exist', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.projectRoot).toBe(project);
    expect(dashboard.requests.count).toBe(0);
    expect(dashboard.requests.byRole.prd).toEqual([]);
    expect(dashboard.requests.byRole.ui).toEqual([]);
    expect(dashboard.requests.byRole.rd).toEqual([]);
    expect(dashboard.requests.byRole.qa).toEqual([]);
    expect(dashboard.openspec.exists).toBe(false);
    expect(dashboard.understand.exists).toBe(false);
  });

  test('groups every per-request artifact by role and state', async () => {
    const project = await makeProject();
    await createRequestArtifact({ role: 'prd', requestId: '2026-05-24-a', projectRoot: project, sessionId: 's', apply: true });
    await createRequestArtifact({ role: 'rd',  requestId: '2026-05-24-a', projectRoot: project, sessionId: 's', apply: true });
    await createRequestArtifact({ role: 'qa',  requestId: '2026-05-24-a', projectRoot: project, sessionId: 's', apply: true });

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.requests.count).toBe(3);
    expect(dashboard.requests.byRole.prd).toHaveLength(1);
    expect(dashboard.requests.byRole.rd).toHaveLength(1);
    expect(dashboard.requests.byRole.qa).toHaveLength(1);
    expect(dashboard.requests.byState.draft).toBe(3);
  });

  test('summarizes an OpenSpec changes directory when present', async () => {
    const project = await makeProject();
    await mkdir(join(project, 'openspec', 'changes', 'add-foo'), { recursive: true });
    await writeFile(
      join(project, 'openspec', 'changes', 'add-foo', 'proposal.md'),
      `# Change: add-foo\n## Why\n\nreason\n## What Changes\n- a\n## Acceptance Criteria\n- accept\n`,
      'utf8'
    );

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.openspec.exists).toBe(true);
    expect(dashboard.openspec.count).toBe(1);
    expect(dashboard.openspec.changes[0]?.id).toBe('add-foo');
  });

  test('reports the Understand Anything status when an artifact exists', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), JSON.stringify({ nodes: [{ id: 'a' }] }), 'utf8');

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.understand.exists).toBe(true);
    expect(dashboard.understand.graphExists).toBe(true);
  });

  test('exposes the MCP scan envelope under mcp.servers', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.mcp.servers).toBeInstanceOf(Array);
    expect(dashboard.mcp.scopes).toBeDefined();
  });

  test('reports doctor summary counts (passed / failed) for the global Peaks repository skeleton', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.doctor.passed).toBeGreaterThan(0);
    expect(dashboard.doctor.failed).toBe(0);
    expect(dashboard.doctor.ok).toBe(true);
  });

  test('includes top-level Peaks capabilities so a UI can render the capability map without a second call', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.capabilities.count).toBeGreaterThan(0);
    expect(dashboard.capabilities.mcpCount).toBeGreaterThan(0);
    expect(dashboard.capabilities.sample.length).toBeGreaterThan(0);
  });

  test('returns a generatedAt timestamp using the injected clock', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({ projectRoot: project, clock: () => '2026-05-24T10:00:00.000Z' });

    expect(dashboard.generatedAt).toBe('2026-05-24T10:00:00.000Z');
  });

  test('surfaces the UA parseError when knowledge-graph.json is malformed', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), '{ not json', 'utf8');

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.understand.parseError).toMatch(/JSON|parse/i);
  });

  test('uses an injected doctorReport instead of running the real doctor', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      doctorReport: { ok: false, passed: 5, failed: 2 }
    });

    expect(dashboard.doctor).toEqual({ ok: false, passed: 5, failed: 2 });
  });
});
