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

async function writeArtifact(project: string, relativePath: string, body = '# ok'): Promise<void> {
  const fullPath = join(project, '.peaks', SESSION, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, body, 'utf8');
}

describe('request types — bugfix gates', () => {
  test('bugfix uses bug-analysis.md instead of tech-doc.md for rd:implemented', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-25-bug', 'bugfix');

    // tech-doc.md exists but bug-analysis.md does not — bugfix should still fail (wrong artifact for type).
    await writeArtifact(project, 'rd/tech-doc.md');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
        newState: 'implemented', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught?.missing.map((m) => m.path)).toEqual(['rd/bug-analysis.md']);
  });

  test('bugfix→qa-handoff requires bug-analysis + code-review + security-review + unit-tests + qa-initiated', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-25-bug', 'bugfix');
    await writeArtifact(project, 'rd/bug-analysis.md', '# Bug analysis\n\n## Root cause\n\n- ...\n\n## Fix approach\n\n- ...');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
        newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    const paths = caught?.missing.map((m) => m.path) ?? [];
    expect(paths).toContain('rd/code-review.md');
    expect(paths).toContain('rd/security-review.md');
    expect(paths).toContain('qa/test-cases/2026-05-25-bug.md');
    expect(paths).toContain('qa/.initiated');
    expect(paths).not.toContain('rd/bug-analysis.md');
  });

  test('bugfix qa:verdict-issued does NOT require performance-findings.md', async () => {
    const project = await makeProject();
    await seed(project, 'qa', '2026-05-25-bug', 'bugfix');
    await writeArtifact(project, 'qa/test-cases/2026-05-25-bug.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, 'qa/test-reports/2026-05-25-bug.md', '# report\n\n## Test execution\n\n- pass');
    await writeArtifact(project, 'qa/security-findings.md', '# security\n\n## Findings\n\n- none');
    // performance-findings.md intentionally absent
    const result = await transitionRequestArtifact({
      role: 'qa', requestId: '2026-05-25-bug', projectRoot: project,
      newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
    expect(result?.requestType).toBe('bugfix');
  });
});

describe('request types — docs and chore have minimal gates (PRD content only)', () => {
  test('docs rd:qa-handoff passes with zero artifacts (MINIMAL_TABLE only gates prd:handed-off)', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-25-doc', 'docs');
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-doc', projectRoot: project,
      newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.requestType).toBe('docs');
  });

  test('chore qa:verdict-issued passes with zero artifacts (MINIMAL_TABLE only gates prd:handed-off)', async () => {
    const project = await makeProject();
    await seed(project, 'qa', '2026-05-25-lint', 'chore');
    const result = await transitionRequestArtifact({
      role: 'qa', requestId: '2026-05-25-lint', projectRoot: project,
      newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
    });
    expect(result?.state).toBe('verdict-issued');
  });
});

describe('request types — config has minimal gates', () => {
  test('config rd:qa-handoff requires only security-review.md', async () => {
    const project = await makeProject();
    await seed(project, 'rd', '2026-05-25-cfg', 'config');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-cfg', projectRoot: project,
        newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught?.missing.map((m) => m.path)).toEqual(['rd/security-review.md']);
  });

  test('config qa:verdict-issued requires only security-findings.md', async () => {
    const project = await makeProject();
    await seed(project, 'qa', '2026-05-25-cfg', 'config');
    let caught: PrerequisitesNotSatisfiedError | null = null;
    try {
      await transitionRequestArtifact({
        role: 'qa', requestId: '2026-05-25-cfg', projectRoot: project,
        newState: 'verdict-issued', sessionId: SESSION, clock: () => TS
      });
    } catch (error) {
      if (error instanceof PrerequisitesNotSatisfiedError) caught = error;
    }
    expect(caught?.missing.map((m) => m.path)).toEqual(['qa/security-findings.md']);
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
    await seed(project, 'rd', '2026-05-25-doc', 'docs');
    // Docs has no gates — should pass without any artifact files.
    const result = await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-doc', projectRoot: project,
      newState: 'qa-handoff', sessionId: SESSION, clock: () => TS
    });
    expect(result?.requestType).toBe('docs');
  });
});
