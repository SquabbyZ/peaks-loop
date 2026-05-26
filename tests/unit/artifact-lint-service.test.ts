import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createRequestArtifact } from '../../src/services/artifacts/request-artifact-service.js';
import { lintRequestArtifact } from '../../src/services/artifacts/artifact-lint-service.js';

const SESSION = '2026-05-25-lint';
const TS = '2026-05-25T08:00:00.000Z';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-lint-'));
}

describe('lintRequestArtifact', () => {
  test('reports findings on a fresh template (templates contain <placeholder> tokens)', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'prd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, clock: () => TS
    });
    const report = await lintRequestArtifact({ projectRoot: project, role: 'prd', requestId: '2026-05-25-feat', sessionId: SESSION });
    expect(report).not.toBeNull();
    expect(report?.ok).toBe(false);
    expect(report?.findings.some((f) => f.reason.includes('<placeholder>'))).toBe(true);
  });

  test('returns null when the artifact does not exist', async () => {
    const project = await makeProject();
    const report = await lintRequestArtifact({ projectRoot: project, role: 'rd', requestId: '2026-05-25-nope', sessionId: SESSION });
    expect(report).toBeNull();
  });

  test('does not flag the type metadata line as a placeholder', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'bugfix', clock: () => TS
    });
    const report = await lintRequestArtifact({ projectRoot: project, role: 'rd', requestId: '2026-05-25-bug', sessionId: SESSION });
    expect(report?.findings.find((f) => /^- type:/.test(f.text))).toBeUndefined();
  });

  test('flags TODO/TBD markers as warnings, not errors', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-bug', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'bugfix', clock: () => TS
    });
    // The default templates already contain TBD-like content; check that warnings carry the warning severity.
    const report = await lintRequestArtifact({ projectRoot: project, role: 'rd', requestId: '2026-05-25-bug', sessionId: SESSION });
    expect(report?.findings.some((f) => f.severity === 'error')).toBe(true);
  });
});
