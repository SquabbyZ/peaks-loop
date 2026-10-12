// tests/unit/services/artifacts/back-compat-warning-code.test.ts
//
// Guard for rid `rid-mut-report-warning-surfacing` (session
// `2026-10-12-session-74bd69`). Two defects were measured on that session, and
// this file pins both:
//
//   1a. The gate computed its soft-pass warnings and the CALLER dropped them.
//       `checkPrerequisites` returned `ok: true, missing: 0, warnings: 2` for
//       `rd:qa-handoff`, and `transitionRequestArtifact` read
//       `prerequisiteResult.warnings` only inside its throw — so the array was
//       built, populated and lost one frame later on the SUCCESS path. A
//       reader of a successful transition concluded every prerequisite had
//       passed.
//   1b. The shared soft-pass branch emitted the LITERAL
//       `mut-report-missing-deprecated-in-v2.14.0` for ANY `backCompat`
//       prerequisite, so the warning attached to `rd/third-party-review.md`
//       carried the MUT report's code and a consumer filtering on that code
//       matched both artifacts.
//
// So the assertions below are deliberately not "a warning exists". They are:
//   - each code names its OWN artifact, and the two live prerequisites that
//     carry `backCompat` get two DIFFERENT codes
//   - the code is derived, so a `backCompat` prerequisite added later gets its
//     own code with no second edit — asserted on a synthetic requirement
//   - the MUT code is byte-identical to the one CHANGELOG v2.13.3 documents
//     (`mut-report-missing-deprecated-in-v2.14.0`), so the published code did
//     not move under a document that still names it
//   - the controls: a HARD prerequisite that is missing lands in `missing`,
//     never in `warnings`; and a transition with no requirements at all
//     reports an EMPTY warning list, so a non-empty one cannot be the
//     printer's always-something habit
//   - integration: a real `.peaks/_runtime/<sid>/` tree on disk, through the
//     real `transitionRequestArtifact`, asserting the two warnings reach the
//     SUCCESS result
//
// Dimensions covered:
//   - render:      the derived code's shape per prerequisite
//   - behavior:    which list a missing prerequisite lands in, soft vs hard
//   - integration: a real tmp session tree + a real rd:qa-handoff transition
//   - a11y:        omitted — the resolver returns an envelope; the CLI printer
//                  that renders it to a human is guarded in
//                  `tests/unit/cli/request-codegraph-autorefresh.test.ts`

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import {
  checkPrerequisites,
  getPrerequisitesFor,
  type ArtifactPrerequisite
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { backCompatWarningCode } from '../../../../src/services/artifacts/prerequisite-checks.js';
import { transitionRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import {
  makeProjectRoot,
  RID_A,
  seedCompleteSlice,
  SESSION_ID,
  sessionRootOf,
  writeArtifact
} from './_audit-artifact-rid-fixtures.js';

declareDimensions(
  'tests/unit/services/artifacts/back-compat-warning-code.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the resolver returns an envelope; rendering it to a human is guarded in tests/unit/cli/request-codegraph-autorefresh.test.ts'
    }
  ]
);

const MUT_REPORT_BARE = 'mut/mut-report.json';
const THIRD_PARTY_REVIEW_BARE = 'rd/third-party-review.md';
/** The code CHANGELOG v2.13.3 documents for the MUT soft-block. Frozen here on
 *  purpose: this is a published code, so a change to the derivation has to
 *  fail a test and be reconciled with the docs rather than drift silently. */
const DOCUMENTED_MUT_CODE = 'mut-report-missing-deprecated-in-v2.14.0';
const THIRD_PARTY_REVIEW_CODE = 'third-party-review-missing-deprecated-in-v2.15.0';

/** The `rd:qa-handoff` FEATURE row, read from the shipped table rather than
 *  reconstructed — a copy would keep passing after the real table changed. */
function qaHandoffRequirements(): ReadonlyArray<ArtifactPrerequisite> {
  return getPrerequisitesFor('rd', 'qa-handoff', 'feature');
}

function findRequirement(relativePath: string): ArtifactPrerequisite {
  const found = qaHandoffRequirements().find(
    (prerequisite) => prerequisite.relativePath === relativePath
  );
  expect(found, `${relativePath} is not in the rd:qa-handoff row`).toBeDefined();
  return found as ArtifactPrerequisite;
}

