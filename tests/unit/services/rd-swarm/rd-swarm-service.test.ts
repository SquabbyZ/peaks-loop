import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planRdSwarmGraph, type RdSwarmPlanRequest } from '../../../../src/services/rd-swarm/rd-swarm-service.js';

function input(overrides: Partial<RdSwarmPlanRequest> = {}): RdSwarmPlanRequest {
  return {
    skill: 'rd',
    changeId: 'checkout-refactor',
    goal: 'Implement the approved checkout refactor',
    maxWorkers: 25,
    dryRun: true,
    workspaceRoot: mkdtempSync(join(tmpdir(), 'rd-swarm-artifacts-')),
    ...overrides,
  };
}

function approvedInput(overrides: Partial<RdSwarmPlanRequest> = {}): RdSwarmPlanRequest {
  const base = input({ requiresTechApproval: true, ...overrides });
  const architecture = join(base.workspaceRoot, base.changeId, 'rd', 'architecture');
  mkdirSync(architecture, { recursive: true });
  for (const name of ['frontend-tech-doc.md', 'backend-tech-doc.md', 'tech-approval-record.md']) {
    writeFileSync(join(architecture, name), name === 'tech-approval-record.md' ? 'status: approved\n' : 'ready\n');
  }
  return base;
}

describe('planRdSwarmGraph', () => {
  test('emits discovery, planning, implementation, quality-gates, and reducer waves', () => {
    const plan = planRdSwarmGraph(input());
    expect(plan.waves.map((wave) => wave.name)).toEqual(['discovery', 'planning', 'implementation candidates', 'quality gates', 'reducer']);
  });
  test('uses deterministic task ids and output', () => {
    expect(planRdSwarmGraph(input())).toEqual(planRdSwarmGraph(input({ workspaceRoot: input().workspaceRoot })));
  });
  test('emits the requested graph shape', () => {
    const plan = planRdSwarmGraph(input());
    expect(plan.tasks.length).toBeGreaterThanOrEqual(25);
    for (const task of plan.tasks) {
      expect(task.inputs.length).toBeGreaterThan(0);
      expect(task.outputs.length).toBeGreaterThan(0);
      expect(task.dependsOn).toBeDefined();
      expect(task.conflictGroup).toBeTruthy();
      expect(task.targetArea).toBeTruthy();
      expect(task.expectedEvidence).toBeTruthy();
    }
  });
  test('assigns a conflict group to every wave', () => {
    const plan = planRdSwarmGraph(input());
    expect(plan.conflictGroups).toHaveLength(5);
    expect(plan.tasks.every((task) => plan.conflictGroups.some((group) => group.groupId === task.conflictGroup))).toBe(true);
  });
  test('keeps reducer dependent on quality gates', () => {
    const plan = planRdSwarmGraph(input());
    const reducer = plan.tasks.filter((task) => task.wave === 'reducer');
    expect(reducer[0]?.dependsOn).toEqual(plan.waves.find((wave) => wave.name === 'quality gates')?.taskIds);
  });
  test('defaults to a 25-worker target', () => {
    expect(planRdSwarmGraph(input()).workerTarget).toBe(25);
  });
  test('accepts a 40-worker target', () => {
    expect(planRdSwarmGraph(input({ maxWorkers: 40 })).workerTarget).toBe(40);
  });
  test('caps max-workers at 40 and warns', () => {
    const plan = planRdSwarmGraph(input({ maxWorkers: 50 }));
    expect(plan.workerTarget).toBe(40);
    expect(plan.blockedReasons).toContain('WORKER_CAP_EXCEEDED');
  });
  test('blocks max-workers below 25 with SMALL_SCOPE', () => {
    const plan = planRdSwarmGraph(input({ maxWorkers: 20 }));
    expect(plan.available).toBe(false);
    expect(plan.blockedReasons).toContain('SMALL_SCOPE');
  });
  test('blocks zero max-workers with INVALID_MAX_WORKERS', () => {
    const plan = planRdSwarmGraph(input({ maxWorkers: 0 }));
    expect(plan.available).toBe(false);
    expect(plan.blockedReasons).toContain('INVALID_MAX_WORKERS');
  });
  test('blocks required tech approval when artifacts are missing', () => {
    const plan = planRdSwarmGraph(input({ requiresTechApproval: true }));
    expect(plan.available).toBe(false);
    expect(plan.blockedReasons).toContain('TECH_APPROVAL_REQUIRED');
  });
  test('proceeds when required tech approval is approved', () => {
    const plan = planRdSwarmGraph(approvedInput());
    expect(plan.available).toBe(true);
    expect(plan.gateStatus.techStatus).toBe('approved');
  });
  test('proceeds without approval when tech approval is not required', () => {
    const plan = planRdSwarmGraph(input({ requiresTechApproval: false }));
    expect(plan.available).toBe(true);
    expect(plan.gateStatus.techApprovalRequired).toBe(false);
  });
  test('uses stable reason for a missing approval record', () => {
    const plan = planRdSwarmGraph(input({ requiresTechApproval: true }));
    expect(plan.blockedReasons).toEqual(expect.arrayContaining(['TECH_APPROVAL_REQUIRED', 'TECH_APPROVAL_MISSING']));
  });
  test('rejects empty change ids', () => {
    const plan = planRdSwarmGraph(input({ changeId: '' }));
    expect(plan.available).toBe(false);
    expect(plan.blockedReasons).toContain('change-id-empty');
  });
  test('rejects traversal change ids', () => {
    const plan = planRdSwarmGraph(input({ changeId: '../escape' }));
    expect(plan.available).toBe(false);
    expect(plan.blockedReasons).toContain('change-id-format');
  });
  test('delegates all artifact paths to the artifact workspace layout', () => {
    const plan = planRdSwarmGraph(input({ requiresTechApproval: false }));
    expect(plan.artifactRoot).toBe('checkout-refactor/swarm');
    expect(plan.outputs.taskGraph).toBe('checkout-refactor/swarm/task-graph.json');
    expect(plan.outputs.waveManifests.every((path) => path.includes('/'))).toBe(true);
    expect(plan.outputs.workerBriefs.every((path) => path.startsWith('checkout-refactor/swarm/'))).toBe(true);
  });
  test('never plans paths inside the target repository', () => {
    const plan = planRdSwarmGraph(input({ targetRepoRoot: join(input().workspaceRoot, 'repo'), requiresTechApproval: false }));
    expect(plan.outputs.taskGraph).not.toContain('/repo/');
  });
  test('uses JSON-safe forward slash separators', () => {
    const plan = planRdSwarmGraph(input({ requiresTechApproval: false }));
    expect(JSON.stringify(plan)).not.toContain('\\\\');
  });
  test('explains a small scope block in natural language', () => {
    const plan = planRdSwarmGraph(input({ maxWorkers: 20 }));
    expect(plan.nextActions.some((action) => /scope|workers/i.test(action))).toBe(true);
  });
  test('returns a natural-language remediation for invalid worker count', () => {
    const plan = planRdSwarmGraph(input({ maxWorkers: 0 }));
    expect(plan.nextActions).toEqual(expect.arrayContaining([expect.stringMatching(/positive integer|workers/i)]));
  });
  test('preserves all five waves when capped at forty workers', () => {
    const plan = planRdSwarmGraph(input({ maxWorkers: 50, requiresTechApproval: false }));
    expect(plan.workerTarget).toBe(40);
    expect(plan.waves).toHaveLength(5);
    expect(plan.tasks.length).toBeLessThanOrEqual(40);
  });
  test('keeps dry-run immutable', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'rd-swarm-immutable-'));
    planRdSwarmGraph(input({ workspaceRoot: workspace, requiresTechApproval: false }));
    expect(require('node:fs').readdirSync(workspace)).toEqual([]);
  });
});
