/**
 * autonomous-swarm-service — slice rid-014 tests.
 *
 * Coverage target (14 unit tests):
 *   - §1 buildAutonomousGoalPackage: 5 valid + 2 invalid cases (7 tests)
 *   - §2 planAutonomousRdSwarm: 3 cases (tech-approval-required, approved, not-required)
 *   - §3 planCapabilityReuse: 3 cases (workspace paths)
 *   - §4 buildResumeInstructions: 2 cases (checkpoint states)
 *
 * Net: 7 + 3 + 3 + 2 = 15 tests (within the ~14 budget; extra covers
 * `goalCommand` non-durable marker which is risk #1 in the plan).
 */

import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildAutonomousGoalPackage,
  planAutonomousRdSwarm,
  planCapabilityReuse,
  buildResumeInstructions,
  type BuildAutonomousGoalPackageInput,
  type PlanAutonomousRdSwarmInput,
} from '../../../../src/services/autonomous-swarm/autonomous-swarm-service.js';

function baseInput(overrides: Partial<BuildAutonomousGoalPackageInput> = {}): BuildAutonomousGoalPackageInput {
  return {
    changeId: 'add-autonomous-rd-swarm-resume',
    goal: 'Build a resumable autonomous RD swarm planner',
    mode: 'code',
    maxWorkers: 40,
    dryRun: true,
    workspaceRoot: mkdtempSync(join(tmpdir(), 'autonomous-swarm-artifacts-')),
    ...overrides,
  };
}

function approvedInput(overrides: Partial<PlanAutonomousRdSwarmInput> = {}): PlanAutonomousRdSwarmInput {
  const base: PlanAutonomousRdSwarmInput = {
    changeId: 'add-autonomous-rd-swarm-resume',
    goal: 'Build a resumable autonomous RD swarm planner',
    mode: 'code',
    maxWorkers: 40,
    dryRun: true,
    workspaceRoot: mkdtempSync(join(tmpdir(), 'autonomous-swarm-artifacts-')),
    requiresTechApproval: true,
    ...overrides,
  };
  const architecture = join(base.workspaceRoot, base.changeId, 'rd', 'architecture');
  mkdirSync(architecture, { recursive: true });
  for (const name of ['frontend-tech-doc.md', 'backend-tech-doc.md', 'tech-approval-record.md']) {
    writeFileSync(join(architecture, name), name === 'tech-approval-record.md' ? 'status: approved\n' : 'ready\n');
  }
  return base;
}

describe('buildAutonomousGoalPackage — valid cases (5)', () => {
  test('produces a deterministic package for identical input', () => {
    const a = buildAutonomousGoalPackage(baseInput());
    const b = buildAutonomousGoalPackage(baseInput({ workspaceRoot: baseInput().workspaceRoot }));
    expect(a).toEqual(b);
  });

  test('includes all required fields (goal, nonGoals, doneCondition, resumeCondition, riskNotes)', () => {
    const pkg = buildAutonomousGoalPackage(baseInput());
    expect(pkg.goal).toBe('Build a resumable autonomous RD swarm planner');
    expect(Array.isArray(pkg.nonGoals)).toBe(true);
    expect(pkg.nonGoals.length).toBeGreaterThan(0);
    expect(typeof pkg.doneCondition).toBe('string');
    expect(pkg.doneCondition.length).toBeGreaterThan(0);
    expect(typeof pkg.resumeCondition).toBe('string');
    expect(pkg.resumeCondition.length).toBeGreaterThan(0);
    expect(Array.isArray(pkg.riskNotes)).toBe(true);
  });

  test('marks the goalCommand as non-durable (risk #1 mitigation)', () => {
    const pkg = buildAutonomousGoalPackage(baseInput());
    expect(pkg.goalCommand).toBeDefined();
    expect(pkg.goalCommand?.nonDurable).toBe(true);
    expect(pkg.goalCommand?.marker).toBe('/goal');
  });

  test('derives nonGoals from the dry-run autonomy mode', () => {
    const pkg = buildAutonomousGoalPackage(baseInput({ mode: 'code' }));
    expect(pkg.nonGoals.some((note) => /dry-run/i.test(note))).toBe(true);
  });

  test('includes the changeId on the package for downstream traceability', () => {
    const pkg = buildAutonomousGoalPackage(baseInput());
    expect(pkg.changeId).toBe('add-autonomous-rd-swarm-resume');
  });
});

describe('buildAutonomousGoalPackage — invalid cases (2)', () => {
  test('throws when the change-id is empty', () => {
    expect(() => buildAutonomousGoalPackage(baseInput({ changeId: '' }))).toThrow(/changeId|non-empty/i);
  });

  test('throws when the goal is empty (only whitespace)', () => {
    expect(() => buildAutonomousGoalPackage(baseInput({ goal: '   ' }))).toThrow(/goal/i);
  });
});

