import * as nodeFs from 'node:fs';
import type { Stats } from 'node:fs';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_CONFIG, type WorkspaceConfig } from '../../src/services/config/config-types.js';
import { TECH_REQUIRED_ARTIFACTS } from '../../src/services/tech/tech-service.js';
import { getLocalArtifactPath } from '../../src/services/artifacts/workspace-service.js';
import { createAutonomousWorkflowPlan } from '../../src/services/workflow/workflow-autonomous-service.js';

function createWorkspace(rootPath = join(tmpdir(), `peaks-autonomous-root-${Date.now()}-${Math.random()}`), artifactWorkspace?: string): WorkspaceConfig {
  return {
    workspaceId: 'ws-autonomous',
    name: 'Autonomous Workspace',
    rootPath,
    installedCapabilityIds: [],
    ...(artifactWorkspace ? { artifactStorage: { mode: 'local' as const, localPath: artifactWorkspace } } : {})
  };
}

function createWorkspaceWithArtifactWorkspace(): { workspace: WorkspaceConfig; artifactWorkspace: string } {
  const artifactWorkspace = join(tmpdir(), `peaks-autonomous-artifacts-${Date.now()}-${Math.random()}`);
  const workspace = createWorkspace(undefined, artifactWorkspace);
  const workspaceArtifactPath = getLocalArtifactPath(workspace);
  mkdirSync(join(workspaceArtifactPath, '.peaks'), { recursive: true });
  writeFileSync(join(workspaceArtifactPath, '.peaks', 'config.json'), '{}', 'utf8');
  return { workspace, artifactWorkspace: workspaceArtifactPath };
}

function writeApprovedTechArtifacts(artifactWorkspace: string, changeId: string): void {
  const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', changeId, 'architecture');
  mkdirSync(architectureRoot, { recursive: true });
  for (const artifact of TECH_REQUIRED_ARTIFACTS) {
    writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
  }
}

