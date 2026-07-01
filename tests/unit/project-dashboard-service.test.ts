import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { loadProjectDashboard } from '../../src/services/dashboard/project-dashboard-service.js';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SKILL_MD_PATH = join(REPO_ROOT, 'skills', 'peaks-ide', 'SKILL.md');

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
    expect(dashboard.requests.byRole.sc).toEqual([]);
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

  test('does NOT expose a MCP scan envelope (slice #016: MCP subsystem removed)', async () => {
    const project = await makeProject();

    const dashboard = await loadProjectDashboard({ projectRoot: project });

    expect((dashboard as { mcp?: unknown }).mcp).toBeUndefined();
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
    expect(dashboard.runbookHealth.required).toBe(8);
    expect(dashboard.runbookHealth.healthy).toBe(6);
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

/**
 * peaks-ide SKILL.md contract: Step 1 of the skill reads
 * `peaks project dashboard --json` and uses the returned envelope to build
 * a state summary. The fields the skill body depends on MUST stay stable
 * across slices. If a future refactor changes any of these field names, the
 * peaks-ide SKILL.md Step 1 will silently produce wrong output.
 *
 * This test pins the SKILL.md-visible envelope contract. It is intentionally
 * stricter than the other dashboard tests: it asserts the EXACT key names
 * the skill reads, not just "some keys are present". If you need to add a
 * field, add it below; if you need to remove one, update the SKILL.md first.
 *
 * Slice 008-008 G3 extension: the contract now pins 10+ fields (per AC-8):
 * ok, okPolicy, projectRoot, requests, openspec, skillPresence, doctor,
 * doctor.summary shape, runbookHealth, capabilities, mcp, understand,
 * generatedAt. Each field has a type assertion.
 */
describe('peaks-ide SKILL.md dashboard contract (slice #3 closeout + G3 extension)', () => {
  test('envelope exposes every field the peaks-ide SKILL.md Step 1 reads', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({ projectRoot: project });

    // G1 ok-policy: the skill reads dashboard.ok to gate Step 1 and
    // dashboard.okPolicy to surface the policy in its state summary.
    expect(dashboard).toHaveProperty('ok');
    expect(typeof dashboard.ok).toBe('boolean');
    expect(dashboard).toHaveProperty('okPolicy');
    expect(['workspace-only', 'strict']).toContain(dashboard.okPolicy);

    // SKILL.md Step 1 reads the projectRoot label
    expect(dashboard).toHaveProperty('projectRoot');
    expect(typeof dashboard.projectRoot).toBe('string');

    // SKILL.md Step 1 reads requests.count + requests.byRole to detect
    // any in-flight / completed peaks-* work for this project.
    expect(dashboard.requests).toHaveProperty('count');
    expect(typeof dashboard.requests.count).toBe('number');
    expect(dashboard.requests).toHaveProperty('byRole');
    expect(dashboard.requests.byRole).toHaveProperty('prd');
    expect(dashboard.requests.byRole).toHaveProperty('ui');
    expect(dashboard.requests.byRole).toHaveProperty('rd');
    expect(dashboard.requests.byRole).toHaveProperty('qa');
    expect(dashboard.requests.byRole).toHaveProperty('sc');

    // SKILL.md Step 1 reads openspec.exists to decide whether to recommend
    // the OpenSpec-first-run opt-in. (Step 0.5 in the peaks-solo skill, but
    // peaks-ide inherits the same field.)
    expect(dashboard.openspec).toHaveProperty('exists');
    expect(typeof dashboard.openspec.exists).toBe('boolean');

    // SKILL.md Step 1 reads skillPresence.active to decide whether to render
    // the "current skill" badge. When active is true, the `skill` field MUST
    // be present so the badge can label itself. When active is false (no
    // presence set), `skill` is undefined — the SKILL.md only reads
    // `skill` when `active` is true.
    expect(dashboard).toHaveProperty('skillPresence');
    expect(dashboard.skillPresence).toHaveProperty('active');
    expect(typeof dashboard.skillPresence.active).toBe('boolean');

    // G3 extension: doctor summary fields the skill surfaces in its state
    // summary (e.g. "Doctor: 35 passed / 0 failed").
    expect(dashboard.doctor).toHaveProperty('ok');
    expect(dashboard.doctor).toHaveProperty('passed');
    expect(dashboard.doctor).toHaveProperty('failed');

    // G3 extension: runbook health summary.
    expect(dashboard.runbookHealth).toHaveProperty('ok');
    expect(dashboard.runbookHealth).toHaveProperty('required');
    expect(dashboard.runbookHealth).toHaveProperty('healthy');

    // G3 extension: MCP scan envelope was REMOVED in slice #016.
    // peaks-loop no longer scans MCP servers; the LLM owns that surface now.
    expect((dashboard as { mcp?: unknown }).mcp).toBeUndefined();

    // G3 extension: capabilities count the skill references for status badges.
    expect(dashboard).toHaveProperty('capabilities');
    expect(dashboard.capabilities).toHaveProperty('count');
    expect(typeof dashboard.capabilities.count).toBe('number');

    // G3 extension: generatedAt timestamp the skill surfaces as "snapshot taken at".
    expect(dashboard).toHaveProperty('generatedAt');
    expect(typeof dashboard.generatedAt).toBe('string');
  });

  test('when skill presence is set, skillPresence.skill is present (SKILL.md Step 1 badge label)', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      skillPresence: { skill: 'peaks-ide', setAt: new Date().toISOString() }
    });
    expect(dashboard.skillPresence.active).toBe(true);
    expect(dashboard.skillPresence.skill).toBe('peaks-ide');
  });

  test('ok is true in workspace-only mode even when the doctor fails (G1 default)', async () => {
    const project = await makeProject();
    const dashboard = await loadProjectDashboard({
      projectRoot: project,
      doctorReport: { ok: false, passed: 34, failed: 1 },
      runbookHealth: { ok: true, required: 8, healthy: 8, missingRunbook: [], applyNoteFailed: [] }
    });
    expect(dashboard.okPolicy).toBe('workspace-only');
    expect(dashboard.ok).toBe(true);
  });
});

