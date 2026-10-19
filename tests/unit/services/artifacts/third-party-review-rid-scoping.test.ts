// tests/unit/services/artifacts/third-party-review-rid-scoping.test.ts
//
// Backlog §9.37's residual decision item. THIRD_PARTY_REVIEW was the last
// live, hard-failure-to-be prerequisite whose filename carried no rid: when
// its v2.15.0 back-compat window closes, two slices in one session would
// overwrite each other's review, and nothing in the artifact or the gate
// would say so.
//
// The assertions are deliberately not "the gate passes". They are:
//   - two rids in one session resolve to two DISTINCT files, each holding its
//     own body
//   - a scoped file for a DIFFERENT rid does NOT satisfy this rid's gate — the
//     positive control that keeps the case above from being vacuous
//   - the legacy bare path is still accepted, so sessions already on disk pass
//   - the real producer writes the scoped markdown AND JSON names, because a
//     scoped requirement with a bare-name producer would be unsatisfiable
//
// Dimensions covered:
//   - render:      the declared / producer-written filenames
//   - behavior:    resolution outcome per rid, and the legacy tier
//   - integration: a real temp `.peaks/_runtime/<sid>/` tree on disk
//   - a11y:        omitted — the resolver and producer return an envelope or
//                  absolute paths; nothing here prints to a human

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { writeReviewerArtifacts } from '../../../../src/services/reviewer/reviewer-artifacts.js';
import type { ReviewerEnvelope } from '../../../../src/services/reviewer/reviewer-types.js';
import {
  makeProjectRoot,
  missingPaths,
  RID_A,
  RID_B,
  SESSION_ID,
  sessionRootOf,
  tempRoots,
  thirdPartyBody,
  thirdPartyPath,
  writeArtifact
} from './_audit-artifact-rid-fixtures.js';

declareDimensions(
  'tests/unit/services/artifacts/third-party-review-rid-scoping.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'resolver/producer return an envelope or absolute paths; nothing prints'
    }
  ]
);

/** A valid ReviewerEnvelope, so the producer arm exercises the real writer. */
const ENVELOPE: ReviewerEnvelope = {
  reviewerId: 'third-party-reviewer-v2.14.0',
  modelId: 'llama3.2:8b',
  modelFamily: 'llama',
  passed: true,
  violations: [],
  gateAction: 'allow',
  reason: 'no findings'
};

const LEGACY_BARE = 'rd/third-party-review.md';

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('(9.37) THIRD_PARTY_REVIEW is per-rid, with the bare path as its legacy tier', () => {
  it('resolves two rids in ONE session to two distinct files, each holding its own body', async () => {
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, thirdPartyPath(RID_A), thirdPartyBody(RID_A));
    writeArtifact(projectRoot, thirdPartyPath(RID_B), thirdPartyBody(RID_B));

    const a = await missingPaths(projectRoot, RID_A);
    const b = await missingPaths(projectRoot, RID_B);

    expect(a.warnings).not.toContain(thirdPartyPath(RID_A));
    expect(b.warnings).not.toContain(thirdPartyPath(RID_B));
    // The property the collision destroyed: both files coexist, and each
    // still holds the rid whose review it is.
    expect(readFileSync(join(sessionRootOf(projectRoot), thirdPartyPath(RID_A)), 'utf8')).toContain(
      RID_A
    );
    expect(readFileSync(join(sessionRootOf(projectRoot), thirdPartyPath(RID_B)), 'utf8')).toContain(
      RID_B
    );
  });

  it('does NOT let a scoped file for a DIFFERENT rid satisfy this rid gate', async () => {
    // The positive control: if resolution ignored the rid and matched any
    // `third-party-review*.md`, this would pass and the test above would be
    // vacuous.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, thirdPartyPath(RID_A), thirdPartyBody(RID_A));

    const b = await missingPaths(projectRoot, RID_B);

    expect(b.warnings).toContain(thirdPartyPath(RID_B));
  });

  it('still accepts the bare legacy path for a session already on disk', async () => {
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, LEGACY_BARE, thirdPartyBody(RID_A));

    const a = await missingPaths(projectRoot, RID_A);

    expect(a.warnings).not.toContain(thirdPartyPath(RID_A));
    expect(a.warnings).not.toContain(LEGACY_BARE);
  });

  it('the producer writes the rid-scoped markdown and JSON siblings side by side', () => {
    // A rid-scoped requirement with a bare-name producer would be
    // unsatisfiable, so the gate's filename contract is asserted against the
    // real producer, not a hand-written file.
    const projectRoot = makeProjectRoot();
    const written = [RID_A, RID_B].map((rid) =>
      writeReviewerArtifacts({ projectRoot, sessionId: SESSION_ID, rid, envelope: ENVELOPE })
    );

    expect(written[0]?.markdown).toBe(join(sessionRootOf(projectRoot), thirdPartyPath(RID_A)));
    expect(written[1]?.markdown).toBe(join(sessionRootOf(projectRoot), thirdPartyPath(RID_B)));
    for (const rid of [RID_A, RID_B]) {
      expect(existsSync(join(sessionRootOf(projectRoot), thirdPartyPath(rid)))).toBe(true);
      expect(
        existsSync(join(sessionRootOf(projectRoot), `rd/third-party-review-${rid}.json`))
      ).toBe(true);
      expect(readFileSync(join(sessionRootOf(projectRoot), thirdPartyPath(rid)), 'utf8')).toContain(
        rid
      );
    }
  });
});
