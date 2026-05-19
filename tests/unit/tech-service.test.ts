import * as nodeFs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';
import { createTechPlan, getTechStatus, TECH_REQUIRED_ARTIFACTS } from '../../src/services/tech/tech-service.js';

function createArtifactWorkspace(): string {
  const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-tech-artifacts-'));
  mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
  writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
  return artifactWorkspace;
}

function createWorkspaceWithArtifactWorkspace(): { workspace: WorkspaceConfig; artifactWorkspace: string } {
  const workspace = createWorkspace();
  const artifactWorkspace = getLocalArtifactPath(workspace.rootPath);
  mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
  writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
  return { workspace, artifactWorkspace };
}

function createWorkspace(rootPath = mkdtempSync(join(tmpdir(), 'peaks-tech-root-'))): WorkspaceConfig {
  return {
    workspaceId: 'ws-tech',
    name: 'Tech Workspace',
    rootPath,
    installedCapabilityIds: []
  };
}

function getLocalArtifactPath(rootPath: string): string {
  return join(dirname(rootPath), `${basename(rootPath)}.peaks-artifacts`);
}

describe('createTechPlan', () => {
  test('generates deterministic waves, tasks, and artifact paths', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const plan = createTechPlan({ changeId: 'checkout-refactor', goal: 'Refactor checkout API', swarm: true, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(true);
    if (!plan.available) return;
    expect(plan.artifactRoot).toBe('.peaks/changes/checkout-refactor/architecture');
    expect(plan.waves.map((wave) => wave.name)).toEqual(['scan', 'document', 'review', 'reducer']);
    expect(plan.tasks).toHaveLength(23);
    expect(plan.outputs.taskGraph).toBe('.peaks/changes/checkout-refactor/architecture/tech-task-graph.json');
    expect(plan.outputs.reviewChecklist).toBe('.peaks/changes/checkout-refactor/architecture/tech-review-checklist.md');
    expect(plan.outputs.approvalTemplate).toBe('.peaks/changes/checkout-refactor/architecture/tech-approval-record.template.md');

    for (const task of plan.tasks) {
      expect(task.taskId).toMatch(/^tech-/);
      expect(task.workerKind.length).toBeGreaterThan(0);
      expect(task.purpose).toContain('Refactor checkout API');
      expect(task.inputs.length).toBeGreaterThan(0);
      expect(task.outputs.every((output) => output.startsWith('.peaks/changes/checkout-refactor/architecture/'))).toBe(true);
      expect(task.outputs.every((output) => !output.includes('\\'))).toBe(true);
      expect(task.conflictGroup.length).toBeGreaterThan(0);
      expect(Array.isArray(task.dependsOn)).toBe(true);
      expect(task.briefPath).toBe(`.peaks/changes/checkout-refactor/architecture/workers/${task.taskId}/brief.md`);
    }
  });

  test('returns preview response when artifact workspace is unavailable', () => {
    const plan = createTechPlan({ changeId: 'checkout-refactor', goal: 'Refactor checkout API', swarm: true, dryRun: true });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.behavior).toBe('preview');
    expect(plan.reason).toContain('artifact-workspace-unavailable');
    expect(plan.preview.artifactRoot).toBe('.peaks/changes/checkout-refactor/architecture');
    expect(plan.nextActions.length).toBeGreaterThan(0);
  });

  test('returns preview response when artifact workspace marker is unavailable', () => {
    const plan = createTechPlan({ changeId: 'checkout-refactor', goal: 'Refactor checkout API', swarm: true, dryRun: true, artifactWorkspacePath: mkdtempSync(join(tmpdir(), 'peaks-tech-unmarked-plan-')) });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.reason).toContain('artifact-workspace-unavailable');
    expect(plan.preview.artifactRoot).toBe('.peaks/changes/checkout-refactor/architecture');
  });

  test('validates artifact workspace against the selected workspace root', () => {
    const workspace = createWorkspace();
    const unsafeArtifactWorkspace = join(workspace.rootPath, '.peaks-artifacts');
    mkdirSync(join(unsafeArtifactWorkspace, '.peaks'), { recursive: true });
    writeFileSync(join(unsafeArtifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');

    const unsafePlan = createTechPlan({ changeId: 'checkout-refactor', goal: 'Refactor checkout API', swarm: true, dryRun: true, artifactWorkspacePath: unsafeArtifactWorkspace, workspace });
    expect(unsafePlan.available).toBe(false);

    const safeArtifactWorkspace = getLocalArtifactPath(workspace.rootPath);
    mkdirSync(join(safeArtifactWorkspace, '.peaks'), { recursive: true });
    writeFileSync(join(safeArtifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');

    expect(createTechPlan({ changeId: 'checkout-refactor', goal: 'Refactor checkout API', swarm: true, dryRun: true, artifactWorkspacePath: safeArtifactWorkspace, workspace }).available).toBe(true);
  });

  test('rejects invalid change id and empty goal', () => {
    expect(() => createTechPlan({ changeId: '../escape', goal: 'Refactor checkout API', swarm: true, dryRun: true })).toThrow('Invalid change-id');
    expect(() => createTechPlan({ changeId: 'checkout-refactor', goal: '   ', swarm: true, dryRun: true })).toThrow('Goal must be non-empty');
  });
});

describe('getTechStatus', () => {
  test('returns unavailable when artifact workspace is missing', () => {
    const status = getTechStatus({ changeId: 'checkout-refactor' });

    expect(status.status).toBe('unavailable');
    expect(status.blockedReasons).toContain('artifact-workspace-unavailable');
    expect(status.nextActions.length).toBeGreaterThan(0);
  });

  test('reports missing artifacts before approval can be evaluated', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('missing');
    expect(status.missingArtifacts).toEqual(TECH_REQUIRED_ARTIFACTS);
    expect(status.blockedReasons).toContain('tech-artifacts-missing');
  });

  test('returns unavailable when artifact workspace marker is missing', () => {
    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: mkdtempSync(join(tmpdir(), 'peaks-tech-unmarked-')) });

    expect(status.status).toBe('unavailable');
    expect(status.blockedReasons).toContain('artifact-workspace-unavailable');
  });

  test('returns unavailable when workspace is omitted even if a marker exists', () => {
    const artifactWorkspace = createArtifactWorkspace();

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace });

    expect(status.status).toBe('unavailable');
    expect(status.blockedReasons).toContain('artifact-workspace-unavailable');
  });

  test('returns unavailable when selected workspace boundary validation fails', () => {
    const workspace = createWorkspace();
    const unsafeArtifactWorkspace = join(workspace.rootPath, '.peaks-artifacts');
    mkdirSync(join(unsafeArtifactWorkspace, '.peaks'), { recursive: true });
    writeFileSync(join(unsafeArtifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: unsafeArtifactWorkspace, workspace });

    expect(status.status).toBe('unavailable');
    expect(status.blockedReasons).toContain('artifact-workspace-unavailable');
  });

  test('blocks when approval record is missing or unapproved', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS.filter((artifact) => artifact !== 'tech-approval-record.md')) {
      writeFileSync(join(architectureRoot, artifact), 'ready', 'utf8');
    }

    const missingApproval = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });
    expect(missingApproval.status).toBe('blocked');
    expect(missingApproval.blockedReasons).toContain('tech-approval-missing');

    writeFileSync(join(architectureRoot, 'tech-approval-record.md'), 'looks good', 'utf8');
    const unapproved = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });
    expect(unapproved.status).toBe('blocked');
    expect(unapproved.blockedReasons).toContain('tech-approval-not-approved');
  });

  test('keeps explicit missing artifacts in blocked status', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    writeFileSync(join(architectureRoot, 'frontend-tech-doc.md'), 'ready', 'utf8');
    writeFileSync(join(architectureRoot, 'tech-approval-record.md'), 'looks good', 'utf8');

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('blocked');
    expect(status.missingArtifacts).toContain('backend-tech-doc.md');
    expect(status.blockedReasons).toContain('tech-artifacts-missing');
  });

  test('blocks approved records when required artifacts are still missing', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    writeFileSync(join(architectureRoot, 'tech-approval-record.md'), 'status: approved', 'utf8');

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('blocked');
    expect(status.missingArtifacts).toContain('frontend-tech-doc.md');
    expect(status.blockedReasons).toContain('tech-artifacts-missing');
  });

  test('blocks when approval record becomes unreadable after existence check', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      readFileSync: (path: Parameters<typeof nodeFs.readFileSync>[0], options?: Parameters<typeof nodeFs.readFileSync>[1]) => {
        if (String(path).endsWith('tech-approval-record.md')) {
          throw new Error('approval unreadable');
        }
        return nodeFs.readFileSync(path, options);
      }
    }));
    try {
      const mockedTechService = await import('../../src/services/tech/tech-service.js');
      const status = mockedTechService.getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

      expect(status.status).toBe('blocked');
      expect(status.blockedReasons).toContain('tech-approval-unreadable');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('blocks when architecture root validation throws', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      realpathSync: (path: Parameters<typeof nodeFs.realpathSync>[0], options?: Parameters<typeof nodeFs.realpathSync>[1]) => {
        if (String(path).endsWith('architecture')) {
          throw new Error('architecture root validation failed');
        }
        return nodeFs.realpathSync(path, options);
      }
    }));
    try {
      const mockedTechService = await import('../../src/services/tech/tech-service.js');
      const status = mockedTechService.getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

      expect(status.status).toBe('blocked');
      expect(status.missingArtifacts).toEqual(TECH_REQUIRED_ARTIFACTS);
      expect(status.blockedReasons).toContain('tech-artifacts-missing');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('blocks when architecture root resolves outside the artifact workspace', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-tech-outside-root-'));
    mkdirSync(join(artifactWorkspace, '.peaks', 'changes'), { recursive: true });
    mkdirSync(join(outsideRoot, 'architecture'), { recursive: true });
    symlinkSync(outsideRoot, changeRoot, 'junction');
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(outsideRoot, 'architecture', artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('blocked');
    expect(status.missingArtifacts).toEqual(TECH_REQUIRED_ARTIFACTS);
    expect(status.approvalRecord).toBeNull();
    expect(status.blockedReasons).toContain('tech-artifacts-missing');
  });

  test('blocks when a required artifact resolves outside the architecture root', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-tech-outside-artifact-'));
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      if (artifact === 'frontend-tech-doc.md') {
        mkdirSync(join(outsideRoot, artifact));
        symlinkSync(join(outsideRoot, artifact), join(architectureRoot, artifact), 'junction');
      } else {
        writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
      }
    }

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('blocked');
    expect(status.missingArtifacts).toContain('frontend-tech-doc.md');
    expect(status.blockedReasons).toContain('tech-artifacts-missing');
  });

  test('treats required artifact directories as missing artifacts', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      if (artifact === 'frontend-tech-doc.md') {
        mkdirSync(join(architectureRoot, artifact));
      } else {
        writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
      }
    }

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('blocked');
    expect(status.missingArtifacts).toContain('frontend-tech-doc.md');
    expect(status.blockedReasons).toContain('tech-artifacts-missing');
  });

  test('blocks when approval record resolves outside the architecture root', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-tech-outside-approval-'));
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      if (artifact === 'tech-approval-record.md') {
        mkdirSync(join(outsideRoot, artifact));
        symlinkSync(join(outsideRoot, artifact), join(architectureRoot, artifact), 'junction');
      } else {
        writeFileSync(join(architectureRoot, artifact), 'ready', 'utf8');
      }
    }

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('blocked');
    expect(status.approvalRecord).toBeNull();
    expect(status.blockedReasons).toContain('tech-approval-missing');
  });

  test('treats artifact validation errors as missing artifacts', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      realpathSync: (path: Parameters<typeof nodeFs.realpathSync>[0]) => {
        if (String(path).endsWith('frontend-tech-doc.md')) {
          throw new Error('artifact validation failed');
        }
        return nodeFs.realpathSync(path);
      }
    }));
    try {
      const mockedTechService = await import('../../src/services/tech/tech-service.js');
      const status = mockedTechService.getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

      expect(status.status).toBe('blocked');
      expect(status.missingArtifacts).toContain('frontend-tech-doc.md');
      expect(status.blockedReasons).toContain('tech-artifacts-missing');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('treats artifact realpath escape as a missing artifact', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-tech-realpath-outside-'));
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      realpathSync: (path: Parameters<typeof nodeFs.realpathSync>[0]) => {
        if (String(path).endsWith('frontend-tech-doc.md')) {
          return join(outsideRoot, 'frontend-tech-doc.md');
        }
        return nodeFs.realpathSync(path);
      }
    }));
    try {
      const mockedTechService = await import('../../src/services/tech/tech-service.js');
      const status = mockedTechService.getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

      expect(status.status).toBe('blocked');
      expect(status.missingArtifacts).toContain('frontend-tech-doc.md');
      expect(status.blockedReasons).toContain('tech-artifacts-missing');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('returns approved only with canonical approval marker', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(artifactWorkspace, '.peaks', 'changes', 'checkout-refactor', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      writeFileSync(join(architectureRoot, artifact), artifact === 'tech-approval-record.md' ? 'status: approved' : 'ready', 'utf8');
    }

    const status = getTechStatus({ changeId: 'checkout-refactor', artifactWorkspacePath: artifactWorkspace, workspace });

    expect(status.status).toBe('approved');
    expect(status.approvalRecord).toBe('.peaks/changes/checkout-refactor/architecture/tech-approval-record.md');
    expect(status.blockedReasons).toEqual([]);
  });
});