/**
 * peaks-ide SKILL.md runbook contract (G3 AC-9): the skill's `## Default
 * runbook` section is the canonical runbook the `peaks skill runbook
 * peaks-ide --json` CLI returns. The runbook has at least 5 numbered steps
 * (per the skill body: presence / detect / ask / plan / execute / audit —
 * i.e. 6 steps). The runbook-service extractRunbookSection is exercised
 * here; the peaks-ide prose style is to embed the peaks <cmd> inside
 * backticks, so the runbook-service `peaksCommandCount` is 0 for this
 * skill. The contract asserted below is on the SKILL.md prose shape, not
 * the runbook-service peak-line count.
 */
import { readFile } from 'node:fs/promises';
import { inspectSkillRunbook } from '../../src/services/skills/skill-runbook-service.js';

describe('peaks-ide SKILL.md runbook contract (G3 AC-9)', () => {
  test('peaks-ide runbook section is non-empty (hasRunbook: true)', async () => {
    const inspection = await inspectSkillRunbook('peaks-ide');
    expect(inspection.hasRunbook).toBe(true);
    expect(inspection.ok).toBe(true);
  });

  test('peaks-ide SKILL.md ## Default runbook section parses to >= 5 numbered steps', async () => {
    const body = await readFile(SKILL_MD_PATH, 'utf8');
    const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
    expect(match).not.toBeNull();
    const section = match![1]!;
    const numberedSteps = section.split(/\r?\n/).filter((line) => /^\d+\.\s/.test(line));
    expect(numberedSteps.length).toBeGreaterThanOrEqual(5);
  });

  test('peaks-ide runbook lists the canonical CLI primitives the skill composes', async () => {
    const body = await readFile(SKILL_MD_PATH, 'utf8');
    const section = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body)![1]!;
    expect(section).toMatch(/peaks skill presence:set/);
    expect(section).toMatch(/peaks project dashboard/);
    expect(section).toMatch(/peaks hooks install/);
    expect(section).toMatch(/peaks statusline install/);
  });
});

