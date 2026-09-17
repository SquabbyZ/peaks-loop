// tests/unit/services/artifacts/unit-tests-marker-idiom.test.ts
//
// Guards R10 of rid `2026-09-16-codegraph-index-integrity`.
//
// The defect this file exists for: `UNIT_TESTS` (`rd:qa-handoff` FEATURE gate)
// required the literal substring `test(` in `qa/test-cases/<rid>.md`. Measured
// 2026-09-16 that marker is unsatisfiable by honest test code in THIS repo:
// `grep -rho '\bit(' tests | wc -l` = 3015 vs `grep -rho '\btest(' tests | wc -l`
// = 372, and the three test files this slice added contain `it(` 58 / `test(` 0.
// The repo's own BDD Test Style Contract
// (`skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md:170`) names BOTH
// idioms as valid. So the ONLY way an artifact passed was by *mentioning*
// `test(` in prose — which is exactly the hole `headingMustContain` was added
// to close, and which this repo's own generated `buildTestCases` template
// (`src/services/evidence/evidence-generator.ts`) exploited while saying
// "no new tests".
//
// The fix accepts EITHER idiom (`mustContainAny: ['test(', 'it(']`), keeping
// `## Test cases` as a hard `mustContain`. Hence the assertions below are
// deliberately not "the gate passes". They are:
//   - both polarities: `## Test cases` + `it(` passes AND `## Test cases` +
//     `test(` passes (neither idiom was sacrificed)
//   - the negative control on an IDENTICAL seed: `## Test cases` with NEITHER
//     idiom FAILS, and fails on that path — proving the gate was not weakened
//     into always-pass
//   - the declared shape, so a future editor cannot silently "tighten" the
//     check back to one idiom
//
// Dimensions covered:
//   - render:      the declared marker shape on the prereq
//   - behavior:    the body check's outcome per artifact body
//   - integration: a real temp `.peaks/_runtime/<sid>/` tree on disk
//   - a11y:        omitted — the resolver returns an envelope, it prints
//                  nothing and exits nothing

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  checkPrerequisites,
  getPrerequisitesFor,
  type ArtifactPrerequisite
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '../../../../src/services/artifacts/request-artifact-service.js';

declareDimensions(
  'tests/unit/services/artifacts/unit-tests-marker-idiom.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'resolver returns a result envelope; prints nothing and exits nothing' }],
);

const SESSION_ID = '2026-09-16-session-5bcf09';
const RID = '2026-09-16-codegraph-index-integrity';

const TEST_CASES_RID_PATH = 'qa/test-cases/<rid>.md';

/** The gate this prereq hangs off, read from the shipped table rather than
 *  reconstructed here — a copy would keep passing after the real table changed. */
function unitTestsPrereq(): ArtifactPrerequisite {
  const found = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
    (candidate) => candidate.relativePath === TEST_CASES_RID_PATH
  );
  if (found === undefined) {
    throw new Error(`no rd:qa-handoff prereq at ${TEST_CASES_RID_PATH}`);
  }
  return found;
}

/** `it(`-only body — the idiom this repo actually writes (3015 vs 372). */
const IT_ONLY_BODY = [
  '## Test cases',
  '',
  "it('when the index gap is empty, should render nothing', () => {});",
  "it('when a row points at a deleted file, should report it', () => {});",
  ''
].join('\n');

/** `test(`-only body — the idiom the pre-R10 check demanded, still accepted. */
const TEST_ONLY_BODY = [
  '## Test cases',
  '',
  "test('when the index gap is empty, should render nothing', () => {});",
  "test('when a row points at a deleted file, should report it', () => {});",
  ''
].join('\n');

/** NEITHER idiom, while still carrying the hard `## Test cases` heading and
 *  talking about tests in prose. This is the case the gate must keep failing:
 *  prose mention is not evidence that tests were written. */
const NEITHER_IDIOM_BODY = [
  '## Test cases',
  '',
  'All 58 new unit specs are green; no regressions were observed.',
  ''
].join('\n');

/** A body with NO `## Test cases` heading at all, but the `it(` idiom present.
 *  Keeps the heading marker honest while the idiom check is loosened. */
const NO_HEADING_BODY = ["it('when x, should y', () => {});", ''].join('\n');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-unit-tests-idiom-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID), { recursive: true });
  return root;
}

