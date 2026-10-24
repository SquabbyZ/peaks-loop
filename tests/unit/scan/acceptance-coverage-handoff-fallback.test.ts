// tests/unit/scan/acceptance-coverage-handoff-fallback.test.ts
//
// The acceptance-coverage lookup resolves TWO PRD paths: the role carrier at
// `prd/requests/<rid>.md` and the handoff capsule at `prd/handoff-<rid>.md`.
// The pipeline produces the CAPSULE, so a session that ran no peaks-prd role
// had no `prd/requests/` file at all — and the check reported PRD_NOT_FOUND
// for a PRD that was sitting in the session the whole time.
//
// Dimensions covered:
//   - behavior:   which source is resolved, and the coverage it yields
//   - integration: a real `.peaks/_runtime/<sid>/` tree on disk
//   - render:     the report shape the CLI prints
//   - a11y:       the not-found message a human reads

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  getAcceptanceCoverage,
  isAcceptanceCoverageError,
  type AcceptanceCoverageReport
} from '../../../src/services/scan/acceptance-coverage-service.js';

declareDimensions('tests/unit/scan/acceptance-coverage-handoff-fallback.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-24-session-9c1f02';
const DECLARED_SESSION_ID = '2026-10-24-session-9c1f03';
const RID = 'rid-t3-acceptance-coverage-handoff-fallback';

const PRD_BODY = [
  `- session: ${SESSION_ID}`,
  '- type: bugfix',
  '',
  '# PRD',
  '',
  '## Goals',
  '',
  '- ship the fallback',
  '',
  '## Acceptance criteria',
  '',
  '- first criterion',
  '- second criterion',
  ''
].join('\n');

/** The capsule shape whose criteria are a BULLET list under the section. */
const CAPSULE_BODY = [
  '---',
  `requestId: "${RID}"`,
  `sessionId: "${SESSION_ID}"`,
  'schemaVersion: 2',
  `sha256: ${'a'.repeat(64)}`,
  '---',
  '',
  '# PRD handoff',
  '',
  '## Goals',
  '',
  '- ship the fallback',
  '',
  '## Acceptance criteria',
  '',
  '- first criterion',
  '- second criterion',
  ''
].join('\n');

/** The capsule shape whose criteria are a TABLE, with the list in the frontmatter. */
const CAPSULE_TABLE_BODY = [
  '---',
  `requestId: "${RID}"`,
  `sessionId: "${SESSION_ID}"`,
  'schemaVersion: 2',
  `sha256: ${'b'.repeat(64)}`,
  'acceptanceCriteria:',
  '  - "first criterion"',
  '  - "second criterion"',
  '---',
  '',
  '# PRD handoff',
  '',
  '## Acceptance criteria',
  '',
  '| # | Criterion | Measured result |',
  '|---|---|---|',
  '| 1 | first criterion | PASS |',
  '| 2 | second criterion | PASS |',
  ''
].join('\n');

/** The capsule shape whose body DISAGREES with its own declaration: the body
 *  shows one bullet, the frontmatter declares two other criteria. */
const CAPSULE_DRIFT_BODY = [
  '---',
  `requestId: "${RID}"`,
  `sessionId: "${SESSION_ID}"`,
  'schemaVersion: 2',
  `sha256: ${'c'.repeat(64)}`,
  'acceptanceCriteria:',
  '  - "declared alpha"',
  '  - "declared beta"',
  '---',
  '',
  '# PRD handoff',
  '',
  '## Acceptance criteria',
  '',
  '- prose alpha',
  ''
].join('\n');

/** The capsule shape whose body is a TABLE showing more criteria than it
 *  declares — the shape the pipeline itself writes. */
const CAPSULE_TABLE_DRIFT_BODY = [
  '---',
  `requestId: "${RID}"`,
  `sessionId: "${SESSION_ID}"`,
  'schemaVersion: 2',
  `sha256: ${'d'.repeat(64)}`,
  'acceptanceCriteria:',
  '  - "first criterion"',
  '---',
  '',
  '# PRD handoff',
  '',
  '## Acceptance criteria',
  '',
  '| # | Criterion | Measured result |',
  '|---|---|---|',
  '| 1 | first criterion | PASS |',
  '| 2 | second criterion | PASS |',
  '| 3 | third criterion | PASS |',
  ''
].join('\n');

/** Links A1 only, so the uncovered list is exactly the second criterion. */
const TEST_CASES_BODY = [
  '## Test cases',
  '',
  '## Test Case: covers the first criterion',
  '- **Acceptance:** A1',
  ''
].join('\n');

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
  const root = mkdtempSync(join(tmpdir(), 'peaks-acceptance-fallback-'));
  tempRoots.push(root);
  return root;
}

