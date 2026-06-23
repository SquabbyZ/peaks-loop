import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';
import { getLocalArtifactPath } from '../../src/services/artifacts/workspace-service.js';
import { createRdSwarmPlan } from '../../src/services/rd/rd-service.js';
import { getChangeScopeDirAbs } from '../../src/services/artifacts/change-scope-service.js';
import { TECH_REQUIRED_ARTIFACTS } from '../../src/services/tech/tech-service.js';

function createWorkspaceWithArtifactWorkspace(): { workspace: WorkspaceConfig; artifactWorkspace: string } {
  const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-rd-default-artifacts-'));
  const workspace = createWorkspace(undefined, artifactWorkspace);
  mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
  writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
  return { workspace, artifactWorkspace: getLocalArtifactPath(workspace) };
}

function createWorkspace(rootPath = mkdtempSync(join(tmpdir(), 'peaks-rd-root-')), artifactWorkspace?: string): WorkspaceConfig {
  return {
    workspaceId: 'ws-rd',
    name: 'RD Workspace',
    rootPath,
    installedCapabilityIds: [],
    ...(artifactWorkspace ? { artifactStorage: { mode: 'local' as const, localPath: artifactWorkspace } } : {})
  };
}

describe('createRdSwarmPlan', () => {
  test('generates deterministic waves, worker target, and artifact paths', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 40, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    expect(plan.swarmMode).toBe(true);
    expect(plan.workerTarget).toBe(40);
    expect(plan.waves.map((wave) => wave.name)).toEqual(['discovery', 'planning', 'implementation candidates', 'unit-test execution', 'quality gates', 'reducer']);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(25);
    expect(plan.tasks.length).toBeLessThanOrEqual(40);
    expect(plan.tasks.length).toBeLessThanOrEqual(plan.workerTarget);
    expect(plan.outputs.taskGraph).toBe('.peaks/_runtime/change/checkout-refactor/rd/swarm/task-graph.json');
    expect(plan.outputs.reducerReport).toBe('.peaks/_runtime/change/checkout-refactor/rd/swarm/reducer-report.md');

    const conflictGroupIds = new Set(plan.conflictGroups.map((group) => group.groupId));
    for (const task of plan.tasks) {
      const owningWave = plan.waves.find((wave) => wave.taskIds.includes(task.taskId));
      expect(owningWave?.name).toBe(task.wave);
      expect(task.taskId.startsWith('rd-') || task.taskId.startsWith('peaks-qa-')).toBe(true);
      expect(task.workerKind.length).toBeGreaterThan(0);
      expect(task.purpose).toContain('Implement approved checkout refactor');
      expect(task.modelRole).toBe(task.wave === 'implementation candidates' || task.wave === 'unit-test execution' ? 'execution' : 'strongest');
      expect(task.modelId).toBe(task.wave === 'implementation candidates' || task.wave === 'unit-test execution' ? 'minimax-2.7' : 'claude-opus-4-7');
      expect(task.inputs.length).toBeGreaterThan(0);
      expect(task.outputs.every((output) => output.startsWith('.peaks/_runtime/change/checkout-refactor/rd/swarm/'))).toBe(true);
      expect(task.outputs.every((output) => !output.includes('\\'))).toBe(true);
      expect(conflictGroupIds.has(task.conflictGroup)).toBe(true);
      expect(task.targetArea.length).toBeGreaterThan(0);
      expect(task.expectedEvidence.length).toBeGreaterThan(0);
    }

    expect(plan.tasks.filter((task) => task.wave === 'discovery').every((task) => task.dependsOn.length === 0)).toBe(true);
    expect(plan.tasks.filter((task) => task.wave === 'planning').every((task) => task.dependsOn.length === 8)).toBe(true);
    expect(plan.tasks.filter((task) => task.wave === 'implementation candidates').every((task) => task.dependsOn.length === 8)).toBe(true);
    expect(plan.tasks.filter((task) => task.wave === 'unit-test execution').every((task) => task.dependsOn.length === plan.waves[2]?.taskIds.length)).toBe(true);
    expect(plan.tasks.filter((task) => task.wave === 'quality gates').every((task) => task.dependsOn.length === plan.waves[3]?.taskIds.length)).toBe(true);
    expect(plan.tasks.filter((task) => task.wave === 'reducer').every((task) => task.dependsOn.length === 4)).toBe(true);
  });

  test('blocks RD swarm planning when tech approval is required but not approved', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: pending' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 40, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(false);
    expect(plan.swarmMode).toBe(true);
    expect(plan.tasks).toEqual([]);
    expect(plan.gateStatus.techApprovalRequired).toBe(true);
    expect(plan.gateStatus.techStatus).not.toBe('approved');
    expect(plan.blockedReasons).toContain('tech-approval-required');
    expect(plan.nextActions).toEqual(['Run peaks tech plan --dry-run and approve the tech plan before running peaks swarm plan.']);
  });

  test('uses the workspace default artifact path when no explicit artifact path is provided', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'default-artifact-workspace'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'default-artifact-workspace', goal: 'Implement approved checkout refactor', maxWorkers: 40, dryRun: true, workspace });

    expect(plan.available).toBe(true);
    expect(plan.outputs.taskGraph).toBe('.peaks/_runtime/change/default-artifact-workspace/rd/swarm/task-graph.json');
    expect(plan.blockedReasons).toEqual([]);
  });

  test('represents coding and unit-test execution as configured-model swarm workers', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'configured-execution-workers'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({
      skill: 'rd',
      changeId: 'configured-execution-workers',
      goal: 'Implement approved checkout refactor',
      maxWorkers: 40,
      executionModelId: 'custom-exec-model-v1',
      dryRun: true,
      artifactWorkspacePath: artifactWorkspace,
      workspace
    });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    const codingTasks = plan.tasks.filter((task) => task.wave === 'implementation candidates');
    const unitTestTasks = plan.tasks.filter((task) => task.wave === 'unit-test execution');
    expect(codingTasks.length).toBeGreaterThan(0);
    expect(unitTestTasks.length).toBeGreaterThan(0);
    expect([...codingTasks, ...unitTestTasks].every((task) => task.modelRole === 'execution' && task.modelId === 'custom-exec-model-v1')).toBe(true);
    expect([...codingTasks, ...unitTestTasks].every((task) => task.expectedEvidence.includes('patch') || task.expectedEvidence.includes('test'))).toBe(true);
    expect(plan.tasks.filter((task) => task.modelRole === 'execution').every((task) => task.modelId !== 'minimax-2.7')).toBe(true);
  });

  test('derives implementation target areas from approved tech artifacts', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? '# Frontend\n\nImplementation target areas:\n- `packages/client/src/stores/authStore.ts` - auth store changes\n- `packages/admin/src/services/marketplaceApi.ts`\n- `packages/client/../.env`\n- `packages/client\\src\\secrets.ts`\n- `C:/src/secrets.ts`\n- `/tmp/repo/src/secrets.ts`\n- `../src/secrets.ts`\n\n## Rejected paths\n- `packages/client/src/forbidden.ts`'
          : artifact === 'backend-tech-doc.md'
            ? '# Backend\n\nImplementation target areas:\n- `packages/server/src/ai-models/ai-models.service.ts`'
            : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 40, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
    expect(targetAreas).toContain('packages/client/src/stores/authStore.ts');
    expect(targetAreas).toContain('packages/admin/src/services/marketplaceApi.ts');
    expect(targetAreas).toContain('packages/server/src/ai-models/ai-models.service.ts');
    expect(targetAreas).not.toContain('packages/client/../.env');
    expect(targetAreas).not.toContain('packages/client\\src\\secrets.ts');
    expect(targetAreas).not.toContain('C:/src/secrets.ts');
    expect(targetAreas).not.toContain('/tmp/repo/src/secrets.ts');
    expect(targetAreas).not.toContain('../src/secrets.ts');
    expect(targetAreas).not.toContain('src/secrets.ts');
    expect(targetAreas).not.toContain('packages/client/src/forbidden.ts');
    expect(targetAreas).not.toContain('area-1');
    expect(targetAreas).not.toContain('area-2');
    expect(plan.tasks.filter((task) => task.wave === 'implementation candidates' || task.wave === 'unit-test execution').every((task) => task.modelRole === 'execution' && task.modelId === 'minimax-2.7')).toBe(true);
    expect(plan.tasks.filter((task) => task.wave === 'quality gates' || task.wave === 'reducer').every((task) => task.modelRole === 'strongest' && task.modelId === 'claude-opus-4-7')).toBe(true);
  });

  test('ignores empty implementation target area sections', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : 'Implementation target areas:\n\n## Notes\n- no concrete target yet';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
    expect(targetAreas.every((targetArea) => targetArea === 'area-implementation candidates')).toBe(true);
  });

  test('ignores artifact target areas when tech artifacts are not approved', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    writeFileSync(join(architectureRoot, 'frontend-tech-doc.md'), 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`', 'utf8');

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
    expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
    expect(targetAreas.every((targetArea) => targetArea === 'area-implementation candidates')).toBe(true);
  });

  test('keeps tasks within a wave independent for parallel execution', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 40, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    for (const wave of plan.waves) {
      const taskIds = new Set(wave.taskIds);
      for (const task of plan.tasks.filter((candidate) => candidate.wave === wave.name)) {
        expect(task.dependsOn.some((dependency) => taskIds.has(dependency))).toBe(false);
      }
      const conflictGroup = plan.conflictGroups.find((group) => group.groupId === `group-${wave.name.replace(/\s+/g, '-')}`);
      expect(conflictGroup?.parallelismPolicy).toBe(wave.taskIds.length > 1 ? 'parallel' : 'sequential');
    }
  });

  test('blocks when worker count is below target', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 10, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.behavior).toBe('blocked');
    expect(plan.blockedReasons).toContain('worker-count-below-target');
    expect(plan.tasks.length).toBeLessThanOrEqual(plan.workerTarget);
  });

  test('does not mark the tech gate skipped when governed work has too few workers', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 10, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.gateStatus.techApprovalRequired).toBe(true);
    expect(plan.gateStatus.skipReason).toBeUndefined();
    expect(plan.blockedReasons).toContain('worker-count-below-target');
  });

  test('supports larger safe swarm plans up to eighty workers', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 80, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    expect(plan.workerTarget).toBe(80);
    expect(plan.tasks.length).toBeLessThanOrEqual(80);
    expect(plan.tasks.filter((task) => task.wave === 'implementation candidates').length).toBeGreaterThan(40);
  });

  test('caps worker count above eighty', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 99, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.workerTarget).toBe(80);
    expect(plan.blockedReasons).toContain('worker-count-capped');
  });

  test('returns capped approved swarm plans with next actions', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 99, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.workerTarget).toBe(80);
    expect(plan.blockedReasons).toContain('worker-count-capped');
    expect(plan.nextActions).toEqual(['Lower max-workers to match the current change scope or accept the capped target.']);
  });

  test('blocks when tech approval is required but missing', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Change checkout behavior', maxWorkers: 40, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.blockedReasons).toContain('tech-approval-required');
    expect(plan.nextActions.join('\n')).toContain('peaks tech');
  });

  test('skips tech gate for a clear bug fix path', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    expect(plan.gateStatus.techApprovalRequired).toBe(false);
    expect(plan.gateStatus.skipReason).toBe('tech-gate-skipped-clear-implementation-path');
  });

  test('returns preview when artifact workspace is unavailable for persistence', () => {
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.swarmMode).toBe(true);
    expect(plan.behavior).toBe('preview');
    expect(plan.reason).toContain('artifact-workspace-unavailable');
  });

  test('does not create worker waves when swarm mode is explicitly disabled', () => {
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, swarmMode: false, dryRun: true });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.swarmMode).toBe(false);
    expect(plan.waves).toEqual([]);
    expect(plan.tasks).toEqual([]);
    expect(plan.conflictGroups).toEqual([]);
    expect(plan.gateStatus.skipReason).toBe('tech-gate-skipped-clear-implementation-path');
    expect(plan.blockedReasons).not.toContain('swarm-mode-disabled');
  });

  test('does not mark the tech gate skipped when swarm mode is disabled for governed goals', () => {
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, swarmMode: false, dryRun: true });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.swarmMode).toBe(false);
    expect(plan.gateStatus.techApprovalRequired).toBe(true);
    expect(plan.gateStatus.skipReason).toBeUndefined();
    expect(plan.waves).toEqual([]);
    expect(plan.tasks).toEqual([]);
  });

  test('returns preview when artifact workspace path has no marker', () => {
    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true, artifactWorkspacePath: mkdtempSync(join(tmpdir(), 'peaks-rd-unmarked-')) });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.behavior).toBe('preview');
    expect(plan.reason).toContain('artifact-workspace-unavailable');
  });

  test('accepts artifact workspace inside the project root', () => {
    const workspace = createWorkspace();
    const projectArtifactWorkspace = join(workspace.rootPath, '.peaks-artifacts');
    mkdirSync(join(projectArtifactWorkspace, '.peaks'), { recursive: true });
    writeFileSync(join(projectArtifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true, artifactWorkspacePath: projectArtifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    expect(plan.gateStatus.techApprovalRequired).toBe(false);
    expect(plan.gateStatus.skipReason).toBe('tech-gate-skipped-clear-implementation-path');
  });

  test('rejects invalid change id, invalid worker counts, unsupported skill, and empty goal', () => {
    expect(() => createRdSwarmPlan({ skill: 'rd', changeId: 'foo/bar', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true })).toThrow('Invalid change-id');
    expect(() => createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: Number.NaN, dryRun: true })).toThrow('max-workers must be a positive integer');
    expect(() => createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25.5, dryRun: true })).toThrow('max-workers must be a positive integer');
    expect(() => createRdSwarmPlan({ skill: 'qa' as 'rd', changeId: 'checkout-refactor', goal: 'Fix checkout retry typo', maxWorkers: 25, dryRun: true })).toThrow('Unsupported skill');
    expect(() => createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: '   ', maxWorkers: 25, dryRun: true })).toThrow('Goal must be non-empty');
  });
});
