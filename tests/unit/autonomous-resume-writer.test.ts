import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { writeAutonomousResumeArtifacts } from '../../src/services/workflow/autonomous-resume-writer.js';
import { createAutonomousWorkflowPlan } from '../../src/services/workflow/workflow-autonomous-service.js';
import { createWorkspaceWithArtifactWorkspace, writeApprovedTechArtifacts } from './helpers/workflow-autonomous-test-helpers.js';

const createdWorkspaces: string[] = [];

function newWorkspace(): string {
  const path = join(tmpdir(), `peaks-resume-writer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path, { recursive: true });
  createdWorkspaces.push(path);
  return path;
}

afterEach(() => {
  // workspaces are temp dirs; leaving them in place for failure inspection
  createdWorkspaces.length = 0;
});

describe('writeAutonomousResumeArtifacts', () => {
  test('returns preview files without writing to disk in dry-run mode', async () => {
    const workspace = newWorkspace();

    const result = await writeAutonomousResumeArtifacts({
      sessionId: 'resume-writer-preview',
      goal: 'Generate a resume scaffold for the writer',
      artifactWorkspacePath: workspace,
      clock: () => '2026-05-25T00:00:00.000Z'
    });

    expect(result.applied).toBe(false);
    expect(result.files).toHaveLength(6);
    for (const file of result.files) {
      expect(existsSync(file.path)).toBe(false);
    }
    const relativePaths = result.files.map((file) => file.path.replace(workspace, '').replace(/\\/g, '/'));
    // Slice 2026-06-29-change-id-root-removal: resume artifacts land
    // under the canonical session dir
    // `.peaks/_runtime/<sessionId>/...` (single-axis layout). The
    // legacy change-id scope dir `.peaks/_runtime/change/<id>/` is gone.
    expect(relativePaths).toEqual([
      '/.peaks/_runtime/resume-writer-preview/prd/autonomous-goal-package.json',
      '/.peaks/_runtime/resume-writer-preview/rd/swarm/autonomous-rd-plan.json',
      '/.peaks/_runtime/resume-writer-preview/rd/swarm/checkpoints/checkpoint-1.json',
      '/.peaks/_runtime/resume-writer-preview/rd/swarm/evidence/unit-tests.md',
      '/.peaks/_runtime/resume-writer-preview/rd/swarm/evidence/validation-report.md',
      '/.peaks/_runtime/resume-writer-preview/rd/swarm/resume-instructions.md'
    ]);
  });

  test('writes all six artifact files when apply is true', async () => {
    const workspace = newWorkspace();

    const result = await writeAutonomousResumeArtifacts({
      sessionId: 'resume-writer-apply',
      goal: 'Apply the resume scaffold',
      artifactWorkspacePath: workspace,
      apply: true,
      clock: () => '2026-05-25T00:00:00.000Z'
    });

    expect(result.applied).toBe(true);
    for (const file of result.files) {
      expect(existsSync(file.path)).toBe(true);
    }
    const checkpoint = JSON.parse(readFileSync(result.files[2]!.path, 'utf8')) as { createdAt: string; validationRefs: string[] };
    expect(checkpoint.createdAt).toBe('2026-05-25T00:00:00.000Z');
    expect(checkpoint.validationRefs).toEqual(['unit-tests.md']);
  });

  test('refuses to overwrite an existing artifact file when apply is true', async () => {
    const workspace = newWorkspace();
    // Slice 2026-06-29-change-id-root-removal: pre-existing artifact
    // is staged at the canonical session dir
    // `.peaks/_runtime/<sid>/...` (the location
    // `writeAutonomousResumeArtifacts` would write to).
    const goalPackagePath = join(workspace, '.peaks', '_runtime', 'resume-writer-overwrite', 'prd', 'autonomous-goal-package.json');
    mkdirSync(join(workspace, '.peaks', '_runtime', 'resume-writer-overwrite', 'prd'), { recursive: true });
    writeFileSync(goalPackagePath, '{}', 'utf8');

    await expect(
      writeAutonomousResumeArtifacts({
        sessionId: 'resume-writer-overwrite',
        goal: 'Overwrite attempt',
        artifactWorkspacePath: workspace,
        apply: true
      })
    ).rejects.toThrowError(/already exists/);
  });

  test('rejects an unsafe session id (path-traversal)', async () => {
    // Slice 2026-06-29-change-id-root-removal: the structural safety
    // check still fires for unsafe session ids (path-traversal pattern
    // `'../escape'`). The test name reflects the user-facing surface
    // ("unsafe session id") since the change-id axis is gone.
    await expect(
      writeAutonomousResumeArtifacts({
        sessionId: '../escape',
        goal: 'Unsafe',
        artifactWorkspacePath: newWorkspace(),
        apply: false
      })
    ).rejects.toThrow();
  });

  test('rejects an empty goal', async () => {
    await expect(
      writeAutonomousResumeArtifacts({
        sessionId: 'resume-writer-empty-goal',
        goal: '   ',
        artifactWorkspacePath: newWorkspace(),
        apply: false
      })
    ).rejects.toThrowError(/non-empty/);
  });

  test('produces resume artifacts that satisfy the autonomous resume validator', async () => {
    const { workspace, artifactWorkspace } = createWorkspaceWithArtifactWorkspace();
    const sessionId = 'resume-writer-roundtrip';
    const goal = 'Round-trip the resume scaffold through the validator';
    writeApprovedTechArtifacts(artifactWorkspace, sessionId);

    const writeResult = await writeAutonomousResumeArtifacts({
      sessionId,
      goal,
      artifactWorkspacePath: artifactWorkspace,
      apply: true,
      clock: () => '2026-05-25T00:00:00.000Z'
    });

    expect(writeResult.applied).toBe(true);

    const plan = createAutonomousWorkflowPlan({
      mode: 'code',
      sessionId,
      goal,
      maxWorkers: 40,
      dryRun: true,
      workspace,
      artifactWorkspacePath: artifactWorkspace
    });

    expect(plan.resumePlan.status).toBe('ready');
    expect(plan.blockedReasons).not.toContain('resume-artifacts-missing');
    expect(plan.blockedReasons).not.toContain('resume-artifacts-invalid');
  });
});