function writeArtifact(
  projectRoot: string,
  sessionId: string,
  relativePath: string,
  body: string
): string {
  const absolute = join(projectRoot, '.peaks', '_runtime', sessionId, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
  return absolute;
}

/** The role carrier at the MAIN path. */
function seedRoleCarrier(projectRoot: string, body = PRD_BODY): string {
  return writeArtifact(projectRoot, SESSION_ID, join('prd', 'requests', `${RID}.md`), body);
}

/** The handoff capsule at the FALLBACK path. */
function seedCapsule(projectRoot: string, body = CAPSULE_BODY, sessionId = SESSION_ID): string {
  return writeArtifact(projectRoot, sessionId, join('prd', `handoff-${RID}.md`), body);
}

function seedTestCases(projectRoot: string, sessionId = SESSION_ID): string {
  return writeArtifact(
    projectRoot,
    sessionId,
    join('qa', 'test-cases', `${RID}.md`),
    TEST_CASES_BODY
  );
}

function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

describe('Scenario: behavior — which source is resolved', () => {
  it('when the role carrier exists, should read the criteria from it', async () => {
    // given: a session holding the role carrier and the test cases
    // when: the coverage is computed
    // then: the report names the role carrier and carries its two criteria
    const projectRoot = makeProjectRoot();
    const carrierPath = seedRoleCarrier(projectRoot);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    expect(isAcceptanceCoverageError(result)).toBe(false);
    const report = result as AcceptanceCoverageReport;
    expect(posix(report.prdPath)).toBe(posix(carrierPath));
    expect(report.acceptanceItems.map((item) => item.id)).toEqual(['A1', 'A2']);
    expect(report.acceptanceItems.map((item) => item.text)).toEqual([
      'first criterion',
      'second criterion'
    ]);
  });

  it('when both paths exist, should prefer the role carrier', async () => {
    // given: a session holding BOTH the role carrier and the handoff capsule
    // when: the coverage is computed
    // then: the MAIN path wins
    const projectRoot = makeProjectRoot();
    const carrierPath = seedRoleCarrier(projectRoot);
    seedCapsule(projectRoot);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(posix(report.prdPath)).toBe(posix(carrierPath));
  });

  it('when only the handoff capsule exists, should read the criteria from the capsule', async () => {
    // given: a session holding ONLY the handoff capsule and the test cases
    // when: the coverage is computed
    // then: the lookup succeeds against the capsule, and the uncovered list is right
    const projectRoot = makeProjectRoot();
    const capsulePath = seedCapsule(projectRoot);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    expect(isAcceptanceCoverageError(result)).toBe(false);
    const report = result as AcceptanceCoverageReport;
    expect(posix(report.prdPath)).toBe(posix(capsulePath));
    expect(report.acceptanceItems.map((item) => item.text)).toEqual([
      'first criterion',
      'second criterion'
    ]);
    expect(report.uncovered.map((item) => item.id)).toEqual(['A2']);
    expect(report.coverage.find((entry) => entry.acceptanceId === 'A1')?.testCases).toEqual([
      'covers the first criterion'
    ]);
    expect(report.ok).toBe(false);
  });

  it('when the capsule renders its criteria as a table, should read its criteria list', async () => {
    // given: a capsule whose criteria section is a TABLE
    // when: the coverage is computed
    // then: the same two criteria come out of the frontmatter list
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot, CAPSULE_TABLE_BODY);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(report.acceptanceItems.map((item) => item.text)).toEqual([
      'first criterion',
      'second criterion'
    ]);
    expect(report.uncovered.map((item) => item.id)).toEqual(['A2']);
  });

  it('when neither path exists, should report the prd-not-found error', async () => {
    // given: a session holding neither the role carrier nor the capsule
    // when: the coverage is computed
    // then: the lookup failure is reported, not a coverage report
    const projectRoot = makeProjectRoot();
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    expect(isAcceptanceCoverageError(result)).toBe(true);
    expect((result as { kind: string }).kind).toBe('prd-not-found');
  });
});

