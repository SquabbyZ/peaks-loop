import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';
import { getLocalArtifactPath } from '../../src/services/artifacts/workspace-service.js';
import { TECH_REQUIRED_ARTIFACTS } from '../../src/services/tech/tech-service.js';
import { createWorkflowRouterPlan } from '../../src/services/workflow/workflow-router-service.js';
import { getSessionDir } from '../../src/services/session/getSessionDir.js';

function createApprovedWorkspace(sessionId: string): { workspace: WorkspaceConfig; artifactWorkspace: string } {
  const rootPath = mkdtempSync(join(tmpdir(), 'peaks-workflow-root-'));
  const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-workflow-artifacts-'));
  const workspace = {
    workspaceId: 'ws-workflow',
    name: 'Workflow Workspace',
    rootPath,
    installedCapabilityIds: [],
    artifactStorage: { mode: 'local' as const, localPath: artifactWorkspace }
  };
  const workspaceArtifactPath = getLocalArtifactPath(workspace);
  const architectureRoot = join(getSessionDir(workspaceArtifactPath, sessionId), 'rd', 'architecture');
  mkdirSync(join(workspaceArtifactPath, '.peaks'), { recursive: true });
  mkdirSync(architectureRoot, { recursive: true });
  writeFileSync(join(workspaceArtifactPath, '.peaks', 'config.json'), '{}', 'utf8');
  for (const artifact of TECH_REQUIRED_ARTIFACTS) {
    writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
  }

  return {
    workspace,
    artifactWorkspace: workspaceArtifactPath
  };
}

