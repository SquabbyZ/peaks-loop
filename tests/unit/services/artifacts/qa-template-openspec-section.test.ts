// tests/unit/services/artifacts/qa-template-openspec-section.test.ts
//
// rid=rid-qa-template-openspec — backlog §11.2.
//
// `peaks request init --role qa` emitted an OpenSpec exit gate carrying two
// `<id>` placeholders. In a repository with no `openspec/changes/` the section
// cannot be filled, so the PRISTINE template failed `request lint` and the
// `qa:running` transition refused with LINT_GATE_FAILED — the producer handed
// QA an unfillable section and then blocked QA for not filling it.
//
// The renderer now swaps that section for an explicit N/A when the directory
// is absent, and keeps the prompt form when it exists. The lint rule and the
// transition are unchanged.
//
// Dimensions covered:
//   - behavior:    the conditional section (N/A vs prompt form)
//   - integration: a real on-disk init -> lint -> qa:running round-trip
//   - render:      OMITTED — the assertion reads the rendered body's lines
//   - a11y:        OMITTED — machine-only markdown, no human-facing surface

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { lintRequestArtifact } from '../../../../src/services/artifacts/artifact-lint-service.js';
import {
  createRequestArtifact,
  transitionRequestArtifact
} from '../../../../src/services/artifacts/request-artifact-service.js';

declareDimensions(
  'tests/unit/services/artifacts/qa-template-openspec-section.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the assertions read the rendered body lines, no formatted output' },
    { dim: 'a11y', reason: 'machine-only markdown with no human-facing text or exit code' }
  ]
);

const SESSION_ID = 'test-session';
const NA_LINE = '- N/A — openspec/changes/ is absent; no validate run';

describe('Scenario: a repository without openspec/changes/ gets an explicit N/A', () => {
  const ws = withTmpWorkspacePerTest('peaks-qa-openspec-absent-');

  it('when init renders the QA template, should emit the N/A line and no <id> token', async () => {
    const created = await createRequestArtifact({
      role: 'qa',
      requestId: '2026-10-19-qa-openspec-absent',
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true
    });

    expect(created.content).toContain(NA_LINE);
    expect(created.content).not.toContain('- change-id: <id>');
  });

  it('when the pristine template is linted, should report zero findings', async () => {
    await createRequestArtifact({
      role: 'qa',
      requestId: '2026-10-19-qa-openspec-absent',
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true
    });

    const report = await lintRequestArtifact({
      projectRoot: ws().path,
      role: 'qa',
      requestId: '2026-10-19-qa-openspec-absent',
      sessionId: SESSION_ID
    });

    expect(report?.findings).toEqual([]);
    expect(report?.ok).toBe(true);
  });

  it('when QA meets its test-cases prerequisite, should transition a pristine template to running', async () => {
    const requestId = '2026-10-19-qa-openspec-absent';
    await createRequestArtifact({
      role: 'qa',
      requestId,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true
    });
    const testCasesDir = join(ws().path, '.peaks', '_runtime', SESSION_ID, 'qa', 'test-cases');
    mkdirSync(testCasesDir, { recursive: true });
    writeFileSync(
      join(testCasesDir, `${requestId}.md`),
      '## Test cases\n\n- test(measured) prerequisite placeholder\n',
      'utf8'
    );

    const transitioned = await transitionRequestArtifact({
      role: 'qa',
      requestId,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      newState: 'running',
      confirmed: true
    });

    expect(transitioned?.state).toBe('running');
  });
});

describe('Scenario: a repository with openspec/changes/ keeps the prompt form', () => {
  const ws = withTmpWorkspacePerTest('peaks-qa-openspec-present-');

  it('when init renders the QA template, should emit the change-id prompt and no N/A', async () => {
    mkdirSync(join(ws().path, 'openspec', 'changes'), { recursive: true });

    const created = await createRequestArtifact({
      role: 'qa',
      requestId: '2026-10-19-qa-openspec-present',
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      apply: true
    });

    expect(created.content).toContain('- change-id: <id>');
    expect(created.content).not.toContain(NA_LINE);
  });
});
