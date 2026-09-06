// tests/unit/services/artifacts/request-artifact-slug-case.test.ts
//
// rid=2026-09-06-cli-drift — Bug 1: request-id case-sensitivity.
//
// `buildNumberedFilename` lowercases the description into a kebab slug, so
// `peaks request init --id 2026-09-06-split-batchA` writes
// `001-2026-09-06-split-batcha.md` (lowercase). The lookup in
// `request-artifact-service.ts` previously did a CASE-SENSITIVE
// `file.endsWith(\`-${requestId}.md\`)`, so `peaks request show/transition`
// with the original mixed-case id could not find the file.
//
// These cases pin the fix: the lookup computes the SAME slug the writer
// produced, so a mixed-case request id resolves to its lowercased-slug file.
//
// Dimensions covered:
//   - integration: real on-disk create + show round-trip in a tmp workspace
//   - behavior:    the on-disk filename is the lowercased slug; show resolves
//                  the mixed-case id to that file
//   - render:      OMITTED — no formatted output surface in the service
//   - a11y:        OMITTED — no human-facing text in the service round-trip

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import {
  createRequestArtifact,
  showRequestArtifact,
} from '../../../../src/services/artifacts/request-artifact-service.js';

declareDimensions(
  'tests/unit/services/artifacts/request-artifact-slug-case.test.ts',
  ['integration', 'behavior'],
  [
    { dim: 'render', reason: 'no formatted output surface in the service round-trip' },
    { dim: 'a11y', reason: 'no human-facing text in the service round-trip' },
  ],
);

const MIXED_CASE_REQUEST_ID = '2026-09-06-split-batchA';
const SESSION_ID = 'test-session';

describe('Scenario: integration — mixed-case request id resolves to its lowercased-slug file', () => {
  const ws = withTmpWorkspacePerTest('peaks-rid-case-');

  it('when init writes a mixed-case id, should store the lowercased kebab slug on disk', async () => {
    const result = await createRequestArtifact({
      role: 'rd',
      requestId: MIXED_CASE_REQUEST_ID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true,
    });

    expect(result.path).toBe(
      join(ws().path, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', '001-2026-09-06-split-batcha.md'),
    );
  });

  it('when show is invoked with the original mixed-case id, should resolve the lowercased-slug file', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: MIXED_CASE_REQUEST_ID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true,
    });

    const shown = await showRequestArtifact({
      projectRoot: ws().path,
      role: 'rd',
      requestId: MIXED_CASE_REQUEST_ID,
      sessionId: SESSION_ID,
    });

    expect(shown).not.toBeNull();
    // readSummary derives requestId from the on-disk (lowercased) filename.
    expect(shown?.requestId).toBe('2026-09-06-split-batcha');
    expect(shown?.path).toBe(
      join(ws().path, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', '001-2026-09-06-split-batcha.md'),
    );
  });
});

describe('Scenario: behavior — duplicate detection is slug-aware', () => {
  const ws = withTmpWorkspacePerTest('peaks-rid-dup-');

  it('when init re-runs with the same mixed-case id, should reject as already existing', async () => {
    await createRequestArtifact({
      role: 'rd',
      requestId: MIXED_CASE_REQUEST_ID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true,
    });

    await expect(
      createRequestArtifact({
        role: 'rd',
        requestId: MIXED_CASE_REQUEST_ID,
        projectRoot: ws().path,
        sessionId: SESSION_ID,
        apply: true,
      }),
    ).rejects.toThrow(/already exists/);
  });
});
