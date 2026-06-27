import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/mode/mode-enforcement.js', () => ({
  requireUserConfirmation: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../src/services/artifacts/artifact-lint-service.js', () => ({
  lintRequestArtifact: vi.fn().mockResolvedValue(null)
}));

import {
  createRequestArtifact,
  transitionRequestArtifact,
  PrerequisitesNotSatisfiedError
} from '../../src/services/artifacts/request-artifact-service.js';

const SESSION = '2026-05-25-gated';
const TS = '2026-05-25T08:00:00.000Z';
const REQUEST_ID = '2026-05-25-feat';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-prereq-'));
}

async function seedRd(project: string, requestId: string): Promise<void> {
  await createRequestArtifact({
    role: 'rd', requestId, projectRoot: project, sessionId: SESSION, apply: true, clock: () => TS
  });
}

async function seedQa(project: string, requestId: string): Promise<void> {
  await createRequestArtifact({
    role: 'qa', requestId, projectRoot: project, sessionId: SESSION, apply: true, clock: () => TS
  });
}

async function writeArtifact(project: string, changeId: string, relativePath: string, body: string): Promise<void> {
  // As of slice 006, the prerequisite gate resolves paths under the
  // session dir (`.peaks/_runtime/<sid>/<role>/...`). The `changeId`
  // parameter is preserved as the body's `- change-id:` line for
  // human navigation; it is no longer a filesystem path key. Tests
  // pass `SESSION` as the changeId so the file lives in the same
  // session dir the prereq gate scans.
  const fullPath = join(project, '.peaks', '_runtime', SESSION, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, body, 'utf8');
}

