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
  PrerequisitesNotSatisfiedError,
  type RequestType
} from '../../src/services/artifacts/request-artifact-service.js';

const SESSION = '2026-05-25-typed';
const TS = '2026-05-25T08:00:00.000Z';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-typed-'));
}

async function seed(project: string, role: 'rd' | 'qa' | 'prd', requestId: string, requestType: RequestType): Promise<void> {
  await createRequestArtifact({
    role, requestId, projectRoot: project, sessionId: SESSION, apply: true,
    requestType, clock: () => TS
  });
}

async function writeArtifact(project: string, sessionId: string, relativePath: string, body = '# ok'): Promise<void> {
  // As of slice 006, the prerequisite gate resolves paths under the
  // session dir (`.peaks/_runtime/<sid>/<role>/...`). The `sessionId`
  // parameter is preserved as the body's `- change-id:` line for
  // human navigation; it is no longer a filesystem path key. Tests
  // pass `SESSION` as the sessionId so the file lives in the same
  // session dir the prereq gate scans.
  const fullPath = join(project, '.peaks', '_runtime', SESSION, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, body, 'utf8');
}

describe('request types — bugfix gates', () => {
  test('bugfix uses bug-analysis.md instead of tech-doc.md for rd:implemented', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-bug';
    await seed(project, 'rd', requestId, 'bugfix');

    // tech-doc.md exists but bug-analysis.md does not — bugfix should still fail (wrong artifact for type).
    await writeArtifact(project, requestId, 'rd/tech-doc.md');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'implemented', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught?.missing.map((m) => m.path)).toEqual(['rd/bug-analysis.md']);
  });

  test('bugfix→qa-handoff requires bug-analysis + code-review + audit-security + audit-perf + prd-handoff + unit-tests + qa-initiated (v2.12.0 Group B Tier 5)', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-bug';
    await seed(project, 'rd', requestId, 'bugfix');
    await writeArtifact(project, requestId, 'rd/bug-analysis.md', '# Bug analysis\n\n## Root cause\n\n- ...\n\n## Fix approach\n\n- ...');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    const paths = caught?.missing.map((m) => m.path) ?? [];
    expect(paths).toContain('rd/code-review.md');
    // v2.12.0 Group B Tier 5: the v2.11.x security-review slot is
    // replaced by the new AUDIT_SECURITY / AUDIT_PERF prereqs and
    // the AUDIT_REQUIRES_HANDOFF gate (prd/handoff.md).
    expect(paths).toContain('audit/security.md');
    expect(paths).toContain('audit/perf.md');
    expect(paths).toContain('prd/handoff.md');
    // v2.13.1 Group A: MUT_REPORT also required on the bugfix fan-out.
    // v2.13.2 AC-5: missing MUT_REPORT softens to a warning (1-minor
    // back-compat window). It is NOT in `missing` — it's in `warnings`.
    expect(paths).not.toContain('mut/mut-report.json');
    expect(paths).toContain('qa/test-cases/2026-05-25-bug.md');
    expect(paths).toContain('qa/.initiated');
    expect(paths).not.toContain('rd/bug-analysis.md');
    expect(paths).not.toContain('rd/security-review.md');
    expect(paths).not.toContain('rd/perf-baseline.md');
  });

  test('bugfix qa:verdict-issued requires only test-cases + test-reports (v2.11.0 D1/D4)', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-bug';
    await seed(project, 'qa', requestId, 'bugfix');
    await writeArtifact(project, requestId, 'qa/test-cases/2026-05-25-bug.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, requestId, 'qa/test-reports/2026-05-25-bug.md', '# report\n\n## Test execution\n\n- pass');
    // Note (v2.11.0 D1/D4): qa/security-findings.md and qa/performance-findings.md
    // are no longer required at qa:verdict-issued (even for bugfix).
    const result = await transitionRequestArtifact({
      role: 'qa', requestId, projectRoot: project,
      newState: 'verdict-issued', clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
    expect(result?.requestType).toBe('bugfix');
  });
});

describe('request types — docs and chore have minimal gates (PRD content only)', () => {
  test('docs rd:qa-handoff passes with zero artifacts (MINIMAL_TABLE only gates prd:handed-off)', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-doc';
    await seed(project, 'rd', requestId, 'docs');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.requestType).toBe('docs');
  });

  test('chore qa:verdict-issued passes with zero artifacts (MINIMAL_TABLE only gates prd:handed-off)', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-lint';
    await seed(project, 'qa', requestId, 'chore');
    const result = await transitionRequestArtifact({
      role: 'qa', requestId, projectRoot: project,
      newState: 'verdict-issued', clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
  });
});

