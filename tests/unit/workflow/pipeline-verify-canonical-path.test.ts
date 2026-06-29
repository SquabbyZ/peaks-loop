/**
 * Slice v2.18.1 — verifyPipeline path-axis update.
 *
 * Pins the contract that `verifyPipeline` looks for evidence files at
 * the canonical v2.17.0 session-axis path
 * `.peaks/_runtime/<sessionId>/<role>/...` AND falls back to the
 * legacy change-axis paths
 * (`.peaks/<changeId>/...`, `.peaks/_runtime/<changeId>/...`,
 * and the v2.16.0-era `.peaks/_runtime/change/<changeId>/...`)
 * during the 1-minor-release deprecation window. When the fallback
 * fires, the gate detail + nextActions surface a
 * `DEPRECATION_LEGACY_PATH_USED` warning so QA / TXT can nudge users
 * to migrate.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPipeline, type PipelineGate } from '../../../src/services/workflow/pipeline-verify-service.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-pipeline-verify-'));
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('pipeline-verify-service — v2.18.1 path-axis update', () => {
  it('resolves canonical evidence under .peaks/_runtime/<sessionId>/rd/', async () => {
    const changeId = 'canonical-rd-1';
    const dir = join(projectRoot, '.peaks', '_runtime', changeId, 'rd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tech-doc.md'), '# tech');
    writeFileSync(join(dir, 'code-review.md'), '# cr');
    writeFileSync(join(dir, 'security-review.md'), '# sr');

    const result = await verifyPipeline({ projectRoot, rid: '001-canonical-rd', changeId, requestType: 'feature' });
    const techDoc = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'tech-doc')!;
    const cr = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'code-review')!;
    const sr = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'security-review')!;
    expect(techDoc.passed).toBe(true);
    expect(cr.passed).toBe(true);
    expect(sr.passed).toBe(true);
    expect(techDoc.detail).not.toContain('DEPRECATION_LEGACY_PATH_USED');
    expect(cr.detail).not.toContain('DEPRECATION_LEGACY_PATH_USED');
    expect(result.usedCanonicalPath).toBe(true);
  });

  it('falls back to v2.16.0 change-axis path with DEPRECATION warning', async () => {
    const changeId = 'change-axis-rd-1';
    const dir = join(projectRoot, '.peaks', '_runtime', 'change', changeId, 'rd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tech-doc.md'), '# tech');

    const result = await verifyPipeline({ projectRoot, rid: '001-change-axis', changeId, requestType: 'feature' });
    const techDoc = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'tech-doc')!;
    expect(techDoc.passed).toBe(true);
    expect(techDoc.detail).toContain('DEPRECATION_LEGACY_PATH_USED');
    expect(result.violations.some((v: string) => v.includes('DEPRECATION_LEGACY_PATH_USED'))).toBe(true);
    expect(result.usedCanonicalPath).toBe(false);
  });

  it('falls back to .peaks/<id>/rd/ form with DEPRECATION warning', async () => {
    const changeId = 'peaks-top-level-rd-1';
    const dir = join(projectRoot, '.peaks', changeId, 'rd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'security-review.md'), '# sr');

    const result = await verifyPipeline({ projectRoot, rid: '001-top-level', changeId, requestType: 'feature' });
    const sr = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'security-review')!;
    expect(sr.passed).toBe(true);
    expect(sr.detail).toContain('DEPRECATION_LEGACY_PATH_USED');
    expect(result.usedCanonicalPath).toBe(false);
  });

  it('reports missing canonical (session axis) when no legacy exists', async () => {
    const changeId = 'absent-rd-1';
    const result = await verifyPipeline({ projectRoot, rid: '001-absent', changeId, requestType: 'feature' });
    const techDoc = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'tech-doc')!;
    expect(techDoc.passed).toBe(false);
    expect(techDoc.detail).toContain(`missing: ${join(projectRoot, '.peaks', '_runtime', changeId, 'rd', 'tech-doc.md')}`);
  });

  // ------------------------------------------------------------------
  // v2.18.1 PATCH (bug #5) — session-axis acceptance criteria.
  //
  // The pre-v2.18.1 verifyPipeline looked for evidence under the
  // v2.16.0-era change axis (`.peaks/_runtime/change/<id>/`) and
  // returned PIPELINE_INCOMPLETE for any RID whose artifacts lived
  // under the post-v2.17.0 session axis
  // (`.peaks/_runtime/<sessionId>/`). These tests pin the v2.18.1
  // contract: evidence under the session axis resolves as canonical
  // (no DEPRECATION warning), and the change-id slug appears in the
  // output envelope as metadata (not as the filesystem scope key).
  // ------------------------------------------------------------------

  it('v2.18.1 AC #5.1 — RD artifact + session-axis evidence resolves complete pipeline', async () => {
    const sessionId = '2026-06-29-session-9cac8e';
    const changeId = 'v2.18.1-change-id-slug';
    // RD request artifact at session axis (per showRequestArtifact's
    // canonical layout).
    const rdDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'rd', 'requests');
    mkdirSync(rdDir, { recursive: true });
    writeFileSync(join(rdDir, '001-ac-rid.md'), '# RD\n- session: ' + sessionId + '\n- state: qa-handoff\n- type: feature\n', 'utf8');
    // RD + QA evidence at session axis (canonical).
    const rdEvidenceDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'rd');
    mkdirSync(rdEvidenceDir, { recursive: true });
    writeFileSync(join(rdEvidenceDir, 'tech-doc.md'), '# td');
    writeFileSync(join(rdEvidenceDir, 'code-review.md'), '# cr');
    writeFileSync(join(rdEvidenceDir, 'security-review.md'), '# sr');
    const qaDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'qa', 'requests');
    mkdirSync(qaDir, { recursive: true });
    writeFileSync(join(qaDir, '001-ac-rid.md'), '# QA\n- state: verdict-issued\n- type: feature\n', 'utf8');
    const qaEvidenceDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'qa');
    mkdirSync(join(qaEvidenceDir, 'test-cases'), { recursive: true });
    mkdirSync(join(qaEvidenceDir, 'test-reports'), { recursive: true });
    writeFileSync(join(qaEvidenceDir, 'test-cases', '001-ac-rid.md'), '# cases');
    writeFileSync(join(qaEvidenceDir, 'test-reports', '001-ac-rid.md'), '# reports');
    writeFileSync(join(qaEvidenceDir, 'security-findings-001-ac-rid.md'), '# sec');
    writeFileSync(join(qaEvidenceDir, 'performance-findings-001-ac-rid.md'), '# perf');

    const result = await verifyPipeline({
      projectRoot,
      rid: '001-ac-rid',
      changeId,
      requestType: 'feature'
    });

    expect(result.complete).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.rdPhase.invoked).toBe(true);
    expect(result.qaPhase.invoked).toBe(true);
    expect(result.usedCanonicalPath).toBe(true);
    // Bug #5 AC: data.changeId slug appears in envelope for traceability
    // (metadata only, not filesystem scope).
    expect(result.changeId).toBeTruthy();
  });

  it('v2.18.1 AC #5.2 — RID with NO artifacts returns PIPELINE_INCOMPLETE, not undefined error', async () => {
    const result = await verifyPipeline({
      projectRoot,
      rid: 'missing-everything',
      changeId: 'no-such-change',
      requestType: 'feature'
    });

    expect(result.complete).toBe(false);
    expect(result.rdPhase.invoked).toBe(false);
    expect(result.qaPhase.invoked).toBe(false);
    // Clear, actionable violations — no ReferenceError, no crash.
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.some((v: string) => v.includes('RD phase skipped'))).toBe(true);
    expect(result.violations.some((v: string) => v.includes('QA phase skipped'))).toBe(true);
    expect(result.rdPhase.gates[0]!.detail).toBe('not found');
    expect(result.qaPhase.gates[0]!.detail).toBe('not found');
  });
});