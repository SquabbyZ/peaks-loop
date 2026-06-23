import * as nodeFs from 'node:fs';
import type { Stats } from 'node:fs';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import type { WorkspaceConfig } from '../../src/services/config/config-types.js';
import { getLocalArtifactPath } from '../../src/services/artifacts/workspace-service.js';
import { createRdSwarmPlan } from '../../src/services/rd/rd-service.js';
import { getChangeScopeDirAbs } from '../../src/services/artifacts/change-scope-service.js';
import { TECH_REQUIRED_ARTIFACTS } from '../../src/services/tech/tech-service.js';

function createArtifactWorkspace(): string {
  const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-rd-artifacts-'));
  mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
  writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
  return artifactWorkspace;
}

function createWorkspaceWithArtifactWorkspace(): { workspace: WorkspaceConfig; artifactWorkspace: string } {
  const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-rd-default-artifacts-'));
  const workspace = createWorkspace(undefined, artifactWorkspace);
  mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
  writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
  return { workspace, artifactWorkspace: getLocalArtifactPath(workspace) };
}

function createWorkspace(rootPath = mkdtempSync(join(tmpdir(), 'peaks-rd-root-')), artifactWorkspace?: string): WorkspaceConfig {
  return {
    workspaceId: 'ws-rd-target-security',
    name: 'RD Target Security Workspace',
    rootPath,
    installedCapabilityIds: [],
    ...(artifactWorkspace ? { artifactStorage: { mode: 'local' as const, localPath: artifactWorkspace } } : {})
  };
}