describe('Scenario: render — each back-compat warning names its own artifact', () => {
  it('when a prerequisite soft-passes, should derive a code from its own filename and closing release', () => {
    // given: the two prerequisites marked backCompat in the shipped table
    // when: each one's warning code is derived
    // then: each names its own artifact and release — the defect was ONE code
    //       for both
    const mutCode = backCompatWarningCode(findRequirement(MUT_REPORT_BARE));
    const thirdPartyCode = backCompatWarningCode(findRequirement(THIRD_PARTY_REVIEW_BARE));
    expect(mutCode).toBe(DOCUMENTED_MUT_CODE);
    expect(thirdPartyCode).toBe(THIRD_PARTY_REVIEW_CODE);
    expect(mutCode).not.toBe(thirdPartyCode);
  });

  it('when every backCompat prerequisite in the table is considered, should give each a distinct code', () => {
    // given: every prerequisite the shipped table marks backCompat
    // when: their codes are collected
    // then: there are at least the two known ones and no code is shared
    //       (a shared code is the defect, not an accepted shape)
    const softRequirements = qaHandoffRequirements().filter(
      (prerequisite) => prerequisite.backCompat === true
    );
    const codes = softRequirements.map((prerequisite) => backCompatWarningCode(prerequisite));
    expect(softRequirements.length).toBeGreaterThanOrEqual(2);
    expect(new Set(codes).size).toBe(codes.length);
    for (const prerequisite of softRequirements) {
      expect(backCompatWarningCode(prerequisite)).toContain(
        prerequisite.relativePath.split('/').pop()?.split('.')[0] ?? ''
      );
    }
  });

  it('when a backCompat prerequisite is added later, should get its own code without a second edit', () => {
    // given: a prerequisite no table has today, marked soft with its own release
    // when: its code is derived by the same function the gate calls
    // then: it identifies its own artifact and names the declared release, and
    //       is neither of the two shipped codes
    const addedLater: ArtifactPrerequisite = {
      relativePath: 'qa/traceability.json',
      description: 'a prerequisite that does not exist yet',
      backCompat: true,
      backCompatUntil: 'v9.9.9'
    };
    const code = backCompatWarningCode(addedLater);
    expect(code).toBe('traceability-missing-deprecated-in-v9.9.9');
    expect(code).not.toBe(DOCUMENTED_MUT_CODE);
    expect(code).not.toBe(backCompatWarningCode(findRequirement(THIRD_PARTY_REVIEW_BARE)));
  });
});

describe('Scenario: behavior — soft is reported, hard still fails, and empty stays empty', () => {
  it('when both soft prerequisites are missing on a real tree, should warn without failing', async () => {
    // given: a session tree seeded with every HARD prereq and neither soft one
    // when: the gate runs for rd:qa-handoff
    // then: each soft pass is reported with its own code and ok stays true
    const projectRoot = makeProjectRoot();
    seedCompleteSlice(projectRoot, RID_A);
    const result = await checkPrerequisites({
      projectRoot,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestType: 'feature',
      requestId: RID_A
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.path)).toEqual([
      THIRD_PARTY_REVIEW_BARE,
      MUT_REPORT_BARE
    ]);
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      THIRD_PARTY_REVIEW_CODE,
      DOCUMENTED_MUT_CODE
    ]);
  });

  it('when a HARD prerequisite is missing, should keep it in missing and out of the soft warnings', async () => {
    // given: a seeded tree with the karpathy review deleted (no backCompat flag)
    // when: the gate runs
    // then: the hard prereq fails the gate from missing, and no soft warning is
    //       attributed to it
    const projectRoot = makeProjectRoot();
    seedCompleteSlice(projectRoot, RID_A);
    rmSync(join(sessionRootOf(projectRoot), `rd/karpathy-review-${RID_A}.md`));
    const result = await checkPrerequisites({
      projectRoot,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestType: 'feature',
      requestId: RID_A
    });
    expect(result.ok).toBe(false);
    expect(result.missing.map((entry) => entry.path)).toContain(`rd/karpathy-review-${RID_A}.md`);
    expect(result.warnings.map((warning) => warning.path)).not.toContain(
      `rd/karpathy-review-${RID_A}.md`
    );
    expect(result.warnings.map((warning) => warning.path)).toEqual([
      THIRD_PARTY_REVIEW_BARE,
      MUT_REPORT_BARE
    ]);
  });

  it('when the transition requires no artifacts, should report an empty warning list — the control arm', async () => {
    // given: chore has no rd:qa-handoff row, and feature does
    // when: the gate runs for both types
    // then: the empty list means nothing was required — not a silent printer
    const projectRoot = makeProjectRoot();
    const noRequirements = await checkPrerequisites({
      projectRoot,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestType: 'chore',
      requestId: RID_A
    });
    expect(qaHandoffRequirements().length).toBeGreaterThan(0);
    expect(noRequirements.warnings).toEqual([]);
    expect(noRequirements.missing).toEqual([]);
    expect(noRequirements.ok).toBe(true);
  });
});

describe('Scenario: integration — a successful transition reports its soft passes', () => {
  const ws = withTmpWorkspacePerTest('peaks-backcompat-code-');

  it('when rd:qa-handoff succeeds with both soft artifacts absent, should carry both warnings on the result', async () => {
    // given: a real rd artifact past draft plus every HARD prerequisite
    // when: the transition runs for real
    // then: it succeeded and the soft passes reached its result
    //       (the artifact is written past `draft` on purpose — the lint gate
    //        owns draft → any transition, and lint is not what this pins)
    writeArtifact(
      ws().path,
      `rd/requests/001-${RID_A}.md`,
      `# RD Request ${RID_A}\n\n- session: ${SESSION_ID}\n- state: implemented\n- type: feature\n`
    );
    seedCompleteSlice(ws().path, RID_A);
    const result = await transitionRequestArtifact({
      role: 'rd',
      requestId: RID_A,
      projectRoot: ws().path,
      newState: 'qa-handoff',
      sessionId: SESSION_ID,
      confirmed: true
    });
    expect(result?.state).toBe('qa-handoff');
    expect(result?.prerequisiteWarnings?.map((warning) => warning.path)).toEqual([
      THIRD_PARTY_REVIEW_BARE,
      MUT_REPORT_BARE
    ]);
    expect(result?.prerequisiteWarnings?.map((warning) => warning.code)).toEqual([
      THIRD_PARTY_REVIEW_CODE,
      DOCUMENTED_MUT_CODE
    ]);
  });
});
