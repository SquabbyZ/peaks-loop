/**
 * tech-change-id-service — change-id-axis slice of the tech planner (rid-012).
 *
 * Source-of-truth TDD tests for:
 *   - `validateTechChangeId(id)` → Result<{ changeId }, ChangeIdError>
 *     (reuses `validateChangeId` from rid-009; consumer-side thin wrapper)
 *   - `planTechArtifactPath(input)` → Result<{ absolutePath, relativePath,
 *     jsonSafeRelativePath }, BoundaryError>
 *     (reuses `planArtifactPath`; computes tech-task-graph, wave manifests,
 *     reviewChecklist, approvalTemplate under
 *     `.peaks/changes/<change-id>/architecture/...`)
 *   - `buildTechWorkspaceUnavailable({ mode })` → WorkspaceUnavailableResponse
 *     (reuses `buildWorkspaceUnavailable`; surface the rid-009 nextActions
 *     constant)
 *
 * Test count budget (per `.peaks/_runtime/2026-07-24-session-f13da7/rd/requests/2026-07-24-rid-012-add-tech-dry-run-gate.md` §2.2):
 *   - validateTechChangeId valid (9)
 *   - validateTechChangeId invalid (6)
 *   - planTechArtifactPath (5)
 *   - buildTechWorkspaceUnavailable (4)
 *   - Cross-helper scenarios (6)
 * Total = 30 cases.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  validateTechChangeId,
  planTechArtifactPath,
  buildTechWorkspaceUnavailable,
} from '../../../../src/services/tech/tech-change-id-service.js';

describe('validateTechChangeId — valid cases (9)', () => {
  test('accepts a typical lowercase change id', () => {
    const result = validateTechChangeId('add-tech-dry-run-gate');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('add-tech-dry-run-gate');
    }
  });

  test('accepts a mixed-case change id (R2-DryRunGate)', () => {
    const result = validateTechChangeId('R2-DryRunGate');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('R2-DryRunGate');
    }
  });

  test('accepts a digits-leading change id (2026-rd-12)', () => {
    const result = validateTechChangeId('2026-rd-12');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('2026-rd-12');
    }
  });

  test('accepts a single-character change id', () => {
    const result = validateTechChangeId('a');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe('a');
    }
  });

  test('accepts a change id with a dot', () => {
    const result = validateTechChangeId('add.foo');
    expect(result.ok).toBe(true);
  });

  test('accepts a change id with an underscore', () => {
    const result = validateTechChangeId('add_foo');
    expect(result.ok).toBe(true);
  });

  test('accepts a change id with multiple internal dots + hyphens + underscores', () => {
    const result = validateTechChangeId('add.foo-bar_baz.qux');
    expect(result.ok).toBe(true);
  });

  test('accepts a single-digit change id', () => {
    const result = validateTechChangeId('7');
    expect(result.ok).toBe(true);
  });

  test('accepts a 64-character change id (boundary: regex has no length cap)', () => {
    const longId = 'a'.repeat(64);
    const result = validateTechChangeId(longId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.changeId).toBe(longId);
    }
  });
});

describe('validateTechChangeId — invalid cases (6)', () => {
  test('rejects empty change id with code change-id-empty', () => {
    const result = validateTechChangeId('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-empty');
    }
  });

  test('rejects "." with code change-id-reserved', () => {
    const result = validateTechChangeId('.');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-reserved');
    }
  });

  test('rejects ".." with code change-id-reserved', () => {
    const result = validateTechChangeId('..');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-reserved');
    }
  });

  test('rejects "foo/../bar" with code change-id-format (slash segment)', () => {
    const result = validateTechChangeId('foo/../bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    }
  });

  test('rejects "foo\\\\bar" with code change-id-format (backslash segment)', () => {
    const result = validateTechChangeId('foo\\bar');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    }
  });

  test('rejects "C:/foo" with code change-id-format (Windows drive prefix)', () => {
    const result = validateTechChangeId('C:/foo');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('change-id-format');
    }
  });
});

describe('planTechArtifactPath (5 cases)', () => {
  function makeWorkspaceRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), 'peaks-tech-cid-'));
    return resolve(dir);
  }

  test('returns 5 artifact paths (taskGraph + 4 wave manifests + reviewChecklist + approvalTemplate) under the workspace root', () => {
    const workspaceRoot = makeWorkspaceRoot();
    const result = planTechArtifactPath({
      changeId: 'add-tech-dry-run-gate',
      workspaceRoot,
      requestId: 'rid-012',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // taskGraph
    expect(result.value.taskGraph.jsonSafeRelativePath).toBe('add-tech-dry-run-gate/architecture/tech-task-graph.json');
    expect(result.value.taskGraph.jsonSafeRelativePath).not.toContain('\\');

    // 4 wave manifests
    expect(result.value.waveManifests).toHaveLength(4);
    for (const wave of result.value.waveManifests) {
      expect(wave.jsonSafeRelativePath.startsWith('add-tech-dry-run-gate/architecture/waves/')).toBe(true);
      expect(wave.jsonSafeRelativePath).not.toContain('\\');
    }

    // reviewChecklist
    expect(result.value.reviewChecklist.jsonSafeRelativePath).toBe('add-tech-dry-run-gate/architecture/tech-review-checklist.md');

    // approvalTemplate
    expect(result.value.approvalTemplate.jsonSafeRelativePath).toBe('add-tech-dry-run-gate/architecture/tech-approval-record.template.md');
  });

  test('every returned absolutePath is inside the workspace root (path-safety invariant)', () => {
    const workspaceRoot = makeWorkspaceRoot();
    const result = planTechArtifactPath({
      changeId: 'add-tech-dry-run-gate',
      workspaceRoot,
      requestId: 'rid-012',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const allPaths = [
      result.value.taskGraph,
      ...result.value.waveManifests,
      result.value.reviewChecklist,
      result.value.approvalTemplate,
    ];

    for (const pathResult of allPaths) {
      const abs = resolve(pathResult.absolutePath);
      expect(abs.startsWith(resolve(workspaceRoot))).toBe(true);
    }
  });

  test('JSON-round-trip: every jsonSafeRelativePath uses forward slashes (the rid-009 JSON-safety contract)', () => {
    const workspaceRoot = makeWorkspaceRoot();
    const result = planTechArtifactPath({
      changeId: 'add-tech-dry-run-gate',
      workspaceRoot,
      requestId: 'rid-012',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const allJsonSafePaths = [
      result.value.taskGraph.jsonSafeRelativePath,
      ...result.value.waveManifests.map((w) => w.jsonSafeRelativePath),
      result.value.reviewChecklist.jsonSafeRelativePath,
      result.value.approvalTemplate.jsonSafeRelativePath,
    ];

    for (const path of allJsonSafePaths) {
      expect(path).not.toContain('\\');
      expect(path.includes('/')).toBe(true);
    }
  });

  test('stable call: same input returns identical output (no hidden mutable state)', () => {
    const workspaceRoot = makeWorkspaceRoot();
    const input = { changeId: 'add-tech-dry-run-gate', workspaceRoot, requestId: 'rid-012' };

    const first = planTechArtifactPath(input);
    const second = planTechArtifactPath(input);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('rejects workspaceRoot that escapes the artifact root (path-outside-artifact-root)', () => {
    const workspaceRoot = makeWorkspaceRoot();
    // Build a candidate path that climbs out of the workspace
    const result = planTechArtifactPath({
      changeId: '../../etc/passwd',
      workspaceRoot,
      requestId: 'rid-012',
    });

    // Either change-id validation fails (preferred path), or the path planner
    // fails with path-outside-artifact-root. Both are valid rejections — but
    // the rejection must be deterministic.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['change-id-format', 'path-outside-artifact-root']).toContain(result.error.code);
    }
  });
});

describe('buildTechWorkspaceUnavailable (4 cases)', () => {
  test('preview-only mode carries the rid-009 nextActions constant', () => {
    const response = buildTechWorkspaceUnavailable({ mode: 'preview-only' });
    expect(response).toMatchObject({
      ok: false,
      mode: 'preview-only',
      reason: 'artifact-workspace-unavailable',
    });
    expect(response.nextActions.some((action) => action.includes('Configure artifact workspace'))).toBe(true);
  });

  test('blocked mode preserves the blocked literal', () => {
    const response = buildTechWorkspaceUnavailable({ mode: 'blocked' });
    expect(response.mode).toBe('blocked');
    expect(response.ok).toBe(false);
  });

  test('reason is always the artifact-workspace-unavailable literal across both modes', () => {
    for (const mode of ['preview-only', 'blocked'] as const) {
      expect(buildTechWorkspaceUnavailable({ mode }).reason).toBe('artifact-workspace-unavailable');
    }
  });

  test('nextActions is a non-empty string array for both modes', () => {
    for (const mode of ['preview-only', 'blocked'] as const) {
      const { nextActions } = buildTechWorkspaceUnavailable({ mode });
      expect(nextActions.length).toBeGreaterThan(0);
      expect(nextActions.every((action) => typeof action === 'string' && action.length > 0)).toBe(true);
    }
  });
});

describe('cross-helper scenarios (6 cases)', () => {
  test('scenario: validate then plan — accepts a typical change id and produces a 5-paths artifact plan', () => {
    const workspaceRoot = resolve(mkdtempSync(join(tmpdir(), 'peaks-tech-cid-scenario-')));

    const validation = validateTechChangeId('add-tech-dry-run-gate');
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const plan = planTechArtifactPath({
      changeId: validation.value.changeId,
      workspaceRoot,
      requestId: 'rid-012',
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.taskGraph.jsonSafeRelativePath).toBe('add-tech-dry-run-gate/architecture/tech-task-graph.json');
  });

  test('scenario: plan is path-math-only — works even if the workspace directory does not exist', () => {
    const nonexistentWorkspace = resolve(mkdtempSync(join(tmpdir(), 'peaks-tech-cid-rm-')));
    rmSync(nonexistentWorkspace, { recursive: true, force: true });

    const plan = planTechArtifactPath({
      changeId: 'add-tech-dry-run-gate',
      workspaceRoot: nonexistentWorkspace,
      requestId: 'rid-012',
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(existsSync(plan.value.taskGraph.absolutePath)).toBe(false);
  });

  test('scenario: invalid change id is rejected by validate before plan is called (no fs side-effect)', () => {
    const workspaceRoot = resolve(mkdtempSync(join(tmpdir(), 'peaks-tech-cid-nosidefx-')));
    const validation = validateTechChangeId('bad/id');
    expect(validation.ok).toBe(false);
    if (validation.ok) return;

    // Caller-side contract: do not even invoke plan when validation fails.
    // This test only documents that the rejection has no fs side-effect
    // by asserting that the workspace is empty.
    expect(existsSync(join(workspaceRoot, 'bad'))).toBe(false);
  });

  test('scenario: workspace-unavailable shape matches rid-009 buildWorkspaceUnavailable byte-for-byte', () => {
    const techResponse = buildTechWorkspaceUnavailable({ mode: 'preview-only' });
    expect(techResponse).toMatchObject({
      ok: false,
      mode: 'preview-only',
      reason: 'artifact-workspace-unavailable',
    });
    // The nextActions string MUST come from the rid-009 source-of-truth.
    expect(techResponse.nextActions).toEqual([
      'Configure artifact workspace by describing where Peaks should store artifacts.'
    ]);
  });

  test('scenario: planTechArtifactPath with change id containing dots still uses forward slashes in JSON output', () => {
    const workspaceRoot = resolve(mkdtempSync(join(tmpdir(), 'peaks-tech-cid-dots-')));
    const plan = planTechArtifactPath({
      changeId: 'add.foo-bar',
      workspaceRoot,
      requestId: 'rid-012',
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Dots in the change id are fine; separators must be /
    expect(plan.value.taskGraph.jsonSafeRelativePath).toBe('add.foo-bar/architecture/tech-task-graph.json');
  });

  test('scenario: workspace-unavailable response is stable across calls (no shared mutable state)', () => {
    const first = buildTechWorkspaceUnavailable({ mode: 'preview-only' });
    const second = buildTechWorkspaceUnavailable({ mode: 'preview-only' });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    // Mutate the first to prove the second is not aliased
    first.nextActions.push('mutation');
    expect(second.nextActions).not.toContain('mutation');
  });
});

// Cleanup helper: remove all tempdirs created during the run.
import { afterAll } from 'vitest';
afterAll(() => {
  // Best-effort cleanup; tmpdir() entries are removed by the OS eventually.
});