describe('transitionRequestArtifact — prerequisite enforcement', () => {
  // (v2.11.0 Group A: rd/tech-doc.md is removed as a prerequisite. The
  // rd:implemented transition now has no artifact gate — the immutable
  // peaks-prd handoff (Group B) will introduce the new gate at
  // prd/handoff.md. The two legacy tests below are replaced by a single
  // assertion that rd:implemented passes without any prereq artifact.)
  test('rd→implemented passes with no prerequisite artifact (v2.11.0: tech-doc gate removed)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID);
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: REQUEST_ID, projectRoot: project,
      newState: 'implemented', clock: () => TS
    });
    expect(result?.state).toBe('implemented');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });

  test('rd→qa-handoff is blocked when code-review.md, audit/security.md, audit/perf.md, or prd/handoff.md is missing (v2.12.0 Tier 5)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID);
    // v2.12.0 Tier 5: the v2.11.x rd/{security-review,perf-baseline}.md
    // slots are replaced by audit/security.md + audit/perf.md (the new
    // peaks-security-audit / peaks-perf-audit outputs). The
    // AUDIT_REQUIRES_HANDOFF gate also requires prd/handoff.md.
    // code-review, audit/*, prd/handoff, unit-tests, and qa-initiated
    // intentionally missing.
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: REQUEST_ID, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('rd/code-review.md');
    expect(missingPaths).toContain('audit/security.md');
    expect(missingPaths).toContain('audit/perf.md');
    expect(missingPaths).toContain('prd/handoff.md');
    expect(missingPaths).toContain('mut/mut-report.json');
    expect(missingPaths).toContain('qa/test-cases/2026-05-25-feat.md');
    expect(missingPaths).toContain('qa/.initiated');
    // v2.11.x legacy paths must NOT be in the missing list — the new
    // AUDIT_SECURITY / AUDIT_PERF entries own the gate.
    expect(missingPaths).not.toContain('rd/security-review.md');
    expect(missingPaths).not.toContain('rd/perf-baseline.md');
  });

  test('rd→qa-handoff passes when audit/perf.md carries a Baseline table (Gate B9′)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID);
    await writeArtifact(project, REQUEST_ID, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    // v2.12.0 Tier 5: peaks-security-audit output → audit/security.md
    // (## Verdict header).
    await writeArtifact(project, REQUEST_ID, 'audit/security.md', '# Security audit\n\n## Verdict\n\n- pass');
    // karpathy-review is now a blocking prereq for rd:qa-handoff
    // (per L2.2 Slice 2/6 karpathy-enforcement). Include it.
    await writeArtifact(
      project,
      REQUEST_ID,
      'rd/karpathy-review.md',
      '# Karpathy review\n\n## Karpathy-Gate\n\n### Think Before Coding\n\n- done\n\n### Simplicity First\n\n- done\n\n### Surgical Changes\n\n- done\n\n### Goal-Driven Execution\n\n- done\n'
    );
    // v2.12.0 Tier 5: peaks-perf-audit output → audit/perf.md with the
    // Baseline header (Gate B9′ — replaces the v2.11.x Results table).
    await writeArtifact(
      project,
      REQUEST_ID,
      'audit/perf.md',
      '# Perf audit\n\n## Baseline\n\n| metric | baseline | target |\n|---|---|---|\n| render-time | 120ms | <200ms |\n'
    );
    // PRD handoff required by AUDIT_REQUIRES_HANDOFF (must carry
    // schemaVersion: 2 + sha256: markers so the audit skills can read it).
    await writeArtifact(
      project,
      REQUEST_ID,
      'prd/handoff.md',
      '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n\n## Goals\n\n- ...'
    );
    await writeArtifact(project, REQUEST_ID, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, REQUEST_ID, 'qa/.initiated', '');
    // v2.13.1 Group A: MUT_REPORT added to FEATURE_TABLE rd:qa-handoff.
    // Seed a valid peaks-mut report so the new prereq passes.
    await writeArtifact(
      project,
      REQUEST_ID,
      'mut/mut-report.json',
      JSON.stringify({ schemaVersion: 1, passed: true, killRate: 0.9, weakRate: 0.01, violations: [] })
    );
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: REQUEST_ID, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });

  test('rd→qa-handoff passes when audit/perf.md carries the N/A — no perf surface marker (escape hatch)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID);
    await writeArtifact(project, REQUEST_ID, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    await writeArtifact(project, REQUEST_ID, 'audit/security.md', '# Security audit\n\n## Verdict\n\n- pass');
    await writeArtifact(
      project,
      REQUEST_ID,
      'rd/karpathy-review.md',
      '# Karpathy review\n\n## Karpathy-Gate\n\n### Think Before Coding\n\n- done\n\n### Simplicity First\n\n- done\n\n### Surgical Changes\n\n- done\n\n### Goal-Driven Execution\n\n- done\n'
    );
    // Perf audit with the N/A escape hatch (no Baseline table).
    await writeArtifact(
      project,
      REQUEST_ID,
      'audit/perf.md',
      '# Perf audit\n\n## Notes\n\nN/A — no perf surface (this is a pure data-migration slice).\n'
    );
    await writeArtifact(
      project,
      REQUEST_ID,
      'prd/handoff.md',
      '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n'
    );
    await writeArtifact(project, REQUEST_ID, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, REQUEST_ID, 'qa/.initiated', '');
    // v2.13.1 Group A: MUT_REPORT — N/A perf surface still requires a
    // passing mut report (mutation testing is independent of perf).
    await writeArtifact(
      project,
      REQUEST_ID,
      'mut/mut-report.json',
      JSON.stringify({ schemaVersion: 1, passed: true, killRate: 0.9, weakRate: 0.01, violations: [] })
    );
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: REQUEST_ID, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
  });

  test('rd→qa-handoff is blocked when audit/perf.md exists but has neither Baseline nor N/A marker', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID);
    await writeArtifact(project, REQUEST_ID, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    await writeArtifact(project, REQUEST_ID, 'audit/security.md', '# Security audit\n\n## Verdict\n\n- pass');
    // Audit perf stub WITHOUT a Baseline header and WITHOUT the N/A marker.
    await writeArtifact(project, REQUEST_ID, 'audit/perf.md', '# Perf audit\n\nWIP\n');
    await writeArtifact(
      project,
      REQUEST_ID,
      'prd/handoff.md',
      '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n'
    );
    await writeArtifact(project, REQUEST_ID, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, REQUEST_ID, 'qa/.initiated', '');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: REQUEST_ID, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    // The audit/perf.md gate fires because its body has neither the
    // "## Baseline" header nor the "N/A — no perf surface" marker.
    // The path reported is the canonical primary path
    // (audit/perf.md), not the legacy fallback (rd/perf-baseline.md).
    expect(missingPaths).toContain('audit/perf.md');
  });

  test('rd→qa-handoff passes via legacy rd/perf-baseline.md 1-minor-release back-compat (Tier 5)', async () => {
    // A slice from v2.11.x that still has rd/perf-baseline.md on disk
    // must continue to satisfy the gate during the v2.12.0 1-minor-
    // release back-compat window. AUDIT_PERF.legacyRelativePath carries
    // the legacy path through.
    const project = await makeProject();
    await seedRd(project, REQUEST_ID);
    await writeArtifact(project, REQUEST_ID, 'rd/code-review.md', '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0');
    await writeArtifact(project, REQUEST_ID, 'rd/security-review.md', '# SR\n\n## Findings\n\n- none');
    await writeArtifact(
      project,
      REQUEST_ID,
      'rd/karpathy-review.md',
      '# Karpathy review\n\n## Karpathy-Gate\n\n### Think Before Coding\n\n- done\n\n### Simplicity First\n\n- done\n\n### Surgical Changes\n\n- done\n\n### Goal-Driven Execution\n\n- done\n'
    );
    // Legacy path: rd/perf-baseline.md with Results table.
    await writeArtifact(
      project,
      REQUEST_ID,
      'rd/perf-baseline.md',
      '# Perf baseline\n\n## Results\n\n| metric | baseline | target |\n|---|---|---|\n| render-time | 120ms | <200ms |\n'
    );
    await writeArtifact(
      project,
      REQUEST_ID,
      'prd/handoff.md',
      '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n'
    );
    await writeArtifact(project, REQUEST_ID, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, REQUEST_ID, 'qa/.initiated', '');
    // v2.13.1 Group A: MUT_REPORT — same gate applied to the legacy
    // rd/perf-baseline.md back-compat path.
    await writeArtifact(
      project,
      REQUEST_ID,
      'mut/mut-report.json',
      JSON.stringify({ schemaVersion: 1, passed: true, killRate: 0.9, weakRate: 0.01, violations: [] })
    );
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: REQUEST_ID, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
  });

  test('qa→verdict-issued passes with only test-cases + test-reports (v2.11.0 D1/D4: peaks-rd owns security + perf evidence)', async () => {
    const project = await makeProject();
    await seedQa(project, REQUEST_ID);
    await writeArtifact(project, REQUEST_ID, 'qa/test-cases/2026-05-25-feat.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, REQUEST_ID, 'qa/test-reports/2026-05-25-feat.md', '# report\n\n## Test execution\n\n- pass');
    // Note (v2.11.0 D1/D4): qa/security-findings.md and qa/performance-findings.md
    // are no longer required at qa:verdict-issued. peaks-rd's audit fan-out owns
    // the security + perf evidence (rd/security-review.md + rd/perf-baseline.md);
    // QA cites them by reference from the test-report body.
    const result = await transitionRequestArtifact({
      role: 'qa', requestId: REQUEST_ID, projectRoot: project,
      newState: 'verdict-issued', clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
  });

  test('allowIncomplete=true bypasses the check and records the bypass in the artifact body', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-doc-only');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-doc-only', projectRoot: project,
      newState: 'qa-handoff', allowIncomplete: true,
      reason: 'docs-only change, no implementation', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.bypassedPrerequisites?.ok).toBe(false);
    expect(result?.bypassedPrerequisites?.missing.length).toBeGreaterThan(0);
    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain('docs-only change');
    expect(body).toContain('bypassed prerequisites');
    // (v2.11.0 Group A: rd/tech-doc.md no longer a prereq; bypass now only
    // mentions the still-required evidence files.)
    expect(body).toContain('rd/code-review.md');
  });

  test('transitions with no prerequisites stay unaffected (prd→confirmed-by-user)', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'confirmed-by-user', clock: () => TS
    });
    expect(result?.state).toBe('confirmed-by-user');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });
});
