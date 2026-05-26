import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createRequestArtifact,
  transitionRequestArtifact,
  PrerequisitesNotSatisfiedError
} from '../../src/services/artifacts/request-artifact-service.js';

const SESSION = '2026-05-25-gated';
const TS = '2026-05-25T08:00:00.000Z';

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

async function writeArtifact(project: string, relativePath: string, body: string): Promise<void> {
  const fullPath = join(project, '.peaks', SESSION, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, body, 'utf8');
}

describe('transitionRequestArtifact — prerequisite enforcement', () => {
  test('rd→implemented is blocked without tech-doc.md', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await expect(
      transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'implemented', sessionId: SESSION, clock: () => TS
      })
    ).rejects.toBeInstanceOf(PrerequisitesNotSatisfiedError);
  });

  test('rd→implemented passes when tech-doc.md exists', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# tech doc');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'implemented', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('implemented');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });

  test('rd→qa-handoff is blocked when code-review.md or security-review.md is missing', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-feat');
    await writeArtifact(project, 'rd/tech-doc.md', '# tech doc');
    // code-review.md and security-review.md intentionally missing
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('rd/code-review.md');
    expect(missingPaths).toContain('rd/security-review.md');
    expect(missingPaths).not.toContain('rd/tech-doc.md');
  });

  test('qa→verdict-issued is blocked without security-findings.md and performance-findings.md', async () => {
    const project = await makeProject();
    await seedQa(project, '2026-05-25-feat');
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases');
    await writeArtifact(project, 'qa/test-reports/2026-05-25-feat.md', '# report');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'qa', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught).not.toBeNull();
    const missingPaths = (caught?.missing ?? []).map((entry) => entry.path);
    expect(missingPaths).toContain('qa/security-findings.md');
    expect(missingPaths).toContain('qa/performance-findings.md');
  });

  test('qa→verdict-issued passes when every gated file exists', async () => {
    const project = await makeProject();
    await seedQa(project, '2026-05-25-feat');
    await writeArtifact(project, 'qa/test-cases/2026-05-25-feat.md', '# cases');
    await writeArtifact(project, 'qa/test-reports/2026-05-25-feat.md', '# report');
    await writeArtifact(project, 'qa/security-findings.md', '# security');
    await writeArtifact(project, 'qa/performance-findings.md', '# perf');
    const result = await transitionRequestArtifact({
      role: 'qa', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
  });

  test('allowIncomplete=true bypasses the check and records the bypass in the artifact body', async () => {
    const project = await makeProject();
    await seedRd(project, '2026-05-25-doc-only');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-doc-only', projectRoot: project,
      newState: 'qa-handoff', sessionId: SESSION, allowIncomplete: true,
      reason: 'docs-only change, no implementation', clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.bypassedPrerequisites?.ok).toBe(false);
    expect(result?.bypassedPrerequisites?.missing.length).toBeGreaterThan(0);
    const body = await readFile(result?.path ?? '', 'utf8');
    expect(body).toContain('docs-only change');
    expect(body).toContain('bypassed prerequisites');
    expect(body).toContain('rd/tech-doc.md');
  });

  test('transitions with no prerequisites stay unaffected (prd→confirmed-by-user)', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    const result = await transitionRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'confirmed-by-user', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('confirmed-by-user');
    expect(result?.bypassedPrerequisites).toBeUndefined();
  });
});