describe('request types — config has minimal gates', () => {
  test('config rd:qa-handoff requires only security-review.md', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-cfg';
    await seed(project, 'rd', requestId, 'config');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught?.missing.map((m) => m.path)).toEqual(['rd/security-review.md']);
  });

  test('config qa:verdict-issued requires only test-report.md (v2.11.0 D1/D4: security findings now rd-side)', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-cfg';
    await seed(project, 'qa', requestId, 'config');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'qa', requestId, projectRoot: project,
        newState: 'verdict-issued', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    // v2.11.0 D1/D4: qa/security-findings.md is no longer required at qa:verdict-issued.
    // Security evidence lives under rd/security-review.md (peaks-rd's audit fan-out).
    expect(caught?.missing.map((m) => m.path)).toEqual(['qa/test-reports/2026-05-25-cfg.md']);
  });
});

describe('request prerequisites — numbered filename prefix (regression: prereq ignored NNN- prefix)', () => {
  test('prd:handed-off resolves the PRD artifact written with a NNN- numeric prefix', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-prefixed';
    // createRequestArtifact writes `001-<rid>.md`; the prereq table references `<rid>.md`.
    const created = await createRequestArtifact({
      role: 'prd', requestId, projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'feature', clock: () => TS
    });
    expect(created.path).toMatch(/[/\\]001-2026-05-25-prefixed\.md$/);

    // Before the fix this threw PrerequisitesNotSatisfiedError because the prereq
    // resolver looked for the unprefixed `prd/requests/2026-05-25-prefixed.md`.
    const result = await transitionRequestArtifact({
      role: 'prd', requestId, projectRoot: project,
      newState: 'handed-off', clock: () => TS
    });
    expect(result?.state).toBe('handed-off');
  });

  test('prd:handed-off still reports missing when no PRD artifact exists at all', async () => {
    const project = await makeProject();
    await seed(project, 'prd', '2026-05-25-present', 'feature');
    // Transition a DIFFERENT, non-existent request id — nothing on disk to match.
    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-25-absent', projectRoot: project,
      newState: 'handed-off', clock: () => TS
    });
    // showRequestArtifact returns null for a missing artifact → transition returns null.
    expect(result).toBeNull();
  });
});

describe('request types — artifact persistence and default', () => {
  test('artifact body records the chosen type', async () => {
    const project = await makeProject();
    const created = await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'bugfix', clock: () => TS
    });
    const body = await readFile(created.path, 'utf8');
    expect(body).toContain('- type: bugfix');
  });

  test('default type is feature when --type is omitted', async () => {
    const project = await makeProject();
    const created = await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    const body = await readFile(created.path, 'utf8');
    expect(body).toContain('- type: feature');
  });

  test('transition reads type from existing artifact body', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-doc';
    await seed(project, 'rd', requestId, 'docs');
    // Docs has no gates — should pass without any artifact files.
    const result = await transitionRequestArtifact({
      role: 'rd', requestId, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.requestType).toBe('docs');
  });
});

