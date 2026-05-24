import * as nodeFs from 'node:fs';
import type { Stats } from 'node:fs';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { createAutonomousWorkflowPlan } from '../../src/services/workflow/workflow-autonomous-service.js';
import { createWorkspace, createWorkspaceWithArtifactWorkspace, writeApprovedTechArtifacts, writeResumeArtifacts } from './helpers/workflow-autonomous-test-helpers.js';

describe('createAutonomousWorkflowPlan resume artifact validation', () => {
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

  test('keeps resume preview when swarm root is a symbolic link', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-swarm-root-link';
    const swarmRoot = join(artifactWorkspace, '.peaks', changeId, 'rd', 'swarm');
    const outsideRoot = join(tmpdir(), `peaks-autonomous-swarm-link-${Date.now()}-${Math.random()}`);
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(outsideRoot, changeId);
    mkdirSync(join(artifactWorkspace, '.peaks', changeId, 'rd'), { recursive: true });
    rmSync(swarmRoot, { recursive: true, force: true });
    symlinkSync(join(outsideRoot, '.peaks', changeId, 'rd', 'swarm'), swarmRoot, 'junction');

    const plan = createAutonomousWorkflowPlan({
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-directory-artifact', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
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

  test('keeps resume preview when a resume artifact is oversized', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-oversized-artifact';
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(artifactWorkspace, changeId);
    const checkpointPath = join(artifactWorkspace, '.peaks', changeId, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
    writeFileSync(checkpointPath, 'x'.repeat(256_001), 'utf8');

    const plan = createAutonomousWorkflowPlan({
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
  });

  test('keeps resume preview when RD resume artifacts are outside the swarm subtree', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-rd-outside-swarm';
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(artifactWorkspace, changeId);
    const checkpointPath = join(artifactWorkspace, '.peaks', changeId, 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
    rmSync(checkpointPath);
    mkdirSync(join(artifactWorkspace, '.peaks', changeId, 'rd', 'checkpoints'), { recursive: true });
    writeFileSync(join(artifactWorkspace, '.peaks', changeId, 'rd', 'checkpoints', 'checkpoint-1.json'), '{}', 'utf8');

    const plan = createAutonomousWorkflowPlan({
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
  });

  test('keeps resume preview when the RD swarm root is a directory link', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-swarm-link';
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(artifactWorkspace, changeId);
    const swarmPath = join(artifactWorkspace, '.peaks', changeId, 'rd', 'swarm');
    const linkedSwarmPath = join(tmpdir(), `peaks-autonomous-linked-swarm-${Date.now()}-${Math.random()}`);
    rmSync(swarmPath, { recursive: true, force: true });
    mkdirSync(linkedSwarmPath, { recursive: true });
    symlinkSync(linkedSwarmPath, swarmPath, 'junction');

    const plan = createAutonomousWorkflowPlan({
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
  });

  test('keeps resume preview when swarm root is detected as a symbolic link', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-swarm-lstat-link';
    writeApprovedTechArtifacts(artifactWorkspace, changeId);
    writeResumeArtifacts(artifactWorkspace, changeId);

    vi.resetModules();
    vi.doMock('node:fs', () => ({
      ...nodeFs,
      lstatSync: (path: Parameters<typeof nodeFs.lstatSync>[0], options?: Parameters<typeof nodeFs.lstatSync>[1]) => {
        const stat = nodeFs.lstatSync(path, options) as Stats;
        if (String(path).includes(join('.peaks', changeId, 'rd', 'swarm')) && !String(path).includes(join('swarm', 'checkpoints')) && !String(path).includes(join('swarm', 'evidence')) && !String(path).endsWith('swarm')) {
          return stat;
        }
        if (String(path).endsWith(join('.peaks', changeId, 'rd', 'swarm'))) {
          return { ...stat, isSymbolicLink: () => true } as Stats;
        }
        return stat;
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-empty-evidence', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-frontmatter-only', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-malformed-frontmatter', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-unterminated-frontmatter', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-placeholder-evidence', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-body-markers', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-change-only-evidence', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-blank-evidence', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-large-artifact', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-ref-mismatch', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-unsafe-ref', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-unsafe-ref', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-self-ref', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
    const evidencePath = join(artifactWorkspace, '.peaks', 'resume-self-ref', 'rd', 'swarm', 'evidence', 'validation-report.md');
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-json-placeholder', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-json-array', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-malformed-json', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
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
    const checkpointPath = join(artifactWorkspace, '.peaks', 'resume-change-mismatch', 'rd', 'swarm', 'checkpoints', 'checkpoint-1.json');
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

  test('keeps resume preview when session root is a directory link', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-session-link';
    const sessionRoot = join(artifactWorkspace, '.peaks', changeId);
    const outsideRoot = join(tmpdir(), `peaks-autonomous-session-link-${Date.now()}-${Math.random()}`);
    writeResumeArtifacts(outsideRoot, changeId);
    mkdirSync(dirname(sessionRoot), { recursive: true });
    symlinkSync(join(outsideRoot, '.peaks', changeId), sessionRoot, 'junction');
    writeApprovedTechArtifacts(artifactWorkspace, changeId);

    const plan = createAutonomousWorkflowPlan({
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
  });

  test('keeps resume preview when role root is a directory link', () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const changeId = 'resume-role-link';
    const roleRoot = join(artifactWorkspace, '.peaks', changeId, 'rd');
    const outsideRoot = join(tmpdir(), `peaks-autonomous-role-link-${Date.now()}-${Math.random()}`);
    writeResumeArtifacts(outsideRoot, changeId);
    mkdirSync(dirname(roleRoot), { recursive: true });
    symlinkSync(join(outsideRoot, '.peaks', changeId, 'rd'), roleRoot, 'junction');
    writeApprovedTechArtifacts(artifactWorkspace, changeId);

    const plan = createAutonomousWorkflowPlan({
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
  });
});