describe('createRdSwarmPlan artifact target area security', () => {
  test('ignores artifact target areas when architecture root escapes after tech approval check', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const rdRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-rd-approved-outside-artifact-'));
    mkdirSync(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), { recursive: true });
    mkdirSync(join(outsideRoot, 'architecture'), { recursive: true });
    symlinkSync(outsideRoot, rdRoot, 'junction');
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'frontend-tech-doc.md'
        ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
        : 'ready';
      writeFileSync(join(outsideRoot, 'architecture', artifact), content, 'utf8');
    }

    vi.resetModules();
    vi.doMock('../../src/services/tech/tech-service.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/tech/tech-service.js')>('../../src/services/tech/tech-service.js');
      return {
        ...actual,
        getTechStatus: () => ({
          changeId: 'checkout-refactor',
          status: 'approved',
          artifactRoot: '.peaks/checkout-refactor/rd/architecture',
          requiredArtifacts: [...actual.TECH_REQUIRED_ARTIFACTS],
          missingArtifacts: [],
          approvalRecord: '.peaks/checkout-refactor/rd/architecture/tech-approval-record.md',
          blockedReasons: [],
          nextActions: []
        })
      };
    });
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
      expect(targetAreas.every((targetArea) => targetArea === 'area-implementation candidates')).toBe(true);
    } finally {
      vi.doUnmock('../../src/services/tech/tech-service.js');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when rd root is a symbolic link after tech approval check', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const rdRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-rd-root-link-'));
    mkdirSync(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), { recursive: true });
    mkdirSync(join(outsideRoot, 'architecture'), { recursive: true });
    symlinkSync(outsideRoot, rdRoot, 'junction');
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'frontend-tech-doc.md'
        ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
        : 'ready';
      writeFileSync(join(outsideRoot, 'architecture', artifact), content, 'utf8');
    }

    vi.resetModules();
    vi.doMock('../../src/services/tech/tech-service.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/tech/tech-service.js')>('../../src/services/tech/tech-service.js');
      return {
        ...actual,
        getTechStatus: () => ({
          changeId: 'checkout-refactor',
          status: 'approved',
          artifactRoot: '.peaks/checkout-refactor/rd/architecture',
          requiredArtifacts: [...actual.TECH_REQUIRED_ARTIFACTS],
          missingArtifacts: [],
          approvalRecord: '.peaks/checkout-refactor/rd/architecture/tech-approval-record.md',
          blockedReasons: [],
          nextActions: []
        })
      };
    });
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
      expect(targetAreas.every((targetArea) => targetArea === 'area-implementation candidates')).toBe(true);
    } finally {
      vi.doUnmock('../../src/services/tech/tech-service.js');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when artifact file is reported as a symbolic link after tech approval check', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
          : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    vi.resetModules();
    let frontendLstatCalls = 0;
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      lstatSync: (path: Parameters<typeof nodeFs.lstatSync>[0], options?: Parameters<typeof nodeFs.lstatSync>[1]) => {
        const actualStat = nodeFs.lstatSync(path, options);
        if (String(path).endsWith('frontend-tech-doc.md')) {
          frontendLstatCalls += 1;
          if (frontendLstatCalls > 1) {
            return { ...actualStat, isSymbolicLink: () => true } as ReturnType<typeof nodeFs.lstatSync>;
          }
        }
        return actualStat;
      }
    }));
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
      expect(targetAreas.every((targetArea) => targetArea === 'area-implementation candidates')).toBe(true);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when artifact file is not a readable file after tech approval check', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      if (artifact === 'frontend-tech-doc.md') {
        mkdirSync(join(architectureRoot, artifact));
      } else {
        writeFileSync(join(architectureRoot, artifact), 'ready', 'utf8');
      }
    }

    vi.resetModules();
    vi.doMock('../../src/services/tech/tech-service.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/services/tech/tech-service.js')>('../../src/services/tech/tech-service.js');
      return {
        ...actual,
        getTechStatus: () => ({
          changeId: 'checkout-refactor',
          status: 'approved',
          artifactRoot: '.peaks/checkout-refactor/rd/architecture',
          requiredArtifacts: [...actual.TECH_REQUIRED_ARTIFACTS],
          missingArtifacts: [],
          approvalRecord: '.peaks/checkout-refactor/rd/architecture/tech-approval-record.md',
          blockedReasons: [],
          nextActions: []
        })
      };
    });
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas.every((targetArea) => targetArea === 'area-implementation candidates')).toBe(true);
    } finally {
      vi.doUnmock('../../src/services/tech/tech-service.js');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when artifact realpath escapes the architecture root', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
          : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    vi.resetModules();
    let frontendRealpathCalls = 0;
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      realpathSync: (path: Parameters<typeof nodeFs.realpathSync>[0], options?: Parameters<typeof nodeFs.realpathSync>[1]) => {
        if (String(path).endsWith('frontend-tech-doc.md')) {
          frontendRealpathCalls += 1;
          if (frontendRealpathCalls > 1) {
            return join(tmpdir(), 'peaks-rd-escaped-artifact', 'frontend-tech-doc.md');
          }
        }
        return nodeFs.realpathSync(path, options);
      }
    }));
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when opened artifact identity does not match path identity', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
          : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    vi.resetModules();
    let frontendPath = '';
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      openSync: (path: Parameters<typeof nodeFs.openSync>[0], flags: Parameters<typeof nodeFs.openSync>[1], mode?: Parameters<typeof nodeFs.openSync>[2]) => {
        if (String(path).endsWith('frontend-tech-doc.md')) {
          frontendPath = String(path);
        }
        return nodeFs.openSync(path, flags, mode);
      },
      statSync: (path: Parameters<typeof nodeFs.statSync>[0], options?: Parameters<typeof nodeFs.statSync>[1]) => {
        const actualStat = nodeFs.statSync(path, options) as Stats;
        if (String(path) === frontendPath) {
          const changedIno = actualStat.ino + 1;
          return { ...actualStat, ino: changedIno } as Stats;
        }
        return actualStat;
      }
    }));
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when bounded artifact read exceeds the byte limit', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
          : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    vi.resetModules();
    let frontendFd: number | null = null;
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      openSync: (path: Parameters<typeof nodeFs.openSync>[0], flags: Parameters<typeof nodeFs.openSync>[1], mode?: Parameters<typeof nodeFs.openSync>[2]) => {
        const fd = nodeFs.openSync(path, flags, mode);
        if (String(path).endsWith('frontend-tech-doc.md')) {
          frontendFd = fd;
        }
        return fd;
      },
      readSync: (fd: number, buffer: NodeJS.ArrayBufferView, offset: number, length: number, position: number | null) => fd === frontendFd ? length : nodeFs.readSync(fd, buffer, offset, length, position)
    }));
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when opened artifact identity changes after read', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
          : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    vi.resetModules();
    let frontendFd: number | null = null;
    let frontendFstatCalls = 0;
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      openSync: (path: Parameters<typeof nodeFs.openSync>[0], flags: Parameters<typeof nodeFs.openSync>[1], mode?: Parameters<typeof nodeFs.openSync>[2]) => {
        const fd = nodeFs.openSync(path, flags, mode);
        if (String(path).endsWith('frontend-tech-doc.md')) {
          frontendFd = fd;
        }
        return fd;
      },
      fstatSync: (fd: number, options?: Parameters<typeof nodeFs.fstatSync>[1]) => {
        const actualStat = nodeFs.fstatSync(fd, options) as Stats;
        if (fd === frontendFd) {
          frontendFstatCalls += 1;
          if (frontendFstatCalls > 1) {
            const changedIno = actualStat.ino + 1;
            return { ...actualStat, ino: changedIno } as Stats;
          }
        }
        return actualStat;
      }
    }));
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('ignores artifact target areas when artifact validation throws', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const architectureRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd', 'architecture');
    mkdirSync(architectureRoot, { recursive: true });
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : artifact === 'frontend-tech-doc.md'
          ? 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`'
          : 'ready';
      writeFileSync(join(architectureRoot, artifact), content, 'utf8');
    }

    vi.resetModules();
    let frontendLstatCalls = 0;
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      lstatSync: (path: Parameters<typeof nodeFs.lstatSync>[0], options?: Parameters<typeof nodeFs.lstatSync>[1]) => {
        if (String(path).endsWith('frontend-tech-doc.md')) {
          frontendLstatCalls += 1;
          if (frontendLstatCalls > 1) {
            throw new Error('artifact validation failed');
          }
        }
        return nodeFs.lstatSync(path, options);
      }
    }));
    try {
      const mockedRdService = await import('../../src/services/rd/rd-service.js');
      const plan = mockedRdService.createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

      expect(plan.available).toBe(true);
      if (!plan.available) return;
      const targetAreas = plan.tasks.filter((task) => task.wave === 'implementation candidates').map((task) => task.targetArea);
      expect(targetAreas).not.toContain('packages/client/src/stores/authStore.ts');
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('blocks when architecture root escapes the artifact workspace', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const rdRoot = join(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), 'rd');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-rd-outside-artifact-'));
    mkdirSync(getChangeScopeDirAbs(artifactWorkspace, 'checkout-refactor'), { recursive: true });
    mkdirSync(join(outsideRoot, 'architecture'), { recursive: true });
    symlinkSync(outsideRoot, rdRoot, 'junction');
    for (const artifact of TECH_REQUIRED_ARTIFACTS) {
      const content = artifact === 'tech-approval-record.md'
        ? 'status: approved'
        : 'Implementation target areas:\n- `packages/client/src/stores/authStore.ts`';
      writeFileSync(join(outsideRoot, 'architecture', artifact), content, 'utf8');
    }

    const plan = createRdSwarmPlan({ skill: 'rd', changeId: 'checkout-refactor', goal: 'Implement approved checkout refactor', maxWorkers: 25, dryRun: true, artifactWorkspacePath: artifactWorkspace, workspace });

    expect(plan.available).toBe(false);
    if (plan.available) return;
    expect(plan.behavior).toBe('blocked');
    expect(plan.blockedReasons).toContain('tech-approval-required');
  });
});