// v2.12.0 Group B Tier 5 — AUDIT_SECURITY / AUDIT_PERF / AUDIT_REQUIRES_HANDOFF
// gates + 1-minor-release back-compat via legacyRelativePath.
describe('v2.12.0 Tier 5 — audit prereqs + back-compat', () => {
  test('feature rd:qa-handoff reports audit/* + prd/handoff.md as missing when absent', async () => {
    const project = await makeProject();
    const requestId = '2026-06-27-feat-audit';
    await seed(project, 'rd', requestId, 'feature');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    const paths = caught?.missing.map((m) => m.path) ?? [];
    expect(paths).toContain('rd/code-review.md');
    expect(paths).toContain('audit/security.md');
    expect(paths).toContain('audit/perf.md');
    expect(paths).toContain('prd/handoff.md');
    // v2.13.1 Group A: MUT_REPORT added to FEATURE_TABLE rd:qa-handoff.
    // v2.13.2 AC-5: missing MUT_REPORT softens to a warning; NOT in `missing`.
    expect(paths).not.toContain('mut/mut-report.json');
    expect(paths).toContain('qa/test-cases/2026-06-27-feat-audit.md');
    expect(paths).toContain('qa/.initiated');
    expect(paths).not.toContain('rd/security-review.md');
    expect(paths).not.toContain('rd/perf-baseline.md');
  });

  test('feature rd:qa-handoff PASSES with audit/security.md + audit/perf.md + prd/handoff.md (new canonical paths)', async () => {
    const project = await makeProject();
    const requestId = '2026-06-27-feat-newpath';
    await seed(project, 'rd', requestId, 'feature');
    // New canonical paths (peaks-security-audit / peaks-perf-audit outputs).
    await writeArtifact(project, requestId, 'audit/security.md', '# Security audit\n\n## Verdict\n\n- pass');
    await writeArtifact(project, requestId, 'audit/perf.md', '# Perf audit\n\n## Baseline\n\n- N/A');
    // PRD handoff must exist with schemaVersion: 2 + sha256: marker (AC-2.4 / AC-3.4).
    await writeArtifact(
      project,
      requestId,
      'prd/handoff.md',
      '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n\n## Goals\n\n- ...'
    );
    // CODE_REVIEW + KARPATHY_REVIEW + UNIT_TESTS + QA_INITIATED also required.
    await writeArtifact(project, requestId, 'rd/code-review.md', '# CR\n\n## Findings\n\nCRITICAL none');
    await writeArtifact(
      project,
      requestId,
      'rd/karpathy-review.md',
      '## Karpathy-Gate\n\n### Think Before Coding\n\n- ...\n\n### Simplicity First\n\n- ...\n\n### Surgical Changes\n\n- ...\n\n### Goal-Driven Execution\n\n- ...'
    );
    await writeArtifact(project, requestId, 'qa/test-cases/2026-06-27-feat-newpath.md', '# cases\n\n## Test cases\n\ntest("x")');
    await writeArtifact(project, requestId, 'qa/.initiated', '');
    // v2.13.1 Group A: MUT_REPORT added to FEATURE_TABLE rd:qa-handoff.
    await writeArtifact(
      project,
      requestId,
      'mut/mut-report.json',
      JSON.stringify({ schemaVersion: 1, passed: true, killRate: 0.9, weakRate: 0.01, violations: [] })
    );

    const result = await transitionRequestArtifact({
      role: 'rd', requestId, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.requestType).toBe('feature');
  });

  test('feature rd:qa-handoff PASSES with legacy rd/security-review.md + rd/perf-baseline.md (1-minor-release back-compat)', async () => {
    const project = await makeProject();
    const requestId = '2026-06-27-feat-legacy';
    await seed(project, 'rd', requestId, 'feature');
    // Legacy v2.11.x paths (still on disk from older slices).
    await writeArtifact(project, requestId, 'rd/security-review.md', '# Security\n\n## Findings\n\n- none');
    await writeArtifact(project, requestId, 'rd/perf-baseline.md', '# Perf\n\n## Results\n\n- N/A');
    // PRD handoff still required (AUDIT_REQUIRES_HANDOFF).
    await writeArtifact(
      project,
      requestId,
      'prd/handoff.md',
      '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n\n## Goals\n\n- ...'
    );
    await writeArtifact(project, requestId, 'rd/code-review.md', '# CR\n\n## Findings\n\nCRITICAL none');
    await writeArtifact(
      project,
      requestId,
      'rd/karpathy-review.md',
      '## Karpathy-Gate\n\n### Think Before Coding\n\n- ...\n\n### Simplicity First\n\n- ...\n\n### Surgical Changes\n\n- ...\n\n### Goal-Driven Execution\n\n- ...'
    );
    await writeArtifact(project, requestId, 'qa/test-cases/2026-06-27-feat-legacy.md', '# cases\n\n## Test cases\n\ntest("x")');
    await writeArtifact(project, requestId, 'qa/.initiated', '');
    // v2.13.1 Group A: MUT_REPORT — applies even on the legacy path.
    await writeArtifact(
      project,
      requestId,
      'mut/mut-report.json',
      JSON.stringify({ schemaVersion: 1, passed: true, killRate: 0.9, weakRate: 0.01, violations: [] })
    );

    const result = await transitionRequestArtifact({
      role: 'rd', requestId, projectRoot: project,
      newState: 'qa-handoff', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
  });

  test('AUDIT_REQUIRES_HANDOFF blocks rd:qa-handoff when prd/handoff.md missing', async () => {
    const project = await makeProject();
    const requestId = '2026-06-27-feat-nohandoff';
    await seed(project, 'rd', requestId, 'feature');
    // Audit files exist but PRD handoff is missing — gate must fail.
    await writeArtifact(project, requestId, 'audit/security.md', '# Security audit\n\n## Verdict\n\n- pass');
    await writeArtifact(project, requestId, 'audit/perf.md', '# Perf audit\n\n## Baseline\n\n- N/A');
    await writeArtifact(project, requestId, 'rd/code-review.md', '# CR\n\n## Findings\n\nCRITICAL none');
    await writeArtifact(
      project,
      requestId,
      'rd/karpathy-review.md',
      '## Karpathy-Gate\n\n### Think Before Coding\n\n- ...\n\n### Simplicity First\n\n- ...\n\n### Surgical Changes\n\n- ...\n\n### Goal-Driven Execution\n\n- ...'
    );
    await writeArtifact(project, requestId, 'qa/test-cases/2026-06-27-feat-nohandoff.md', '# cases\n\n## Test cases\n\ntest("x")');
    await writeArtifact(project, requestId, 'qa/.initiated', '');

    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught?.missing.map((m) => m.path)).toContain('prd/handoff.md');
  });

  test('AUDIT_REQUIRES_HANDOFF rejects a legacy handoff lacking schemaVersion: 2 + sha256:', async () => {
    const project = await makeProject();
    const requestId = '2026-06-27-feat-legacyhandoff';
    await seed(project, 'rd', requestId, 'feature');
    await writeArtifact(project, requestId, 'audit/security.md', '# Security audit\n\n## Verdict\n\n- pass');
    await writeArtifact(project, requestId, 'audit/perf.md', '# Perf audit\n\n## Baseline\n\n- N/A');
    // Legacy handoff (schemaVersion: 1, no sha256 marker) — must be rejected
    // so the audit skills never read an envelope they cannot parse.
    await writeArtifact(project, requestId, 'prd/handoff.md', '# Handoff\n\nschemaVersion: 1\n');
    await writeArtifact(project, requestId, 'rd/code-review.md', '# CR\n\n## Findings\n\nCRITICAL none');
    await writeArtifact(
      project,
      requestId,
      'rd/karpathy-review.md',
      '## Karpathy-Gate\n\n### Think Before Coding\n\n- ...\n\n### Simplicity First\n\n- ...\n\n### Surgical Changes\n\n- ...\n\n### Goal-Driven Execution\n\n- ...'
    );
    await writeArtifact(project, requestId, 'qa/test-cases/2026-06-27-feat-legacyhandoff.md', '# cases\n\n## Test cases\n\ntest("x")');
    await writeArtifact(project, requestId, 'qa/.initiated', '');

    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    // The handoff gate failed (mustContain markers missing). The
    // description tells the user which markers are absent.
    expect(caught?.missing.map((m) => m.path)).toContain('prd/handoff.md');
  });

  test('config rd:qa-handoff keeps the v2.11.x security-review-only gate (no audit/PRD-handoff required)', async () => {
    // Config slices may run before the PRD handoff chain exists
    // (small CONFIG-only commits), so CONFIG_TABLE still references
    // SECURITY_REVIEW only — NOT AUDIT_REQUIRES_HANDOFF / AUDIT_SECURITY /
    // AUDIT_PERF. Pin that the config gate did not silently inherit
    // the new audit prereqs.
    const project = await makeProject();
    const requestId = '2026-06-27-cfg-audit-isolation';
    await seed(project, 'rd', requestId, 'config');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    const paths = caught?.missing.map((m) => m.path) ?? [];
    expect(paths).toEqual(['rd/security-review.md']);
  });

  test('refactor inherits the same audit + handoff gates as feature', async () => {
    // Refactor shares FEATURE_TABLE by reference; pin that the audit
    // gates flow through.
    const project = await makeProject();
    const requestId = '2026-06-27-refactor-audit';
    await seed(project, 'rd', requestId, 'refactor');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId, projectRoot: project,
        newState: 'qa-handoff', clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    const paths = caught?.missing.map((m) => m.path) ?? [];
    expect(paths).toContain('audit/security.md');
    expect(paths).toContain('audit/perf.md');
    expect(paths).toContain('prd/handoff.md');
    // v2.13.1 Group A: REFACTOR_TABLE inherits MUT_REPORT from FEATURE_TABLE.
    // v2.13.2 AC-5: missing MUT_REPORT softens to a warning; NOT in `missing`.
    expect(paths).not.toContain('mut/mut-report.json');
  });
});
