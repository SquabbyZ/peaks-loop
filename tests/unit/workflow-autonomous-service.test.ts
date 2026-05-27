import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/services/config/config-types.js';
import { getLocalArtifactPath } from '../../src/services/artifacts/workspace-service.js';
import { createAutonomousWorkflowPlan } from '../../src/services/workflow/workflow-autonomous-service.js';
import { createWorkspace, createWorkspaceWithArtifactWorkspace, writeApprovedTechArtifacts, writeResumeArtifacts } from './helpers/workflow-autonomous-test-helpers.js';

describe('createAutonomousWorkflowPlan', () => {
  test('creates a resumable autonomous goal package and dry-run constraints', () => {
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      soloMode: 'guided',
      changeId: 'ice-cola-governance',
      goal: 'Govern the Ice Cola project without changing product behavior',
      maxWorkers: 40,
      dryRun: true
    });

    expect(plan.changeId).toBe('ice-cola-governance');
    expect(plan.mode).toBe('solo');
    expect(plan.routePlan.soloMode).toBe('guided');
    expect(plan.routePlan.executionMode).toBe('autonomous');
    expect(plan.dryRun).toBe(true);
    expect(plan.goalPackage.doneCondition).toContain('acceptance criteria pass');
    expect(plan.goalPackage.resumeCondition).toContain('checkpoint');
    expect(plan.goalPackage.nonGoals).toContain('Change product behavior without explicit approval.');
    expect(plan.constraints).toContain('dry-run-only');
    expect(plan.constraints).toContain('do-not-launch-workers');
    expect(plan.goalCommand.durable).toBe(false);
    expect(plan.goalCommand.command).toContain('/goal');
    expect(plan.modelAssignments).toEqual(plan.routePlan.modelAssignments);
    expect(plan.modelAssignments.filter((assignment) => assignment.modelRole === 'execution').map((assignment) => assignment.modelId)).toEqual(['minimax-2.7', 'minimax-2.7']);
    expect(plan.modelAssignments.filter((assignment) => assignment.modelRole === 'strongest').every((assignment) => assignment.modelId === 'claude-opus-4-7')).toBe(true);
    expect(plan.mvpPackage).toMatchObject({
      mode: 'solo',
      soloMode: 'guided',
      executionMode: 'preview',
      dryRun: true,
      ready: false
    });
    expect(plan.mvpPackage.routePolicy).toBe(plan.routePlan.routePolicy);
    expect(plan.mvpPackage.rdWaveNames).toEqual(plan.rdPlan.waves.map((wave) => wave.name));
  });

  test('models curated accessRepo and mcpServer capabilities without activation', () => {
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'capability-reuse',
      goal: 'Plan capability reuse for frontend governance',
      dryRun: true
    });

    expect(plan.capabilityPlan.sources).toEqual(expect.arrayContaining(['docs/accessRepo.md', 'docs/mcpServer.md', 'skills/*/SKILL.md', 'context7', 'everything-claude-code']));
    expect(plan.capabilityPlan.candidates.map((candidate) => candidate.purpose)).toContain('browser-validation');
    expect(plan.capabilityPlan.candidates.map((candidate) => candidate.purpose)).toContain('browser-debug');
    expect(plan.capabilityPlan.candidates.map((candidate) => candidate.purpose)).toContain('docs-lookup');
    expect(plan.capabilityPlan.candidates.map((candidate) => candidate.purpose)).toContain('skill-pack');
    expect(plan.capabilityPlan.candidates.map((candidate) => candidate.purpose)).toContain('cloud-skill-pack');
    expect(plan.capabilityPlan.candidates.filter((candidate) => candidate.trustLevel === 'user-curated').every((candidate) => candidate.activation === 'not-active')).toBe(true);
    expect(plan.capabilityPlan.candidates.find((candidate) => candidate.id === 'local-peaks-skills')?.activation).toBe('available');
    expect(plan.capabilityPlan.policy).toContain('reuse-curated-capabilities-before-custom-build');
    expect(plan.capabilityPlan.surfaces).toEqual(['skill', 'mcp', 'plugin', 'expert']);
    expect(plan.capabilityPlan.surfaceSummary).toEqual(plan.mvpPackage.capabilityCountBySurface);
    expect(plan.mvpPackage.capabilitySurfaces).toEqual(['skill', 'mcp', 'plugin', 'expert']);
    expect(plan.mvpPackage.capabilityCountBySurface.skill).toBeGreaterThan(0);
    expect(plan.mvpPackage.capabilityCountBySurface.mcp).toBeGreaterThan(0);
    expect(plan.mvpPackage.capabilityCountBySurface.plugin).toBeGreaterThan(0);
    expect(plan.mvpPackage.capabilityCountBySurface.expert).toBeGreaterThan(0);
  });

  test('maps installed non-MCP capabilities to available activation', () => {
    const workspace = createWorkspace();
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'installed-agent-capability',
      goal: 'Plan with an installed code review agent',
      dryRun: true,
      workspace: {
        ...workspace,
        installedCapabilityIds: ['everything-claude-code.code-review-agent']
      }
    });

    expect(plan.capabilityPlan.candidates.find((candidate) => candidate.id === 'everything-claude-code.code-review-agent')?.activation).toBe('available');
  });

  test('maps catalog capability activation states from availability', async () => {
    vi.resetModules();
    const items = [
      {
        capabilityId: 'local-template.installable',
        sourceId: 'local-peaks-skills',
        name: 'Local Template',
        itemType: 'template' as const,
        category: 'custom-local-category',
        workflows: ['code-refactor'],
        audience: ['engineer'],
        riskLevel: 'low' as const,
        fallback: { mode: 'manual-local-template', qualityImpact: 'same' },
        presentation: { displayName: { en: 'Local Template' }, description: { en: 'Local template.' } }
      },
      {
        capabilityId: 'external-mcp.installable',
        sourceId: 'external-mcp-source',
        name: 'External MCP',
        itemType: 'mcp' as const,
        category: 'docs-lookup',
        workflows: ['code-refactor'],
        audience: ['engineer'],
        riskLevel: 'medium' as const,
        fallback: { mode: 'manual-docs', qualityImpact: 'lower' },
        presentation: { displayName: { en: 'External MCP' }, description: { en: 'External MCP.' } }
      },
      {
        capabilityId: 'disabled-agent.capability',
        sourceId: 'agent-source',
        name: 'Disabled Agent',
        itemType: 'agent' as const,
        category: 'code-review',
        workflows: ['code-refactor'],
        audience: ['engineer'],
        riskLevel: 'low' as const,
        fallback: { mode: 'manual-review', qualityImpact: 'lower' },
        presentation: { displayName: { en: 'Disabled Agent' }, description: { en: 'Disabled agent.' } }
      },
      {
        capabilityId: 'missing-mcp-availability.capability',
        sourceId: 'mcp-source',
        name: 'Missing MCP Availability',
        itemType: 'mcp' as const,
        category: 'custom-mcp-category',
        workflows: ['code-refactor'],
        audience: ['engineer'],
        riskLevel: 'medium' as const,
        fallback: { mode: 'manual-mcp', qualityImpact: 'lower' },
        presentation: { displayName: { en: 'Missing MCP Availability' }, description: { en: 'Missing MCP availability.' } }
      }
    ];
    vi.doMock('../../src/services/recommendations/capability-map-service.js', () => ({
      createCapabilityMapPlan: () => ({
        dryRunOnly: true,
        executionPolicy: { allowInstall: false, allowClone: false, allowConfigWrite: false, allowSecretExfiltration: false },
        sources: [],
        items,
        mappings: [],
        availability: [
          { capabilityId: 'local-template.installable', type: 'skill', status: 'installable', requiredFor: [], fallback: items[0]?.fallback, risk: 'low' },
          { capabilityId: 'external-mcp.installable', type: 'mcp', status: 'installable', requiredFor: [], fallback: items[1]?.fallback, risk: 'medium' },
          { capabilityId: 'disabled-agent.capability', type: 'agent', status: 'disabled', requiredFor: [], fallback: items[2]?.fallback, risk: 'low' }
        ],
        constraints: [],
        warnings: []
      })
    }));

    try {
      const mockedWorkflow = await import('../../src/services/workflow/workflow-autonomous-service.js');
      const plan = mockedWorkflow.createAutonomousWorkflowPlan({
        mode: 'solo',
        changeId: 'catalog-activation-states',
        goal: 'Plan with mocked catalog activation states',
        dryRun: true,
        config: { ...DEFAULT_CONFIG, swarmMode: false }
      });

      expect(plan.capabilityPlan.candidates.find((candidate) => candidate.id === 'local-template.installable')).toMatchObject({
        purpose: 'workflow-guidance',
        trustLevel: 'local',
        activation: 'needs-install'
      });
      expect(plan.capabilityPlan.candidates.find((candidate) => candidate.id === 'external-mcp.installable')?.activation).toBe('needs-credentials');
      expect(plan.capabilityPlan.candidates.find((candidate) => candidate.id === 'disabled-agent.capability')?.activation).toBe('not-active');
      expect(plan.capabilityPlan.candidates.find((candidate) => candidate.id === 'missing-mcp-availability.capability')).toMatchObject({
        purpose: 'docs-lookup',
        activation: 'needs-credentials'
      });
      expect(plan.rdPlan.swarmMode).toBe(false);
    } finally {
      vi.doUnmock('../../src/services/recommendations/capability-map-service.js');
      vi.resetModules();
    }
  });

  test('returns preview-safe next actions when artifact workspace is unavailable', () => {
    const plan = createAutonomousWorkflowPlan({
      mode: 'team',
      changeId: 'resume-preview',
      goal: 'Resume autonomous RD planning after compact',
      dryRun: true
    });

    expect(plan.available).toBe(false);
    expect(plan.behavior).toBe('preview');
    expect(plan.blockedReasons).toContain('artifact-workspace-unavailable');
    expect(plan.nextActions.length).toBeGreaterThan(0);
    expect(plan.resumePlan.status).toBe('preview');
  });

  test('defaults artifact workspace and memory backup paths to the local user workspace path', () => {
    const workspace = createWorkspace();
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'local-artifact-default',
      goal: 'Resume autonomous RD planning from artifacts',
      dryRun: true,
      workspace
    });

    expect(plan.available).toBe(false);
    expect(plan.blockedReasons).toContain('artifact-workspace-unavailable');
    expect(getLocalArtifactPath(workspace)).toBe(resolve(workspace.rootPath, '.peaks', 'artifacts'));
    expect(plan.storagePlan.scope).toBe('user-local');
    expect(plan.storagePlan.artifactWorkspacePath).toBe(getLocalArtifactPath(workspace));
    expect(plan.storagePlan.memoryBackupPath).toBe(join(getLocalArtifactPath(workspace), '.peaks', 'memory-backups', 'project-memory-primary'));
  });

  test('does not inspect resume artifacts when artifact workspace is invalid', () => {
    const workspace = createWorkspace();
    const invalidArtifactWorkspace = join(process.env.HOME ?? '', '.peaks', 'workspaces', 'invalid-artifact');
    writeResumeArtifacts(invalidArtifactWorkspace, 'resume-untrusted-workspace');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-untrusted-workspace',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: invalidArtifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('artifact-workspace-unavailable');
    expect(plan.blockedReasons).toContain('resume-artifacts-missing');
    expect(plan.blockedReasons).not.toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when artifact workspace exists but tech approval blocks planning', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-blocked',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('tech-approval-required');
  });

  test('marks resume ready when artifact workspace, tech gate, and resume artifacts are available', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-ready');
    writeResumeArtifacts(artifactWorkspace, 'resume-ready', 'Resume autonomous RD planning from artifacts');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-ready',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(true);
    expect(plan.resumePlan.status).toBe('ready');
    expect(plan.resumePlan.requiredArtifacts).toContain('.peaks/resume-ready/rd/swarm/resume-instructions.md');
    expect(plan.rdPlan.workerTarget).toBe(40);
  });

  test('marks resume ready when evidence refs end the validation report body', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-terminal-evidence-refs');
    writeResumeArtifacts(artifactWorkspace, 'resume-terminal-evidence-refs', 'Resume autonomous RD planning from artifacts');
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-terminal-evidence-refs', 'rd', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '---\nchangeId: resume-terminal-evidence-refs\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- validation-details.md', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-terminal-evidence-refs',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(true);
    expect(plan.resumePlan.status).toBe('ready');
  });

  test('rejects invalid change id and empty goal', () => {
    expect(() => createAutonomousWorkflowPlan({ mode: 'solo', changeId: '../escape', goal: 'x', dryRun: true })).toThrow('Invalid change-id');
    expect(() => createAutonomousWorkflowPlan({ mode: 'solo', changeId: 'empty-goal', goal: '   ', dryRun: true })).toThrow('Goal must be non-empty');
  });

  test('rejects empty solo mode values at the autonomous boundary', () => {
    expect(() => createAutonomousWorkflowPlan({ mode: 'solo', changeId: 'empty-solo-mode', goal: 'Resume autonomous RD planning from artifacts', soloMode: '' as 'guided', dryRun: true })).toThrow('Unsupported solo mode');
  });
});
