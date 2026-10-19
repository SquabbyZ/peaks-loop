// tests/unit/services/artifacts/artifact-lint-metadata.test.ts
//
// `- type:` and `- state:` were parse targets with no spelling validation
// (backlog §14.6). A parenthetical type (`- type: feature (why)`) was neither
// allowlisted nor rule-matched, so the lint passed it silently while the reader
// fell closed to `feature`. `- state:` was blanket-allowlisted, so any value at
// all passed. An ABSENT `- state:` line was silent too (backlog §10.5): the
// artifact passed lint, then the transition refused it with
// `STATE_ORDER_UNREADABLE` two steps later.
//
// Dimensions covered:
//   - behavior:    malformed type, malformed state, bare valid, absent state
//   - integration: real artifacts on disk, read through `showRequestArtifact`
//   - a11y:        the reason text names the allowed set
//
//   - render:      OMITTED — the report shape is asserted inside behavior

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { lintRequestArtifact } from '../../../../src/services/artifacts/artifact-lint-service.js';
import { VALID_REQUEST_TYPES } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { allowedStatesForRole } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';

declareDimensions(
  'tests/unit/services/artifacts/artifact-lint-metadata.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'the report shape is asserted inside behavior' }]
);

const SESSION_ID = 'test-session';
const RID = '2026-10-18-lint-metadata';

const ws = withTmpWorkspacePerTest('peaks-lint-metadata-');

/** Write the RD artifact the lint reads. The body is the only variable. */
function writeArtifact(body: string): void {
  const path = join(ws().path, '.peaks', '_runtime', SESSION_ID, 'rd', 'requests', `001-${RID}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

function artifactWith(metadataLines: readonly string[]): string {
  return ['# RD Request', '', ...metadataLines, '', 'Real content here.'].join('\n');
}

async function lint(): Promise<Awaited<ReturnType<typeof lintRequestArtifact>>> {
  return lintRequestArtifact({
    projectRoot: ws().path,
    role: 'rd',
    requestId: RID,
    sessionId: SESSION_ID
  });
}

describe('Scenario: behavior — metadata spelling is validated by the reader’s own rules', () => {
  it('when the type carries a parenthetical, should report one error naming the six types', async () => {
    // given: the exact shape three RD artifacts in session 2026-10-18 wrote
    writeArtifact(artifactWith(['- type: feature (why)', '- state: draft']));

    // when: the artifact is linted
    const report = await lint();

    // then: it is refused, and only the metadata rule fires on the line
    expect(report?.ok).toBe(false);
    expect(report?.findings).toHaveLength(1);
    expect(report?.findings[0]?.line).toBe(3);
    expect(report?.findings[0]?.severity).toBe('error');
    expect(report?.findings[0]?.reason).toContain('Invalid - type: "feature (why)"');
    expect(report?.findings[0]?.reason).toContain(VALID_REQUEST_TYPES.join(', '));
  });

  it('when the state carries a parenthetical, should report one error naming the role’s states', async () => {
    // given: a state value the transition would fail closed on, but the lint did not
    writeArtifact(artifactWith(['- type: feature', '- state: implemented (working tree)']));

    // when: the artifact is linted
    const report = await lint();

    // then: it is refused, and the reason names the states legal for role `rd`
    expect(report?.ok).toBe(false);
    expect(report?.findings).toHaveLength(1);
    expect(report?.findings[0]?.reason).toContain(
      'Invalid - state: "implemented (working tree)" for role rd'
    );
    expect(report?.findings[0]?.reason).toContain(allowedStatesForRole('rd').join(', '));
  });

  it('when both metadata lines are bare and valid, should pass — the control', async () => {
    // given: the pair `request init` and `request transition` write
    writeArtifact(artifactWith(['- type: bugfix', '- state: implemented']));

    // when: the artifact is linted
    const report = await lint();

    // then: nothing is reported
    expect(report?.ok).toBe(true);
    expect(report?.findings).toStrictEqual([]);
  });

  it('when the artifact carries no state line, should report one error naming the role’s states', async () => {
    // given: an artifact whose `- state:` line was never written
    writeArtifact(artifactWith([]));

    // when: the artifact is linted
    const report = await lint();

    // then: it is refused at author time, naming what the reader accepts
    expect(report?.ok).toBe(false);
    expect(report?.findings).toHaveLength(1);
    expect(report?.findings[0]?.severity).toBe('error');
    expect(report?.findings[0]?.reason).toContain('Missing - state: line for role rd');
    expect(report?.findings[0]?.reason).toContain(allowedStatesForRole('rd').join(', '));
  });

  it('when the artifact records no type line but a valid state, should pass', async () => {
    // given: type is optional metadata; only the state line is required
    writeArtifact(artifactWith(['- state: draft']));

    // when: the artifact is linted
    const report = await lint();

    // then: nothing is reported
    expect(report?.ok).toBe(true);
    expect(report?.findings).toStrictEqual([]);
  });
});

describe('Scenario: integration — bare metadata lines emit no placeholder findings', () => {
  it('when bare metadata lines are present, should report no unfilled-placeholder finding', async () => {
    // given: a real artifact whose body is only the valid metadata and prose
    writeArtifact(artifactWith(['- type: chore', '- state: draft']));

    // when: the lint runs over the file on disk
    const report = await lint();

    // then: neither the `<...>` rule nor the bare-bullet rule fired on them
    const reasons = (report?.findings ?? []).map((finding) => finding.reason);
    expect(reasons).toStrictEqual([]);
    expect(reasons.some((reason) => reason.includes('placeholder'))).toBe(false);
  });
});

describe('Scenario: a11y — the reason names the allowed set', () => {
  it('when a malformed type is reported, should name every allowed request type', async () => {
    writeArtifact(artifactWith(['- type: improvement', '- state: draft']));
    const report = await lint();
    const reason = report?.findings[0]?.reason ?? '';
    for (const type of VALID_REQUEST_TYPES) {
      expect(reason).toContain(type);
    }
  });

  it('when a malformed state is reported, should name every state allowed for the role', async () => {
    writeArtifact(artifactWith(['- type: feature', '- state: shipped']));
    const report = await lint();
    const reason = report?.findings[0]?.reason ?? '';
    for (const state of allowedStatesForRole('rd')) {
      expect(reason).toContain(state);
    }
  });

  it('when a missing state line is reported, should name every state allowed for the role', async () => {
    writeArtifact(artifactWith(['- type: feature']));
    const report = await lint();
    const reason = report?.findings[0]?.reason ?? '';
    for (const state of allowedStatesForRole('rd')) {
      expect(reason).toContain(state);
    }
  });
});