describe('createWorkflowRouterPlan', () => {
  test('creates a full-auto solo route with broad cost-tiered model hints', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'solo-refactor', goal: 'Refactor checkout flow', mode: 'solo', dryRun: true });

    expect(plan.routePolicy).toBe('solo-broad-multi-model');
    expect(plan.mode).toBe('solo');
    expect(plan.soloMode).toBe('full-auto');
    expect(plan.executionMode).toBe('autonomous');
    expect(plan.decisionProfile).toContain('Full-auto mode');
    expect(plan.constraints).toEqual(['dry-run-only', 'requires-swarm-execution-for-rd-and-qa-when-enabled', 'execution-model-from-config-providers', 'do-not-launch-agents', 'do-not-write-artifacts', 'do-not-mutate-target-repo']);
    expect(plan.steps.filter((step) => step.modelTier === 'top-tier').map((step) => step.stage)).toEqual(['product-direction', 'design-direction', 'tech-direction', 'tech-review', 'rd-planning', 'quality-review']);
    expect(plan.steps.filter((step) => step.modelTier === 'mid-tier').map((step) => step.stage)).toEqual(['coding-execution', 'unit-test-execution']);
    expect(plan.steps.every((step) => step.dryRunOnly && !step.invokesAgents && !step.writesArtifacts)).toBe(true);
    expect(plan.steps.find((step) => step.stage === 'product-direction')?.reason).toContain('[full-auto] decision stage');
    expect(plan.steps.find((step) => step.stage === 'coding-execution')?.reason).toContain('[routed] execution stage');
  });

  test('rejects invalid solo mode values at the service boundary', () => {
    expect(() => createWorkflowRouterPlan({ sessionId: 'blank-solo-mode', goal: 'Refactor checkout flow', mode: 'solo', soloMode: '' as 'guided', dryRun: true })).toThrow('Unsupported solo mode');
  });

  test('creates a team route that limits mid-tier execution to peaks-rd', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'team-refactor', goal: 'Refactor checkout flow', mode: 'team', dryRun: true });

    expect(plan.routePolicy).toBe('team-rd-limited-multi-model');
    expect(plan.mode).toBe('team');
    expect(plan.executionMode).toBe('autonomous');
    expect(plan.decisionProfile).toContain('Team mode');
    expect(plan.soloMode).toBeUndefined();
    expect(plan.steps.filter((step) => step.modelTier === 'mid-tier').every((step) => step.owner === 'peaks-rd')).toBe(true);
    expect(plan.steps.find((step) => step.stage === 'product-direction')?.owner).toBe('human');
    expect(plan.steps.find((step) => step.stage === 'quality-review')?.modelTier).toBe('top-tier');
  });

  test('annotates guided and rnd solo routes differently while keeping execution autonomous', () => {
    const guidedPlan = createWorkflowRouterPlan({ sessionId: 'guided-refactor', goal: 'Refactor checkout flow', mode: 'solo', soloMode: 'guided', dryRun: true });
    const rndPlan = createWorkflowRouterPlan({ sessionId: 'rnd-refactor', goal: 'Refactor checkout flow', mode: 'solo', soloMode: 'rnd', dryRun: true });

    expect(guidedPlan.soloMode).toBe('guided');
    expect(guidedPlan.executionMode).toBe('autonomous');
    expect(guidedPlan.steps.find((step) => step.stage === 'product-direction')?.reason).toContain('[guided] decision stage');
    expect(guidedPlan.steps.find((step) => step.stage === 'tech-direction')?.reason).toContain('[routed] execution stage');

    expect(rndPlan.soloMode).toBe('rnd');
    expect(rndPlan.executionMode).toBe('autonomous');
    expect(rndPlan.steps.find((step) => step.stage === 'tech-direction')?.reason).toContain('[rnd] decision stage');
    expect(rndPlan.steps.find((step) => step.stage === 'coding-execution')?.reason).toContain('[routed] execution stage');
  });

  test('routes product design tech and review to strongest model while economy execution uses the configured provider model', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'model-routing', goal: 'Refactor checkout flow', mode: 'solo', dryRun: true, config: { providers: { customProvider: { model: 'custom-exec-model-v1' } } } });

    expect(plan.modeStatus.economyModeEnabled).toBe(true);
    expect(plan.modeStatus.swarmModeEnabled).toBe(true);
    expect(plan.modeStatus.executionModelId).toBe('custom-exec-model-v1');
    expect(plan.modeStatus.executionModelSource).toBe('config.providers');
    expect(plan.modeStatus.summary).toContain('Economy mode enabled');
    expect(plan.modeStatus.summary).toContain('Swarm mode enabled');
    expect(plan.modelRouting.strongestModel.modelId).toBe('claude-opus-4-7');
    expect(plan.modelRouting.executionModel.modelId).toBe('custom-exec-model-v1');
    expect(plan.techPlan.available ? plan.techPlan.swarm : plan.techPlan.preview.swarm).toBe(true);
    expect(plan.steps.filter((step) => step.stage !== 'coding-execution' && step.stage !== 'unit-test-execution').every((step) => step.modelRole === 'strongest')).toBe(true);
    expect(plan.steps.filter((step) => step.stage === 'coding-execution' || step.stage === 'unit-test-execution').every((step) => step.modelRole === 'execution')).toBe(true);
    expect(plan.steps.find((step) => step.stage === 'coding-execution')?.modelId).toBe('custom-exec-model-v1');
    expect(plan.steps.find((step) => step.stage === 'unit-test-execution')?.modelId).toBe('custom-exec-model-v1');
    expect(plan.steps.find((step) => step.stage === 'quality-review')?.modelId).toBe('claude-opus-4-7');
    expect(plan.modelAssignments).toEqual(plan.steps.map((step) => ({ stage: step.stage, owner: step.owner, modelTier: step.modelTier, modelRole: step.modelRole, modelId: step.modelId })));
    expect(plan.modelAssignments.filter((assignment) => assignment.modelRole === 'execution').map((assignment) => assignment.stage)).toEqual(['coding-execution', 'unit-test-execution']);
  });

  test('routes code and test workers to strongest model when economy mode is disabled', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'no-economy-routing', goal: 'Refactor checkout flow', mode: 'solo', dryRun: true, config: { economyMode: false } });

    expect(plan.modeStatus.economyModeEnabled).toBe(false);
    expect(plan.modeStatus.executionModelId).toBe('claude-opus-4-7');
    expect(plan.modeStatus.summary).toContain('Economy mode disabled');
    expect(plan.modelRouting.executionModel.modelId).toBe('claude-opus-4-7');
    expect(plan.steps.find((step) => step.stage === 'coding-execution')?.modelId).toBe('claude-opus-4-7');
    expect(plan.steps.find((step) => step.stage === 'unit-test-execution')?.modelId).toBe('claude-opus-4-7');
  });

  test('routes team code and test workers to strongest top-tier model when economy mode is disabled', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'team-no-economy-routing', goal: 'Refactor checkout flow', mode: 'team', dryRun: true, config: { economyMode: false, providers: {} } });

    expect(plan.mode).toBe('team');
    expect(plan.modeStatus.economyModeEnabled).toBe(false);
    expect(plan.modeStatus.executionModelId).toBe('claude-opus-4-7');
    expect(plan.steps.find((step) => step.id === 'team-coding-execution')?.modelTier).toBe('top-tier');
    expect(plan.steps.find((step) => step.id === 'team-unit-test-execution')?.modelTier).toBe('top-tier');
    expect(plan.steps.find((step) => step.id === 'team-coding-execution')?.modelRole).toBe('execution');
    expect(plan.steps.find((step) => step.id === 'team-unit-test-execution')?.modelRole).toBe('execution');
    expect(plan.steps.find((step) => step.id === 'team-coding-execution')?.modelId).toBe('claude-opus-4-7');
    expect(plan.steps.find((step) => step.id === 'team-unit-test-execution')?.modelId).toBe('claude-opus-4-7');
  });

  test('keeps swarm mode explicit and disables swarm planning only when config opts out', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'no-swarm-routing', goal: 'Fix checkout retry typo', mode: 'solo', dryRun: true, config: { swarmMode: false } });

    expect(plan.modeStatus.swarmModeEnabled).toBe(false);
    expect(plan.modeStatus.summary).toContain('Swarm mode disabled');
    expect(plan.techPlan.available ? plan.techPlan.swarm : plan.techPlan.preview.swarm).toBe(false);
    expect(plan.rdPlan.swarmMode).toBe(false);
    expect(plan.rdPlan.tasks).toEqual([]);
    expect(plan.blockedReasons).not.toContain('swarm-mode-disabled');
  });

  test('normalizes configured provider model before assigning execution workers', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'trimmed-provider-model', goal: 'Fix checkout retry typo', mode: 'solo', dryRun: true, config: { providers: { customProvider: { model: '  custom-exec-model-v1  ' } } } });

    expect(plan.modeStatus.executionModelId).toBe('custom-exec-model-v1');
    expect(plan.steps.find((step) => step.stage === 'coding-execution')?.modelId).toBe('custom-exec-model-v1');
    expect(plan.rdPlan.available).toBe(false);
    expect(plan.rdPlan.workerTarget).toBe(40);
  });

  test('rejects economy routing when providers do not configure an execution model', () => {
    expect(() => createWorkflowRouterPlan({ sessionId: 'missing-provider-model', goal: 'Fix checkout retry typo', mode: 'solo', dryRun: true, config: { providers: {} } })).toThrow('Execution model must be configured in providers');
  });

  test('propagates configured provider model into the RD swarm worker graph', () => {
    const { workspace, artifactWorkspace } = createApprovedWorkspace('custom-provider-model');
    const plan = createWorkflowRouterPlan({
      sessionId: 'custom-provider-model',
      goal: 'Implement approved checkout refactor',
      mode: 'solo',
      maxWorkers: 40,
      dryRun: true,
      config: { providers: { customProvider: { model: 'custom-exec-model-v1' } } },
      artifactWorkspacePath: artifactWorkspace,
      workspace
    });

    expect(plan.modeStatus.executionModelId).toBe('custom-exec-model-v1');
    expect(plan.modelRouting.executionModel.modelId).toBe('custom-exec-model-v1');
    expect(plan.rdPlan.tasks.filter((task) => task.wave === 'implementation candidates' || task.wave === 'unit-test execution').every((task) => task.modelId === 'custom-exec-model-v1')).toBe(true);
  });

  test('routes solo-called peaks-rd coding, unit-test, and qa stages into swarm tasks when swarm mode is enabled', () => {
    const { workspace, artifactWorkspace } = createApprovedWorkspace('solo-rd-qa-swarm');
    const plan = createWorkflowRouterPlan({
      sessionId: 'solo-rd-qa-swarm',
      goal: 'Implement approved checkout refactor',
      mode: 'solo',
      maxWorkers: 40,
      dryRun: true,
      config: { providers: { customProvider: { model: 'custom-exec-model-v1' } } },
      artifactWorkspacePath: artifactWorkspace,
      workspace
    });

    expect(plan.mode).toBe('solo');
    expect(plan.modeStatus.swarmModeEnabled).toBe(true);
    expect(plan.rdPlan.swarmMode).toBe(true);
    expect(plan.constraints).toContain('requires-swarm-execution-for-rd-and-qa-when-enabled');
    expect(plan.rdPlan.tasks.filter((task) => task.wave === 'implementation candidates').length).toBeGreaterThan(0);
    expect(plan.rdPlan.tasks.filter((task) => task.wave === 'unit-test execution').length).toBeGreaterThan(0);
    expect(plan.rdPlan.tasks.filter((task) => task.wave === 'quality gates').length).toBeGreaterThan(0);
    expect(plan.rdPlan.tasks.filter((task) => task.wave === 'implementation candidates' || task.wave === 'unit-test execution').every((task) => task.modelRole === 'execution' && task.modelId === plan.modeStatus.executionModelId)).toBe(true);
    expect(plan.rdPlan.tasks.filter((task) => task.wave === 'quality gates').every((task) => task.workerKind.startsWith('peaks-qa-') && task.expectedEvidence.includes('qa'))).toBe(true);
  });

  test('keeps missing artifact workspace as a preview-safe planning constraint', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'missing-artifacts', goal: 'Fix checkout retry typo', mode: 'solo', dryRun: true });

    expect(plan.techStatus.status).toBe('unavailable');
    expect(plan.techPlan.available).toBe(false);
    expect(plan.rdPlan.available).toBe(false);
    expect(plan.blockedReasons).toContain('artifact-workspace-unavailable');
    expect(plan.nextActions.length).toBeGreaterThan(0);
  });

  test('defaults RD worker target to forty workers', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'default-workers', goal: 'Fix checkout retry typo', mode: 'solo', dryRun: true });

    expect(plan.rdPlan.workerTarget).toBe(40);
  });

  test('passes max workers into RD planning', () => {
    const plan = createWorkflowRouterPlan({ sessionId: 'custom-workers', goal: 'Fix checkout retry typo', mode: 'solo', maxWorkers: 25, dryRun: true });

    expect(plan.rdPlan.workerTarget).toBe(25);
  });

  test('merges non-workspace blocked reasons and next actions when artifacts are available', () => {
    const { workspace, artifactWorkspace } = createApprovedWorkspace('available-artifacts');
    const plan = createWorkflowRouterPlan({
      sessionId: 'available-artifacts',
      goal: 'Fix checkout retry typo',
      mode: 'solo',
      maxWorkers: 24,
      dryRun: true,
      artifactWorkspacePath: artifactWorkspace,
      workspace
    });

    expect(plan.techStatus.status).toBe('approved');
    expect(plan.techPlan.available).toBe(true);
    expect(plan.rdPlan.available).toBe(false);
    expect(plan.blockedReasons).toEqual(['worker-count-below-target']);
    expect(plan.nextActions).toEqual(['Lower max-workers to match the current change scope or accept the capped target.']);
  });

  test('uses the workspace default artifact path for workflow planning', () => {
    const { workspace } = createApprovedWorkspace('default-workflow-artifacts');
    const plan = createWorkflowRouterPlan({
      sessionId: 'default-workflow-artifacts',
      goal: 'Fix checkout retry typo',
      mode: 'solo',
      maxWorkers: 40,
      dryRun: true,
      workspace
    });

    expect(plan.techStatus.status).toBe('approved');
    expect(plan.techPlan.available).toBe(true);
    expect(plan.rdPlan.available).toBe(true);
    expect(plan.blockedReasons).toEqual([]);
  });

  test('returns no next actions when all route prerequisites are available', () => {
    const { workspace, artifactWorkspace } = createApprovedWorkspace('approved-route');
    const plan = createWorkflowRouterPlan({
      sessionId: 'approved-route',
      goal: 'Fix checkout retry typo',
      mode: 'solo',
      maxWorkers: 40,
      dryRun: true,
      artifactWorkspacePath: artifactWorkspace,
      workspace
    });

    expect(plan.techPlan.available).toBe(true);
    expect(plan.rdPlan.available).toBe(true);
    expect(plan.blockedReasons).toEqual([]);
    expect(plan.nextActions).toEqual([]);
  });

  test('rejects invalid change id, empty goal, and unsupported mode', () => {
    // Slice 2026-06-29-change-id-root-removal: `validateChangeIdOrThrow`
    // was removed — the change-id is metadata-only. The empty-goal,
    // unsupported-mode, and team-solo-mode contracts are preserved.
    expect(() => createWorkflowRouterPlan({ sessionId: 'empty-goal', goal: '   ', mode: 'solo', dryRun: true })).toThrow('Goal must be non-empty');
    expect(() => createWorkflowRouterPlan({ sessionId: 'bad-mode', goal: 'Fix checkout retry typo', mode: 'enterprise' as 'solo', dryRun: true })).toThrow('Unsupported workflow mode');
    expect(() => createWorkflowRouterPlan({ sessionId: 'team-solo-mode', goal: 'Fix checkout retry typo', mode: 'team', soloMode: 'guided', dryRun: true })).toThrow('soloMode requires solo workflow mode');
  });
});
