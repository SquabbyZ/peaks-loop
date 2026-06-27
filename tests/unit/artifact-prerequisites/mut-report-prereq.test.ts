/**
 * v2.13.1 Group A — MUT_REPORT prerequisite tests.
 *
 * Pins AC-1 of the v2.13.1 verdict-aggregator PRD: feat / bugfix / refactor
 * slices must carry a `mut/mut-report.json` with `"passed": true` before
 * `peaks request transition --state qa-handoff` is allowed. The four
 * cases below cover the full ON / OFF matrix:
 *
 *   1. file missing       → PREREQUISITES_MISSING
 *   2. file present, passed:false → PREREQUISITES_MISSING
 *   3. file present, passed:true  → transition passes
 *   4. config / docs / chore slices → not required (legacy exemption)
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../../src/services/mode/mode-enforcement.js', () => ({
  requireUserConfirmation: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../../src/services/artifacts/artifact-lint-service.js', () => ({
  lintRequestArtifact: vi.fn().mockResolvedValue(null)
}));

import {
  createRequestArtifact,
  transitionRequestArtifact,
  PrerequisitesNotSatisfiedError
} from '../../../src/services/artifacts/request-artifact-service.js';

const SESSION = '2026-06-27-mut-prereq';
const TS = '2026-06-27T00:00:00.000Z';
const REQUEST_ID = '2026-06-27-feat-mut';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-mut-prereq-'));
}

async function seedRd(project: string, requestId: string, type: 'feature' | 'bugfix' | 'refactor' | 'docs' | 'config' | 'chore' = 'feature'): Promise<void> {
  await createRequestArtifact({
    role: 'rd',
    requestId,
    projectRoot: project,
    sessionId: SESSION,
    requestType: type,
    apply: true,
    clock: () => TS
  });
}

async function writeArtifact(
  project: string,
  relativePath: string,
  body: string
): Promise<void> {
  const fullPath = join(project, '.peaks', '_runtime', SESSION, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, body, 'utf8');
}

/**
 * Seed the full happy-path evidence suite (minus mut-report). Each test
 * adds or omits the mut-report as the case requires. The other gates
 * already pin v2.12.0 Tier 5 behavior; we mirror them here.
 */
async function seedHappyPathExceptMut(project: string, requestId: string): Promise<void> {
  await writeArtifact(
    project,
    'rd/code-review.md',
    '# CR\n\n## Findings\n\n- none\n\nCRITICAL: 0'
  );
  await writeArtifact(
    project,
    'audit/security.md',
    '# Security audit\n\n## Verdict\n\n- pass'
  );
  await writeArtifact(
    project,
    'rd/karpathy-review.md',
    '# Karpathy review\n\n## Karpathy-Gate\n\n### Think Before Coding\n\n- done\n\n### Simplicity First\n\n- done\n\n### Surgical Changes\n\n- done\n\n### Goal-Driven Execution\n\n- done\n'
  );
  await writeArtifact(
    project,
    'audit/perf.md',
    '# Perf audit\n\n## Baseline\n\n| metric | baseline | target |\n|---|---|---|\n| render-time | 120ms | <200ms |\n'
  );
  await writeArtifact(
    project,
    'prd/handoff.md',
    '# Handoff\n\nschemaVersion: 2\nsha256: a1b2c3\n'
  );
  await writeArtifact(
    project,
    `qa/test-cases/${requestId}.md`,
    '# cases\n\n## Test cases\n\ntest("example")'
  );
  await writeArtifact(project, 'qa/.initiated', '');
}

describe('v2.13.1 MUT_REPORT prerequisite (rd-side CLI hard gate)', () => {
  test('rd→qa-handoff is BLOCKED when mut/mut-report.json is missing (feat)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID, 'feature');
    await seedHappyPathExceptMut(project, REQUEST_ID);
    // Deliberately omit mut/mut-report.json.

    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd',
        requestId: REQUEST_ID,
        projectRoot: project,
        newState: 'qa-handoff',
        clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('mut/mut-report.json');
  });

  test('rd→qa-handoff is BLOCKED when mut/mut-report.json exists but "passed": false (low kill rate)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID, 'feature');
    await seedHappyPathExceptMut(project, REQUEST_ID);
    // Mutation report with passed:false — peaks-mut detected insufficient
    // kill rate or excessive weak assertions. The gate must reject.
    await writeArtifact(
      project,
      'mut/mut-report.json',
      JSON.stringify({
        schemaVersion: 1,
        passed: false,
        killRate: 0.62,
        weakRate: 0.04,
        violations: [
          { kind: 'mutationKillRateMin', actual: 0.62, threshold: 0.80 }
        ]
      })
    );

    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd',
        requestId: REQUEST_ID,
        projectRoot: project,
        newState: 'qa-handoff',
        clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingEntries = caught?.missing ?? [];
    const mutEntry = missingEntries.find((e) => e.path === 'mut/mut-report.json');
    expect(mutEntry).toBeDefined();
    // The description should mention the missing markers so the operator
    // sees why the gate rejected.
    expect(mutEntry?.description.toLowerCase()).toContain('passed');
  });

  test('rd→qa-handoff PASSES when mut/mut-report.json exists with "passed": true (feat)', async () => {
    const project = await makeProject();
    await seedRd(project, REQUEST_ID, 'feature');
    await seedHappyPathExceptMut(project, REQUEST_ID);
    await writeArtifact(
      project,
      'mut/mut-report.json',
      JSON.stringify({
        schemaVersion: 1,
        passed: true,
        killRate: 0.87,
        weakRate: 0.02,
        violations: []
      })
    );

    const result = await transitionRequestArtifact({
      role: 'rd',
      requestId: REQUEST_ID,
      projectRoot: project,
      newState: 'qa-handoff',
      clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });

  test('rd→qa-handoff for config / docs / chore does NOT require mut-report (legacy exemption)', async () => {
    // The PRD's preserved-behavior clause keeps CONFIG / DOCS / CHORE
    // exempt — those types have no acceptance surface that mutation
    // testing can meaningfully cover. We seed a config slice through
    // rd:qa-handoff with no mut-report present and assert it succeeds.
    const project = await makeProject();
    await seedRd(project, REQUEST_ID, 'config');
    // CONFIG_TABLE only requires security-review; no audit/perf,
    // karpathy, unit-tests, or mut-report needed.

    await writeArtifact(
      project,
      'rd/security-review.md',
      '# SR\n\n## Findings\n\n- none'
    );

    const result = await transitionRequestArtifact({
      role: 'rd',
      requestId: REQUEST_ID,
      projectRoot: project,
      newState: 'qa-handoff',
      clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
  });
});