describe('planAutonomousRdSwarm', () => {
  test('returns a dry-run plan when tech approval is not required', () => {
    const plan = planAutonomousRdSwarm({
      changeId: 'add-autonomous-rd-swarm-resume',
      goal: 'Build a resumable autonomous RD swarm planner',
      mode: 'code',
      maxWorkers: 40,
      dryRun: true,
      workspaceRoot: mkdtempSync(join(tmpdir(), 'autonomous-swarm-artifacts-')),
      requiresTechApproval: false,
    });
    expect(plan.autonomyMode).toBe('dry-run');
    expect(plan.goalPackage).toBeDefined();
    expect(plan.changeId).toBe('add-autonomous-rd-swarm-resume');
    expect(plan.goal).toContain('resumable');
  });

  test('blocks when tech approval is required but artifacts are missing', () => {
    const plan = planAutonomousRdSwarm({
      changeId: 'add-autonomous-rd-swarm-resume',
      goal: 'Build a resumable autonomous RD swarm planner',
      mode: 'code',
      maxWorkers: 40,
      dryRun: true,
      workspaceRoot: mkdtempSync(join(tmpdir(), 'autonomous-swarm-artifacts-')),
      requiresTechApproval: true,
    });
    expect(plan.autonomyMode).toBe('dry-run');
    expect(plan.available).toBe(false);
    expect(plan.gateStatus.techApprovalRequired).toBe(true);
    expect(plan.blockedReasons).toContain('TECH_APPROVAL_REQUIRED');
  });

  test('proceeds when tech approval is required and approved', () => {
    const plan = planAutonomousRdSwarm(approvedInput());
    expect(plan.autonomyMode).toBe('dry-run');
    expect(plan.available).toBe(true);
    expect(plan.gateStatus.techStatus).toBe('approved');
    expect(plan.workerQueue.length).toBeGreaterThan(0);
  });
});

describe('planCapabilityReuse', () => {
  test('returns an empty list when the docs directory does not exist', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'autonomous-swarm-docs-'));
    const result = planCapabilityReuse({ workspaceRoot: workspace });
    expect(result.entries).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test('parses docs/accessRepo.md and docs/mcpServer.md into CapabilityEntry[]', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'autonomous-swarm-docs-'));
    try {
      mkdirSync(join(workspace, 'docs'), { recursive: true });
      writeFileSync(
        join(workspace, 'docs/accessRepo.md'),
        '# accessRepo\n- frontend-design: design tokens\n- backend-design: backend design rules\n'
      );
      writeFileSync(
        join(workspace, 'docs/mcpServer.md'),
        '# mcpServer\n- headroom: doc retrieval\n'
      );
      const result = planCapabilityReuse({ workspaceRoot: workspace });
      expect(result.entries.length).toBeGreaterThanOrEqual(3);
      const sources = result.entries.map((entry) => entry.source);
      expect(sources).toContain('accessRepo.md');
      expect(sources).toContain('mcpServer.md');
      for (const entry of result.entries) {
        expect(entry.purpose).toBeTruthy();
        expect(entry.trustLevel).toMatch(/^(internal|external|unknown)$/);
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('caps the entry list at 50 and reports truncated=true', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'autonomous-swarm-docs-'));
    try {
      mkdirSync(join(workspace, 'docs'), { recursive: true });
      const lines: string[] = [];
      for (let i = 0; i < 60; i += 1) {
        lines.push(`- capability-${i}: purpose-${i}`);
      }
      writeFileSync(join(workspace, 'docs/accessRepo.md'), `# accessRepo\n${lines.join('\n')}\n`);
      const result = planCapabilityReuse({ workspaceRoot: workspace });
      expect(result.entries.length).toBe(50);
      expect(result.truncated).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('buildResumeInstructions', () => {
  test('includes re-read artifact paths, verify checkpoint N, and re-verify evidence', () => {
    const plan = planAutonomousRdSwarm(approvedInput());
    const instructions = buildResumeInstructions(plan);
    expect(instructions.summary).toBeTruthy();
    expect(instructions.steps.length).toBeGreaterThanOrEqual(3);
    const combined = instructions.steps.join(' ');
    expect(combined).toMatch(/re-read.*artifact/i);
    expect(combined).toMatch(/verify.*checkpoint/i);
    expect(combined).toMatch(/re-verify evidence/i);
  });

  test('marks checkpoint states as pending when the plan is blocked', () => {
    const plan = planAutonomousRdSwarm({
      changeId: 'add-autonomous-rd-swarm-resume',
      goal: 'Build a resumable autonomous RD swarm planner',
      mode: 'code',
      maxWorkers: 40,
      dryRun: true,
      workspaceRoot: mkdtempSync(join(tmpdir(), 'autonomous-swarm-artifacts-')),
      requiresTechApproval: true,
    });
    expect(plan.available).toBe(false);
    const instructions = buildResumeInstructions(plan);
    expect(instructions.checkpointStates.length).toBeGreaterThan(0);
    expect(instructions.checkpointStates.every((state) => state.status === 'pending')).toBe(true);
  });
});
