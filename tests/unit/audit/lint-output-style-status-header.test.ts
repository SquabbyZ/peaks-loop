// tests/unit/audit/lint-output-style-status-header.test.ts
//
// The output-style linter's status-header check.
//
// WHAT IT IS FOR. `lintStatusHeader` answers ONE question: does this
// session's transcript carry a Peaks-Loop status header at all? It is not a
// shape check — the header is published in several shapes (three segments,
// four with a Role cell, five with Role and Context), and a linter that
// reddened the older three-segment examples still carried by the skill
// documentation would be measuring something other than its own duty.
//
// So this file pins BOTH halves of that contract: every published shape is
// accepted, and a transcript with no header at all is still reported.
//
// Dimensions: behavior (the verdict per header shape), integration (the real
// session.log the enforcer reads), render (the finding a missing header
// produces). a11y omitted — the enforcer returns a typed LintHit; the human
// facing text of that hit is asserted in the render dimension.
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/audit/lint-output-style-status-header.test.ts

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { lintStatusHeader } from '../../../src/services/audit/enforcers/lint-output-style.js';

declareDimensions(
  'tests/unit/audit/lint-output-style-status-header.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason:
        'the enforcer returns a typed LintHit; its human-facing text is asserted in the render dimension'
    }
  ]
);

const SID = '2026-10-24-session-0000dd';

/** A project whose session log carries `body`. */
function projectWithLog(body: string): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-lint-status-header-'));
  const dir = join(root, '.peaks', '_runtime', SID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'session.log'), body, 'utf8');
  return root;
}

/** The header shapes the response contract publishes. */
const THREE_SEGMENT =
  'Peaks-Loop Skill: peaks-code | Peaks-Loop Gate: startup | Next: write the slice';
const FOUR_SEGMENT =
  'Peaks-Loop Skill: peaks-rd | Peaks-Loop Role: bee | Peaks-Loop Gate: rd-dry-run | Next: write the slice';
const FIVE_SEGMENT =
  'Peaks-Loop Skill: peaks-rd | Peaks-Loop Role: bee | Peaks-Loop Gate: rd-dry-run | Peaks-Loop Context: 42.3% (none) | Next: write the slice';

describe('Scenario: behavior — every published header shape is accepted', () => {
  it('when the transcript carries a three-segment header, should report no finding', () => {
    // given: a transcript carrying the three-segment header
    // when: the status header is linted
    // then: no finding — the shape check does not narrow the old form
    const root = projectWithLog(`${THREE_SEGMENT}\n`);
    expect(lintStatusHeader(root, SID)).toEqual([]);
  });

  it('when the transcript carries a four-segment header, should report no finding', () => {
    // given: a transcript carrying the four-segment header
    // when: the status header is linted
    // then: no finding
    const root = projectWithLog(`${FOUR_SEGMENT}\n`);
    expect(lintStatusHeader(root, SID)).toEqual([]);
  });

  it('when the transcript carries a five-segment header, should report no finding', () => {
    // given: a transcript carrying the five-segment header
    // when: the status header is linted
    // then: no finding — the Role and Context cells are part of the header
    const root = projectWithLog(`${FIVE_SEGMENT}\n`);
    expect(lintStatusHeader(root, SID)).toEqual([]);
  });

  it('when the transcript carries the header inside a longer response, should report no finding', () => {
    // given: a transcript whose header sits in the middle of a response
    // when: the status header is linted
    // then: no finding
    const root = projectWithLog(`working on it\n\n${FIVE_SEGMENT}\n\ndone for now\n`);
    expect(lintStatusHeader(root, SID)).toEqual([]);
  });
});

describe('Scenario: integration — the transcript the enforcer actually reads', () => {
  it('when the session log does not exist, should report no finding', () => {
    // given: a project with no session log at all
    // when: the status header is linted
    // then: no finding — a missing transcript is not a missing header
    const root = mkdtempSync(join(tmpdir(), 'peaks-lint-status-header-'));
    expect(lintStatusHeader(root, SID)).toEqual([]);
  });
});

describe('Scenario: render — the finding a missing header produces', () => {
  it('when the transcript carries no header, should report one named finding', () => {
    // given: a transcript with no status header in it
    // when: the status header is linted
    // then: one finding, naming the rule that fired and the missing shape
    const root = projectWithLog('just some prose, no header at all\n');
    const hits = lintStatusHeader(root, SID);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-output-style-status-header-001');
    expect(hits[0]?.matchedText).toContain('Peaks-Loop Skill');
  });
});
