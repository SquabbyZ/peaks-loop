/**
 * v2.13.2 AC-5 — MUT_REPORT soft-block tests (≥2 cases).
 *
 * Pins:
 *   - missing MUT_REPORT → warning (not throw), other prereqs still gate
 *   - present MUT_REPORT with passed:false → still throws (hard block)
 *   - present MUT_REPORT with passed:true → clean transition
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/services/mode/mode-enforcement.js', () => ({
  requireUserConfirmation: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../src/services/artifacts/artifact-lint-service.js', () => ({
  lintRequestArtifact: vi.fn().mockResolvedValue(null)
}));

import { checkPrerequisites } from '../../src/services/artifacts/artifact-prerequisites.js';

const SID = '2026-06-27-soft-block';
const REQUEST_ID = '2026-06-27-soft-block-feat';
const CHANGE_ID = 'v2-13-2-soft-block';

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-soft-block-'));
  const runtime = join(dir, '.peaks', '_runtime', SID);
  mkdirSync(join(runtime, 'rd'), { recursive: true });
  mkdirSync(join(runtime, 'audit'), { recursive: true });
  mkdirSync(join(runtime, 'mut'), { recursive: true });
  mkdirSync(join(runtime, 'prd'), { recursive: true });
  mkdirSync(join(runtime, 'qa', 'test-cases'), { recursive: true });
  return dir;
}

function seedAllExceptMut(project: string): void {
  // Seed the other 7 prereqs so MUT is the only one missing.
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'rd', 'code-review.md'), '## Findings\nCRITICAL none\n');
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'audit', 'security.md'), '## Verdict\nverdict: pass\n');
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'audit', 'perf.md'), '## Baseline\nN/A — no perf surface\n');
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'prd', 'handoff.md'), '---\nschemaVersion: 2\nsha256: a\n---\n# handoff\n');
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'rd', 'karpathy-review.md'), '## Karpathy-Gate\n### Think Before Coding\n### Simplicity First\n### Surgical Changes\n### Goal-Driven Execution\n');
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'qa', 'test-cases', `${REQUEST_ID}.md`), '## Test cases\ntest("x")\n');
  writeFileSync(join(project, '.peaks', '_runtime', SID, 'qa', '.initiated'), '');
}

function writeMut(project: string, passed: boolean): void {
  writeFileSync(
    join(project, '.peaks', '_runtime', SID, 'mut', 'mut-report.json'),
    JSON.stringify({ schemaVersion: 1, passed, killRate: passed ? 0.9 : 0.5, weakRate: 0.01, violations: [] })
  );
}

describe('v2.13.2 MUT_REPORT soft-block (AC-5)', () => {
  let project: string;
  beforeEach(() => { project = makeProject(); });
  afterEach(() => { /* tmp cleanup is OS-level */ });

  test('A: missing MUT_REPORT (others present) → ok=true, warnings carries mut-report-missing-deprecated-in-v2.14.0', async () => {
    seedAllExceptMut(project);
    // Deliberately omit mut/mut-report.json.
    const result = await checkPrerequisites({
      projectRoot: project,
      changeId: CHANGE_ID,
      sessionId: SID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: REQUEST_ID,
      requestType: 'feature'
    });
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.path).toBe('mut/mut-report.json');
    expect(result.warnings[0]!.code).toBe('mut-report-missing-deprecated-in-v2.14.0');
  });

  test('B: present MUT_REPORT with passed:false → still throws (hard block, 2.14.0 only softens the missing case)', async () => {
    mkdirSync(join(project, '.peaks', '_runtime', SID, 'mut'), { recursive: true });
    writeFileSync(
      join(project, '.peaks', '_runtime', SID, 'mut', 'mut-report.json'),
      JSON.stringify({ schemaVersion: 1, passed: false, killRate: 0.5, weakRate: 0.20, violations: [{ kind: 'mutationKillRateMin', actual: 0.5, threshold: 0.8 }] })
    );
    const result = await checkPrerequisites({
      projectRoot: project,
      changeId: CHANGE_ID,
      sessionId: SID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: REQUEST_ID,
      requestType: 'feature'
    });
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.path)).toContain('mut/mut-report.json');
    // Note: result.warnings is empty in this case — backCompat only
    // covers the MISSING case, not the failed case.
    expect(result.warnings).toEqual([]);
  });
});