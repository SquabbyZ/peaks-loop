/**
 * Slice 2026-06-28-solo-mode-bypass-fix (defect #3).
 *
 * Pins the contract that `verifyPipeline` looks for evidence files at
 * the canonical `.peaks/_runtime/change/<changeId>/<role>/...` path
 * AND falls back to the legacy misplaced paths
 * (`.peaks/<changeId>/...` and `.peaks/_runtime/<changeId>/...`)
 * during the 1-minor-release deprecation window. When the fallback
 * fires, the gate detail + nextActions surface a
 * `DEPRECATION_LEGACY_PATH_USED` warning so QA / TXT can nudge users
 * to migrate.
 *
 * Pre-slice behaviour: built `.peaks/<changeId>/rd/<file>` (forgetting
 * `_runtime/change/`), so every gate was missing even when files
 * existed in canonical form. Post-slice: canonical is the primary hit
 * with deprecation-tagged fallback for un-migrated workspaces.
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

describe('pipeline-verify-service — slice 2026-06-28-solo-mode-bypass-fix', () => {
  it('resolves canonical evidence under .peaks/_runtime/change/<id>/rd/', async () => {
    const changeId = 'canonical-rd-1';
    const dir = join(projectRoot, '.peaks', '_runtime', 'change', changeId, 'rd');
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

  it('falls back to legacy misplaced path with DEPRECATION warning', async () => {
    const changeId = 'legacy-misplaced-rd-1';
    const dir = join(projectRoot, '.peaks', '_runtime', changeId, 'rd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'tech-doc.md'), '# tech');

    const result = await verifyPipeline({ projectRoot, rid: '001-legacy', changeId, requestType: 'feature' });
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
    writeFileSync(join(dir, 'tech-doc.md'), '# tech');

    const result = await verifyPipeline({ projectRoot, rid: '001-top-level', changeId, requestType: 'feature' });
    const techDoc = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'tech-doc')!;
    expect(techDoc.passed).toBe(true);
    expect(techDoc.detail).toContain('DEPRECATION_LEGACY_PATH_USED');
    expect(result.usedCanonicalPath).toBe(false);
  });

  it('reports missing canonical when no legacy exists', async () => {
    const changeId = 'absent-rd-1';
    const result = await verifyPipeline({ projectRoot, rid: '001-absent', changeId, requestType: 'feature' });
    const techDoc = result.rdPhase.gates.find((g: PipelineGate) => g.name === 'tech-doc')!;
    expect(techDoc.passed).toBe(false);
    expect(techDoc.detail).toContain(`missing: ${join(projectRoot, '.peaks', '_runtime', 'change', changeId, 'rd', 'tech-doc.md')}`);
  });
});