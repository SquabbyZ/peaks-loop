import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { loadProjectDashboard } from '../../src/services/dashboard/project-dashboard-service.js';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';

vi.mock('../../src/services/doctor/doctor-service.js', () => ({
  runDoctor: async () => ({
    summary: { ok: false, passed: 1, failed: 3 },
    checks: [
      { id: 'skill-runbook:peaks-rd', ok: false },
      { id: 'skill-apply-note:peaks-qa', ok: false },
      { id: 'other:check', ok: false }
    ]
  })
}));

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

  test('reports doctor summary counts from the doctor service', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.doctor).toEqual({ ok: false, passed: 1, failed: 3 });
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
    expect(dashboard.runbookHealth).toEqual({ ok: true, required: 0, healthy: 0, missingRunbook: [], applyNoteFailed: [] });
  });

  test('derives runbookHealth from failed doctor checks', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect(dashboard.runbookHealth.ok).toBe(false);
    expect(dashboard.runbookHealth.required).toBe(7);
    expect(dashboard.runbookHealth.healthy).toBe(5);
    expect(dashboard.runbookHealth.missingRunbook).toEqual(['peaks-rd']);
    expect(dashboard.runbookHealth.applyNoteFailed).toEqual(['peaks-qa']);
  });

  test('uses an injected runbookHealth override without calling the real doctor', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      doctorReport: { ok: true, passed: 1, failed: 0 },
      runbookHealth: { ok: false, required: 7, healthy: 6, missingRunbook: [], applyNoteFailed: ['peaks-txt'] }
    });

    expect(dashboard.runbookHealth.ok).toBe(false);
    expect(dashboard.runbookHealth.applyNoteFailed).toEqual(['peaks-txt']);
  });

  test('skillPresence reports inactive when no presence is provided and the file is absent', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      skillPresence: null
    });

    expect(dashboard.skillPresence.active).toBe(false);
    expect(dashboard.skillPresence.fresh).toBe(true);
    expect(dashboard.skillPresence.skill).toBeUndefined();
  });

  test('skillPresence surfaces the active skill, mode, gate, and setAt', async () => {
    const project = await makeProject();
    const setAt = new Date(Date.now() - 60_000).toISOString();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      skillPresence: { skill: 'peaks-rd', mode: 'swarm', gate: 'dry-run', setAt }
    });

    expect(dashboard.skillPresence.active).toBe(true);
    expect(dashboard.skillPresence.skill).toBe('peaks-rd');
    expect(dashboard.skillPresence.mode).toBe('swarm');
    expect(dashboard.skillPresence.gate).toBe('dry-run');
    expect(dashboard.skillPresence.setAt).toBe(setAt);
    expect(dashboard.skillPresence.fresh).toBe(true);
  });

  test('skillPresence flags stale when setAt is older than 24h', async () => {
    const project = await makeProject();
    const setAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      skillPresence: { skill: 'peaks-rd', setAt }
    });

    expect(dashboard.skillPresence.active).toBe(true);
    expect(dashboard.skillPresence.fresh).toBe(false);
    expect(dashboard.skillPresence.skill).toBe('peaks-rd');
  });

  test('skillPresence flags invalid setAt as not fresh', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      skillPresence: { skill: 'peaks-rd', setAt: 'not-a-date' }
    });

    expect(dashboard.skillPresence.active).toBe(true);
    expect(dashboard.skillPresence.fresh).toBe(false);
  });
});