function writeResumeArtifacts(artifactWorkspace: string, changeId: string, goal = 'Resume autonomous RD planning from artifacts'): void {
  const changeRoot = join(artifactWorkspace, '.peaks', 'changes', changeId);
  const artifacts = new Map([
    [join(changeRoot, 'prd', 'autonomous-goal-package.json'), JSON.stringify({ changeId, artifactType: 'goal-package', status: 'ready', goal, doneCondition: 'all acceptance criteria pass', resumeCondition: 'checkpoint verified', acceptanceCriteria: ['validation evidence exists'] })],
    [join(changeRoot, 'swarm', 'autonomous-rd-plan.json'), JSON.stringify({ changeId, artifactType: 'rd-plan', status: 'ready', workerQueueStatus: 'ready', taskCount: 3, reducerRequired: true })],
    [join(changeRoot, 'swarm', 'checkpoints', 'checkpoint-1.json'), JSON.stringify({ changeId, artifactType: 'checkpoint', status: 'ready', checkpointId: 'checkpoint-1', createdAt: '2026-05-17T00:00:00.000Z', workerQueueState: { pending: 0, completed: 3 }, validationRefs: ['validation-details.md'] })],
    [join(changeRoot, 'swarm', 'evidence', 'validation-report.md'), `---\nchangeId: ${changeId}\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- validation-details.md`],
    [join(changeRoot, 'swarm', 'evidence', 'validation-details.md'), 'Focused tests and review evidence passed'],
    [join(changeRoot, 'swarm', 'resume-instructions.md'), `---\nchangeId: ${changeId}\nartifactType: resume-instructions\nstatus: passed\n---\nResume steps:\nPreconditions:\nBlocked actions:\nNext actions:`]
  ]);

  for (const [artifact, content] of artifacts) {
    mkdirSync(dirname(artifact), { recursive: true });
    writeFileSync(artifact, content, 'utf8');
  }
}

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
    expect(getLocalArtifactPath(workspace)).toBe(join(process.env.HOME ?? '', '.peaks', 'workspaces', 'ws-autonomous', 'artifacts'));
    expect(plan.storagePlan.scope).toBe('user-local');
    expect(plan.storagePlan.artifactWorkspacePath).toBe(getLocalArtifactPath(workspace));
    expect(plan.storagePlan.memoryBackupPath).toBe(join(getLocalArtifactPath(workspace), '.peaks', 'memory-backups', 'project-memory-primary'));
  });

  test('does not inspect resume artifacts when artifact workspace is invalid', () => {
    const workspace = createWorkspace();
    const invalidArtifactWorkspace = join(tmpdir(), `peaks-invalid-artifacts-${Date.now()}-${Math.random()}`);
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

  test('keeps resume preview when opened resume artifact identity does not match path identity', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-opened-identity-mismatch');
    writeResumeArtifacts(artifactWorkspace, 'resume-opened-identity-mismatch');

    vi.resetModules();
    let checkpointPath = '';
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      openSync: (path: Parameters<typeof nodeFs.openSync>[0], flags: Parameters<typeof nodeFs.openSync>[1], mode?: Parameters<typeof nodeFs.openSync>[2]) => {
        if (String(path).endsWith('checkpoint-1.json')) {
          checkpointPath = String(path);
        }
        return nodeFs.openSync(path, flags, mode);
      },
      statSync: (path: Parameters<typeof nodeFs.statSync>[0], options?: Parameters<typeof nodeFs.statSync>[1]) => {
        const actualStat = nodeFs.statSync(path, options) as Stats;
        return String(path) === checkpointPath ? { ...actualStat, ino: actualStat.ino + 1 } as Stats : actualStat;
      }
    }));
    try {
      const mockedWorkflow = await import('../../src/services/workflow/workflow-autonomous-service.js');
      const plan = mockedWorkflow.createAutonomousWorkflowPlan({
        mode: 'solo',
        changeId: 'resume-opened-identity-mismatch',
        goal: 'Resume autonomous RD planning from artifacts',
        maxWorkers: 40,
        dryRun: true,
        workspace,
        artifactWorkspacePath: artifactWorkspace
      });

      expect(plan.available).toBe(false);
      expect(plan.resumePlan.status).toBe('preview');
      expect(plan.blockedReasons).toContain('resume-artifacts-missing');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('keeps resume preview when resume artifacts are missing', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-artifacts-missing');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-artifacts-missing',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-missing');
    expect(plan.nextActions.join('\n')).toContain('Persist autonomous goal package');
  });

  test('keeps resume preview when a resume artifact is not a file', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-directory-artifact');
    writeResumeArtifacts(artifactWorkspace, 'resume-directory-artifact');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-directory-artifact', 'swarm', 'checkpoints', 'checkpoint-1.json');
    rmSync(checkpointPath);
    mkdirSync(checkpointPath, { recursive: true });
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-directory-artifact',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-missing');
  });

  test('keeps resume preview when artifact realpath escapes the artifact workspace', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-realpath-escape';
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(artifactWorkspace, changeId);

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      realpathSync: (path: Parameters<typeof nodeFs.realpathSync>[0], options?: Parameters<typeof nodeFs.realpathSync>[1]) => {
        const pathText = String(path);
        if (pathText.endsWith('checkpoint-1.json')) {
          return join(tmpdir(), 'outside-peaks-artifacts', 'checkpoint-1.json');
        }
        return nodeFs.realpathSync(path, options);
      }
    }));
    try {
      const mockedWorkflow = await import('../../src/services/workflow/workflow-autonomous-service.js');
      const plan = mockedWorkflow.createAutonomousWorkflowPlan({
        mode: 'solo',
        changeId,
        goal: 'Resume autonomous RD planning from artifacts',
        maxWorkers: 40,
        dryRun: true,
        workspace,
        artifactWorkspacePath: artifactWorkspace
      });

      expect(plan.available).toBe(false);
      expect(plan.resumePlan.status).toBe('preview');
      expect(plan.blockedReasons).toContain('resume-artifacts-missing');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('keeps resume preview when a resume artifact read ends before the expected size', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-short-read';
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(artifactWorkspace, changeId);

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      readSync: (fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => {
        if (position !== null && position > 0) {
          return 0;
        }
        return nodeFs.readSync(fd, buffer, offset, Math.min(1, length), position);
      }
    }));
    try {
      const mockedWorkflow = await import('../../src/services/workflow/workflow-autonomous-service.js');
      const plan = mockedWorkflow.createAutonomousWorkflowPlan({
        mode: 'solo',
        changeId,
        goal: 'Resume autonomous RD planning from artifacts',
        maxWorkers: 40,
        dryRun: true,
        workspace,
        artifactWorkspacePath: artifactWorkspace
      });

      expect(plan.available).toBe(false);
      expect(plan.resumePlan.status).toBe('preview');
      expect(plan.blockedReasons).toContain('resume-artifacts-missing');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('keeps resume preview when validation evidence is empty', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-empty-evidence');
    writeResumeArtifacts(artifactWorkspace, 'resume-empty-evidence');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-empty-evidence', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-empty-evidence',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation evidence has only frontmatter', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-frontmatter-only');
    writeResumeArtifacts(artifactWorkspace, 'resume-frontmatter-only');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-frontmatter-only', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '---\nchangeId: resume-frontmatter-only\nartifactType: validation-report\nstatus: passed\n---', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-frontmatter-only',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when markdown frontmatter is malformed', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-malformed-frontmatter');
    writeResumeArtifacts(artifactWorkspace, 'resume-malformed-frontmatter');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-malformed-frontmatter', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '---\nchangeId resume-malformed-frontmatter\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- validation-details.md', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-malformed-frontmatter',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when markdown frontmatter is unterminated', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-unterminated-frontmatter');
    writeResumeArtifacts(artifactWorkspace, 'resume-unterminated-frontmatter');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-unterminated-frontmatter', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '---\nchangeId: resume-unterminated-frontmatter\nartifactType: validation-report\nstatus: passed', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-unterminated-frontmatter',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation evidence lacks passed status', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-placeholder-evidence');
    writeResumeArtifacts(artifactWorkspace, 'resume-placeholder-evidence');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-placeholder-evidence', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, 'validation evidence recorded', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-placeholder-evidence',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation evidence markers only appear in the body', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-body-markers');
    writeResumeArtifacts(artifactWorkspace, 'resume-body-markers');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-body-markers', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '```yaml\nchangeId: resume-body-markers\nstatus: passed\n```', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-body-markers',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation evidence lacks passed status but has change id', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-change-only-evidence');
    writeResumeArtifacts(artifactWorkspace, 'resume-change-only-evidence');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-change-only-evidence', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, 'changeId: resume-change-only-evidence', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-change-only-evidence',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation evidence is blank', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-blank-evidence');
    writeResumeArtifacts(artifactWorkspace, 'resume-blank-evidence');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-blank-evidence', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '   ', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-blank-evidence',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when a resume artifact exceeds the size limit', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-large-artifact');
    writeResumeArtifacts(artifactWorkspace, 'resume-large-artifact');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-large-artifact', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, 'x'.repeat(256_001), 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-large-artifact',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-missing');
  });

  test('keeps resume preview when validation refs do not match checkpoint refs', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-ref-mismatch');
    writeResumeArtifacts(artifactWorkspace, 'resume-ref-mismatch');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-ref-mismatch', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(evidencePath, '---\nchangeId: resume-ref-mismatch\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- different-report.md', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-ref-mismatch',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation refs are unsafe paths', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-unsafe-ref');
    writeResumeArtifacts(artifactWorkspace, 'resume-unsafe-ref');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-unsafe-ref', 'swarm', 'checkpoints', 'checkpoint-1.json');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-unsafe-ref', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(checkpointPath, JSON.stringify({ changeId: 'resume-unsafe-ref', artifactType: 'checkpoint', status: 'ready', checkpointId: 'checkpoint-1', createdAt: '2026-05-17T00:00:00.000Z', workerQueueState: { pending: 0, completed: 3 }, validationRefs: ['../../outside.md'] }), 'utf8');
    writeFileSync(evidencePath, '---\nchangeId: resume-unsafe-ref\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- ../../outside.md', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-unsafe-ref',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when validation report references itself as evidence', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-self-ref');
    writeResumeArtifacts(artifactWorkspace, 'resume-self-ref');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-self-ref', 'swarm', 'checkpoints', 'checkpoint-1.json');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-self-ref', 'swarm', 'evidence', 'validation-report.md');
    writeFileSync(checkpointPath, JSON.stringify({ changeId: 'resume-self-ref', artifactType: 'checkpoint', status: 'ready', checkpointId: 'checkpoint-1', createdAt: '2026-05-17T00:00:00.000Z', workerQueueState: { pending: 0, completed: 3 }, validationRefs: ['Validation-Report.md'] }), 'utf8');
    writeFileSync(evidencePath, '---\nchangeId: resume-self-ref\nartifactType: validation-report\nstatus: passed\n---\nValidation summary:\nChecks:\nResult: passed\nEvidence refs:\n- Validation-Report.md', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-self-ref',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when goal package goal does not match', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-goal-mismatch');
    writeResumeArtifacts(artifactWorkspace, 'resume-goal-mismatch', 'Different goal');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-goal-mismatch',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when resume JSON lacks ready status', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-json-placeholder');
    writeResumeArtifacts(artifactWorkspace, 'resume-json-placeholder');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-json-placeholder', 'swarm', 'checkpoints', 'checkpoint-1.json');
    writeFileSync(checkpointPath, JSON.stringify({ changeId: 'resume-json-placeholder', artifactType: 'checkpoint' }), 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-json-placeholder',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when resume JSON is not an object', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-json-array');
    writeResumeArtifacts(artifactWorkspace, 'resume-json-array');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-json-array', 'swarm', 'checkpoints', 'checkpoint-1.json');
    writeFileSync(checkpointPath, JSON.stringify(['resume-json-array']), 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-json-array',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when resume JSON is malformed', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-malformed-json');
    writeResumeArtifacts(artifactWorkspace, 'resume-malformed-json');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-malformed-json', 'swarm', 'checkpoints', 'checkpoint-1.json');
    writeFileSync(checkpointPath, '{', 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-malformed-json',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
  });

  test('keeps resume preview when resume JSON change id does not match', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-change-mismatch');
    writeResumeArtifacts(artifactWorkspace, 'resume-change-mismatch');
    const checkpointPath = join(artifactWorkspace, '.peaks', 'changes', 'resume-change-mismatch', 'swarm', 'checkpoints', 'checkpoint-1.json');
    writeFileSync(checkpointPath, JSON.stringify({ changeId: 'different-change' }), 'utf8');
    const plan = createAutonomousWorkflowPlan({
      mode: 'solo',
      changeId: 'resume-change-mismatch',
      goal: 'Resume autonomous RD planning from artifacts',
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.available).toBe(false);
    expect(plan.resumePlan.status).toBe('preview');
    expect(plan.blockedReasons).toContain('resume-artifacts-invalid');
    expect(plan.nextActions.join('\n')).toContain('Refresh autonomous resume artifacts');
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
    expect(plan.resumePlan.requiredArtifacts).toContain('.peaks/changes/resume-ready/swarm/resume-instructions.md');
    expect(plan.rdPlan.workerTarget).toBe(40);
  });

  test('marks resume ready when evidence refs end the validation report body', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    writeApprovedTechArtifacts(artifactWorkspace, 'resume-terminal-evidence-refs');
    writeResumeArtifacts(artifactWorkspace, 'resume-terminal-evidence-refs', 'Resume autonomous RD planning from artifacts');
    const evidencePath = join(artifactWorkspace, '.peaks', 'changes', 'resume-terminal-evidence-refs', 'swarm', 'evidence', 'validation-report.md');
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