describe('Scenario: integration — the real runtime tree', () => {
  it('when the capsule declares another session, should read the test cases from it', async () => {
    // given: a capsule in one session declaring a different one, whose test cases live there
    // when: the coverage is computed
    // then: the test cases are read from the DECLARED session
    const projectRoot = makeProjectRoot();
    const declaring = CAPSULE_BODY.replace(SESSION_ID, DECLARED_SESSION_ID);
    seedCapsule(projectRoot, declaring);
    const testCasesPath = seedTestCases(projectRoot, DECLARED_SESSION_ID);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(posix(report.testCasesPath)).toBe(posix(testCasesPath));
    expect(report.testCases.map((testCase) => testCase.title)).toEqual([
      'covers the first criterion'
    ]);
  });

  it('when no session is pinned, should find the capsule in a session dir', async () => {
    // given: a session dir holding the capsule and its test cases, and no --session-id
    // when: the coverage is computed without a session id
    // then: the capsule is still resolved
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(posix(report.prdPath)).toContain(`prd/handoff-${RID}.md`);
    expect(report.acceptanceItems).toHaveLength(2);
  });
});

describe('Scenario: render — the report shape', () => {
  it('when the fallback resolves, should carry the full coverage shape', async () => {
    // given: a session holding only the capsule and the test cases
    // when: the coverage is computed
    // then: every field the CLI prints is present
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(Object.keys(report).sort()).toEqual([
      'acceptanceItems',
      'coverage',
      'invalidReferences',
      'ok',
      'prdPath',
      'testCases',
      'testCasesPath',
      'uncovered',
      'unlinkedTestCases'
    ]);
    expect(report.invalidReferences).toEqual([]);
    expect(report.unlinkedTestCases).toEqual([]);
  });
});

describe('Scenario: behavior — which source a criterion came from', () => {
  it('when the body disagrees with the declaration, should track every declared criterion', async () => {
    // given: a capsule whose body bullet disagrees with its two declared criteria
    // when: the coverage is computed
    // then: BOTH declared criteria are tracked, and the one without a test case is uncovered
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot, CAPSULE_DRIFT_BODY);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(report.acceptanceItems.map((item) => item.text)).toEqual([
      'declared alpha',
      'declared beta',
      'prose alpha'
    ]);
    expect(report.uncovered.map((item) => item.text)).toEqual(['declared beta', 'prose alpha']);
    expect(report.ok).toBe(false);
  });

  it('when the body is a table, should union its rows with the declared criteria', async () => {
    // given: a capsule whose body is a three-row table and declares one criterion
    // when: the coverage is computed
    // then: the declared criterion is tracked, and so are the table rows it does not declare
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot, CAPSULE_TABLE_DRIFT_BODY);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(report.acceptanceItems.map((item) => item.text)).toEqual([
      'first criterion',
      'second criterion',
      'third criterion'
    ]);
    expect(report.acceptanceItems[0]?.source).toBe('both');
    expect(report.uncovered.map((item) => item.id)).toEqual(['A2', 'A3']);
    expect(report.ok).toBe(false);
  });

  it('when the same criterion is declared and shown, should count it once', async () => {
    // given: a capsule that declares two criteria its own table also shows
    // when: the coverage is computed
    // then: each criterion appears once, marked as coming from both sources
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot, CAPSULE_TABLE_BODY);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(report.acceptanceItems).toHaveLength(2);
    expect(report.acceptanceItems.map((item) => item.source)).toEqual(['both', 'both']);
  });

  it('when a criterion is only declared, should mark it as declared', async () => {
    // given: a capsule whose declaration names criteria its body does not show
    // when: the coverage is computed
    // then: each item says whether it came from the declaration or the section
    const projectRoot = makeProjectRoot();
    seedCapsule(projectRoot, CAPSULE_DRIFT_BODY);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(report.acceptanceItems.map((item) => item.source)).toEqual([
      'declared',
      'declared',
      'section'
    ]);
  });

  it('when the role carrier is read, should mark its criteria as section criteria', async () => {
    // given: a session holding the role carrier and the test cases
    // when: the coverage is computed
    // then: the carrier's criteria are marked as section criteria
    const projectRoot = makeProjectRoot();
    seedRoleCarrier(projectRoot);
    seedTestCases(projectRoot);
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const report = result as AcceptanceCoverageReport;
    expect(report.acceptanceItems.map((item) => item.source)).toEqual(['section', 'section']);
  });
});

describe('Scenario: a11y — the not-found message', () => {
  it('when neither path exists, should name both paths in the message', async () => {
    // given: a session holding neither path
    // when: the coverage is computed
    // then: the message points at BOTH places a PRD can live
    const projectRoot = makeProjectRoot();
    const result = await getAcceptanceCoverage({ projectRoot, requestId: RID });

    const message = (result as { message: string }).message;
    expect(message).toContain('prd/requests/');
    expect(message).toContain('prd/handoff-');
    expect(message).toContain(RID);
  });
});
