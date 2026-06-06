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

async function writeArtifact(project: string, changeId: string, relativePath: string, body = '# ok'): Promise<void> {
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

  test('bugfix→qa-handoff requires bug-analysis + code-review + security-review + unit-tests + qa-initiated', async () => {
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
    expect(paths).toContain('rd/security-review.md');
    expect(paths).toContain('qa/test-cases/2026-05-25-bug.md');
    expect(paths).toContain('qa/.initiated');
    expect(paths).not.toContain('rd/bug-analysis.md');
  });

  test('bugfix qa:verdict-issued does NOT require performance-findings.md', async () => {
    const project = await makeProject();
    const requestId = '2026-05-25-bug';
    await seed(project, 'qa', requestId, 'bugfix');
    await writeArtifact(project, requestId, 'qa/test-cases/2026-05-25-bug.md', '# cases\n\n## Test cases\n\ntest("example")');
    await writeArtifact(project, requestId, 'qa/test-reports/2026-05-25-bug.md', '# report\n\n## Test execution\n\n- pass');
    await writeArtifact(project, requestId, 'qa/security-findings.md', '# security\n\n## Findings\n\n- none');
    // performance-findings.md intentionally absent
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

  test('config qa:verdict-issued requires only security-findings.md', async () => {
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
    expect(caught?.missing.map((m) => m.path)).toEqual(['qa/security-findings.md']);
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