function writeArtifact(projectRoot: string, relativePath: string, body: string): string {
  const absolute = join(projectRoot, '.peaks', '_runtime', SESSION_ID, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
  return absolute;
}

/** Seed every OTHER artifact the rd:qa-handoff FEATURE gate needs, so the
 *  result can be asserted as `ok`, not merely "this path is absent from
 *  `missing`". Only the test-cases body varies between cases — every
 *  assertion below therefore isolates the marker check. */
function seedSlice(projectRoot: string, testCasesBody: string): void {
  writeArtifact(projectRoot, 'prd/handoff.md', '---\nschemaVersion: 2\nsha256: deadbeef\n---\n\n# Handoff\n');
  writeArtifact(projectRoot, `audit/security-${RID}.md`, '---\nrid: ' + RID + '\n---\n\n## Verdict\n\nwarn\n');
  writeArtifact(projectRoot, `audit/perf-${RID}.md`, `# Performance audit — ${RID}\n\n## Baseline\n\n| metric | before | after |\n|---|---|---|\n`);
  writeArtifact(projectRoot, `rd/code-review-${RID}.md`, `# Code review — ${RID}\n\n## Findings\n\nCRITICAL: none.\n`);
  writeArtifact(
    projectRoot,
    `rd/karpathy-review-${RID}.md`,
    [`# Karpathy review — ${RID}`, '', '## Karpathy-Gate', '', '## Think Before Coding', '## Simplicity First', '## Surgical Changes', '## Goal-Driven Execution', ''].join('\n')
  );
  writeArtifact(projectRoot, `qa/test-cases/${RID}.md`, testCasesBody);
  writeArtifact(projectRoot, 'qa/.initiated', '');
}

/** `checkPrerequisites` reports `missing[].path` with `<rid>` SUBSTITUTED and
 *  `join()` separators, so a literal comparison against the declared path
 *  would be vacuously true. Normalise to POSIX first. */
function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

async function runGate(projectRoot: string): Promise<{ ok: boolean; missing: string[] }> {
  const result = await checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd' as RequestArtifactRole,
    newState: 'qa-handoff',
    requestType: 'feature',
    requestId: RID
  });
  return { ok: result.ok, missing: result.missing.map((entry) => posix(entry.path)) };
}

const testCasesPath = TEST_CASES_RID_PATH.replace('<rid>', RID);

describe('(render) the declared marker shape', () => {
  it('keeps `## Test cases` as a hard marker and accepts both test idioms', () => {
    const prereq = unitTestsPrereq();
    expect(prereq.mustContain).toContain('## Test cases');
    expect(prereq.mustContainAny).toContain('test(');
    expect(prereq.mustContainAny).toContain('it(');
  });

  it('does not put either idiom back into the all-required `mustContain` list', () => {
    // The regression this pins: `mustContain: ['## Test cases', 'test(']` made
    // the gate satisfiable only by mentioning `test(` in prose, because this
    // repo writes `it(` ~8x more often than `test(`.
    const prereq = unitTestsPrereq();
    expect(prereq.mustContain).not.toContain('test(');
    expect(prereq.mustContain).not.toContain('it(');
  });
});

describe('(behavior) both idioms pass, and neither idiom fails', () => {
  it('passes on `## Test cases` + `it(` only', async () => {
    const projectRoot = makeProjectRoot();
    seedSlice(projectRoot, IT_ONLY_BODY);

    const { ok, missing } = await runGate(projectRoot);
    expect(missing).not.toContain(testCasesPath);
    expect(ok).toBe(true);
  });

  it('passes on `## Test cases` + `test(` only', async () => {
    const projectRoot = makeProjectRoot();
    seedSlice(projectRoot, TEST_ONLY_BODY);

    const { ok, missing } = await runGate(projectRoot);
    expect(missing).not.toContain(testCasesPath);
    expect(ok).toBe(true);
  });

  it('FAILS on `## Test cases` with neither idiom (the gate still bites)', async () => {
    // The negative control. Same seed as the two cases above, same
    // `## Test cases` heading, prose that says tests exist — and it must fail.
    // Without this, the two passes above would be consistent with a gate that
    // had been weakened into always-pass.
    const projectRoot = makeProjectRoot();
    seedSlice(projectRoot, NEITHER_IDIOM_BODY);

    const { ok, missing } = await runGate(projectRoot);
    expect(ok).toBe(false);
    expect(missing).toContain(testCasesPath);
  });

  it('still FAILS when the `## Test cases` heading is absent, even with `it(`', async () => {
    const projectRoot = makeProjectRoot();
    seedSlice(projectRoot, NO_HEADING_BODY);

    const { ok, missing } = await runGate(projectRoot);
    expect(ok).toBe(false);
    expect(missing).toContain(testCasesPath);
  });
});

describe('(integration) the real on-disk artifact this slice wrote', () => {
  it('accepts the `it(`-only test-cases artifact shape this repo produces', async () => {
    // The three test files slice 2026-09-16-codegraph-index-integrity added
    // contain `it(` 58 / `test(` 0. Before R10, this seed could only pass by
    // writing a prose `test(` — i.e. by lying about its own content.
    const projectRoot = makeProjectRoot();
    seedSlice(projectRoot, IT_ONLY_BODY);
    const written = writeArtifact(projectRoot, `qa/test-cases/${RID}.md`, IT_ONLY_BODY);

    const { ok } = await runGate(projectRoot);
    expect(ok).toBe(true);
    expect(written.endsWith(join('qa', 'test-cases', `${RID}.md`))).toBe(true);
  });
});
