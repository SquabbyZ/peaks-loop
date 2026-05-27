import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';
import { getAcceptanceCoverage, isAcceptanceCoverageError } from '../../src/services/scan/acceptance-coverage-service.js';

const SESSION = '2026-05-25-coverage';
const TS = '2026-05-25T08:00:00.000Z';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-coverage-'));
}

async function writePrd(project: string, rid: string, acceptanceBullets: string[]): Promise<void> {
  const result = await createRequestArtifact({
    role: 'prd', requestId: rid, projectRoot: project, sessionId: SESSION, apply: true, clock: () => TS
  });
  // Overwrite the acceptance section with deterministic bullets.
  const { readFile } = await import('node:fs/promises');
  const body = await readFile(result.path, 'utf8');
  const replaced = body.replace(
    /(## Acceptance criteria\n)[\s\S]*?(?=\n## )/,
    `$1\n${acceptanceBullets.map((bullet) => `- ${bullet}`).join('\n')}\n`
  );
  await writeFile(result.path, replaced, 'utf8');
}

async function writeTestCases(project: string, rid: string, body: string): Promise<void> {
  const dir = join(project, '.peaks', SESSION, 'qa', 'test-cases');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${rid}.md`), body, 'utf8');
}

describe('getAcceptanceCoverage', () => {
  test('returns prd-not-found when the PRD artifact is missing', async () => {
    const project = await makeProject();
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: 'missing', sessionId: SESSION });
    expect(isAcceptanceCoverageError(result)).toBe(true);
    if (isAcceptanceCoverageError(result)) {
      expect(result.kind).toBe('prd-not-found');
    }
  });

  test('returns test-cases-not-found when only PRD exists', async () => {
    const project = await makeProject();
    await writePrd(project, '2026-05-25-feat', ['User can log in with email/password', 'Account lockout after 5 failures']);
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    expect(isAcceptanceCoverageError(result)).toBe(true);
    if (isAcceptanceCoverageError(result)) {
      expect(result.kind).toBe('test-cases-not-found');
    }
  });

  test('reports full coverage when every acceptance item has a linked test case', async () => {
    const project = await makeProject();
    await writePrd(project, '2026-05-25-feat', ['User can log in', 'Lockout after 5 failures']);
    await writeTestCases(project, '2026-05-25-feat', [
      '## Test Case: Login happy path',
      '- **Category:** integration',
      '- **Acceptance:** A1',
      '',
      '## Test Case: Lockout enforced at the 6th attempt',
      '- **Category:** integration',
      '- **Acceptance:** A2',
      ''
    ].join('\n'));
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    expect(isAcceptanceCoverageError(result)).toBe(false);
    if (!isAcceptanceCoverageError(result)) {
      expect(result.ok).toBe(true);
      expect(result.uncovered).toEqual([]);
      expect(result.coverage.length).toBe(2);
      expect(result.coverage[0]?.testCases).toEqual(['Login happy path']);
    }
  });

  test('flags uncovered acceptance items', async () => {
    const project = await makeProject();
    await writePrd(project, '2026-05-25-feat', ['User can log in', 'Lockout after 5 failures', 'Password reset via email']);
    await writeTestCases(project, '2026-05-25-feat', [
      '## Test Case: Login happy path',
      '- **Acceptance:** A1',
      ''
    ].join('\n'));
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    expect(isAcceptanceCoverageError(result)).toBe(false);
    if (!isAcceptanceCoverageError(result)) {
      expect(result.ok).toBe(false);
      expect(result.uncovered.map((u) => u.id)).toEqual(['A2', 'A3']);
    }
  });

  test('flags invalid acceptance references (typos pointing at non-existent ids)', async () => {
    const project = await makeProject();
    await writePrd(project, '2026-05-25-feat', ['User can log in']);
    await writeTestCases(project, '2026-05-25-feat', [
      '## Test Case: Wrong reference',
      '- **Acceptance:** A99',
      ''
    ].join('\n'));
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isAcceptanceCoverageError(result)) {
      expect(result.invalidReferences.length).toBe(1);
      expect(result.invalidReferences[0]?.reference).toBe('A99');
      expect(result.ok).toBe(false);
    }
  });

  test('lists test cases with no Acceptance: field as unlinkedTestCases (warning only)', async () => {
    const project = await makeProject();
    await writePrd(project, '2026-05-25-feat', ['User can log in']);
    await writeTestCases(project, '2026-05-25-feat', [
      '## Test Case: Login happy path',
      '- **Acceptance:** A1',
      '',
      '## Test Case: Defense in depth — SQL injection regression',
      '- **Category:** integration',
      ''
    ].join('\n'));
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isAcceptanceCoverageError(result)) {
      expect(result.unlinkedTestCases.length).toBe(1);
      expect(result.unlinkedTestCases[0]?.title).toBe('Defense in depth — SQL injection regression');
      // Unlinked alone does not block; ok=true because all acceptance items are covered.
      expect(result.uncovered).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  test('supports comma-separated acceptance ids in a single test case', async () => {
    const project = await makeProject();
    await writePrd(project, '2026-05-25-feat', ['Item one', 'Item two']);
    await writeTestCases(project, '2026-05-25-feat', [
      '## Test Case: Combined check',
      '- **Acceptance:** A1, A2',
      ''
    ].join('\n'));
    const result = await getAcceptanceCoverage({ projectRoot: project, requestId: '2026-05-25-feat', sessionId: SESSION });
    if (!isAcceptanceCoverageError(result)) {
      expect(result.ok).toBe(true);
      expect(result.coverage[0]?.testCases).toEqual(['Combined check']);
      expect(result.coverage[1]?.testCases).toEqual(['Combined check']);
    }
  });
});
