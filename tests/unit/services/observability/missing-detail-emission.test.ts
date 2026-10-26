// tests/unit/services/observability/missing-detail-emission.test.ts
//
// WHY THIS FILE EXISTS. The slice-transition event recorded how MANY
// artifacts were missing and dropped which ones, so the stream could say
// that a transition failed but never which skill had failed to deliver what.
// This file pins the list: the event must carry every missing artifact, each
// with its own owning skill.
//
// WHY THE EVENT IS READ BACK FROM DISK. The emit is fire-and-forget, so the
// only honest way to assert what it recorded is to read the session's
// metrics file back and look at the line that was written.
//
// Dimensions:
//   - behavior:   the shape of the recorded detail — the list, its entries
//   - integration: the emit writing to a session's metrics file and being read back
//   - render:     OMITTED — the event is a machine record, not a rendered surface
//   - a11y:       OMITTED — no operator-facing message originates here

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { PrerequisiteCheckResult } from '~/src/services/artifacts/artifact-prerequisites.js';
import { emitPrereqTransitionEvent } from '~/src/services/artifacts/prerequisite-transition-event.js';
import { readObservabilityEvents } from '~/src/services/observability/observability-service.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/missing-detail-emission.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the event is a machine record; it renders no surface' },
    { dim: 'a11y', reason: 'no human-visible message originates here' }
  ]
);

const SESSION_ID = '2026-01-01-session-missing-detail';
const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/** A throwaway project root; the emit writes its metrics under it. */
function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-missing-detail-'));
  roots.push(root);
  return root;
}

/**
 * A prerequisite check that failed on two artifacts: one absent file, one
 * file whose body does not carry what the gate demands.
 */
const FAILED_RESULT: PrerequisiteCheckResult = {
  ok: false,
  missing: [
    {
      kind: 'absent',
      path: 'rd/code-review-slice-1.md',
      description: 'Code review evidence'
    },
    {
      kind: 'body',
      path: 'audit/security-slice-1.md',
      description: 'the audit envelope carries no verdict header'
    }
  ],
  warnings: []
};

describe('Scenario: behavior — the transition event keeps the missing-artifact list', () => {
  it('when a transition fails on missing artifacts, should record each one with its owner', () => {
    // given: a prerequisite check that failed on two missing artifacts
    // when: the transition event is emitted for that session
    // then: the recorded detail names both artifacts and the skill that owns each
    const root = projectRoot();
    emitPrereqTransitionEvent({
      projectRoot: root,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: 'slice-1',
      result: FAILED_RESULT
    });
    const events = readObservabilityEvents(root, SESSION_ID);
    const transition = events.find((event) => event.category === 'slice-transition');
    if (transition === undefined) throw new Error('no slice-transition event was recorded');
    const detail = transition.detail;
    expect(detail['missingCount']).toBe(2);
    expect(detail['missing']).toEqual([
      {
        path: 'rd/code-review-slice-1.md',
        description: 'Code review evidence',
        kind: 'absent',
        ownerSkill: 'peaks-rd'
      },
      {
        path: 'audit/security-slice-1.md',
        description: 'the audit envelope carries no verdict header',
        kind: 'body',
        ownerSkill: 'peaks-security-audit'
      }
    ]);
  });
});
