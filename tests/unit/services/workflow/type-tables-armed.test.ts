// tests/unit/services/workflow/type-tables-armed.test.ts
//
// rid `2026-10-16-type-tables-are-authoritative`. THE ARMING — the armed-table
// arms, split out of `type-tables-are-authoritative.test.ts` for a measured
// reason: that file plus these arms came to 585 lines against the 500-line tests
// cap, and `tests/unit/lint/staged-size-leg.test.ts` refuses an over-cap file the
// change set GROWS (a new file grows from 0). Both files are now under the cap and
// no arm was dropped.
//
// WHY THE CHECK HAS TO BE NON-CIRCULAR. A file that asserted `qaGatesForType(t)`
// against `getPrerequisitesFor(…, t)` read from the SHIPPED module would go
// through one registry entry twice, and would stay green for a member list too as
// long as the list matched today. So each arm loads the shipped modules against a
// MUTATED COPY of the type table — one row rewritten — and asks the shipped code
// what it makes of a sibling answer it has never seen. A member list cannot follow
// it; a derivation cannot do anything else.
//
// Dimensions: `render` and `a11y` are omitted — nothing here renders, and the one
// human-facing string these arms read (the load-time refusal) is asserted as an
// exact message rather than as rendered output; the sibling file owns the a11y
// arms for the violation text a user acts on.
//

import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { type RequestType } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { qaGatesForType } from '../../../../src/services/workflow/pipeline-verify-gate-support.js';

declareDimensions(
  'tests/unit/services/workflow/type-tables-armed.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'nothing here renders: the arms assert gate lists and a refusal message'
    },
    {
      dim: 'a11y',
      reason:
        'the refusal text is asserted as an exact message, and the violation text a user acts on is covered by type-tables-are-authoritative.test.ts'
    }
  ]
);

// ---------------------------------------------------------------------------
// integration — the derivation is armed against a SIBLING table, not itself
//
// A file that asserted `qaGatesForType(t)` against `getPrerequisitesFor(…, t)`
// read from the shipped module would be circular: both reads go through the same
// registry entry, so it would stay green for a member list too, as long as the
// list matched today. These arms instead drive the SHIPPED checker against a
// table that is NOT the shipped one — a copy, mutated in one cell — so the only
// thing that can make them pass is the gate list actually being read off the
// table it was handed.
// ---------------------------------------------------------------------------

/**
 * The row the sibling tables below are planted with, written out LITERALLY.
 *
 * An earlier version read it off the shipped table by position —
 * `PLANTED_TEST_REPORT_ROW` — which made these arms a
 * function of that row's SHAPE: one legitimate edit to it (a third artifact, a
 * reordering) would change what the arms plant and redden them for a reason that
 * has nothing to do with the derivation. A planted row is a fact about the
 * fixture, so it is spelled here — and its path is the one `QA_EVIDENCE_GATES`
 * declares a gate for, which is what the reconciliation checks and therefore what
 * a planted evidence row has to satisfy.
 */
const PLANTED_TEST_REPORT_ROW = [
  { relativePath: 'qa/test-reports/<rid>.md', description: 'QA test report with execution results' }
];

const TABLE_SPECIFIER = '../../../../src/services/artifacts/artifact-prerequisites.js';
const GATE_SUPPORT_SPECIFIER = '../../../../src/services/workflow/pipeline-verify-gate-support.js';
const QA_PHASE_SPECIFIER = '../../../../src/services/workflow/pipeline-verify-qa-phase.js';

type TableAccessor = (
  role: string,
  newState: string,
  requestType: string
) => ReadonlyArray<{ relativePath: string; description: string }>;

type PlantedChecker = {
  typeRequiresQaPhase: (requestType: RequestType) => boolean;
  qaGatesForType: (requestType: RequestType) => Array<{ name: string }>;
};

/**
 * Load the QA-phase derivation and the QA gate list afresh, against a mutated
 * copy of the type table. `mutate` is handed the real accessor and returns the
 * answer the sibling gives for each cell, so a mutation is a rewritten copy of
 * ONE row rather than a second table written out by hand.
 */
async function loadAgainstMutatedTable(
  mutate: (actual: TableAccessor) => TableAccessor
): Promise<PlantedChecker> {
  vi.resetModules();
  vi.doMock(TABLE_SPECIFIER, async () => {
    const actual = (await vi.importActual(TABLE_SPECIFIER)) as Record<string, unknown>;
    const real = actual.getPrerequisitesFor as TableAccessor;
    return { ...actual, getPrerequisitesFor: mutate(real) };
  });
  const phase = (await import(QA_PHASE_SPECIFIER)) as unknown as {
    typeRequiresQaPhase: (requestType: RequestType) => boolean;
  };
  const gates = (await import(GATE_SUPPORT_SPECIFIER)) as unknown as {
    qaGatesForType: (requestType: RequestType) => Array<{ name: string }>;
  };
  return { typeRequiresQaPhase: phase.typeRequiresQaPhase, qaGatesForType: gates.qaGatesForType };
}

describe('Scenario: integration — the derivation is armed against a sibling table', () => {
  afterEach(() => {
    vi.doUnmock(TABLE_SPECIFIER);
    vi.resetModules();
  });

  it('when a sibling table drops a type QA row, should build that type no QA gate', async () => {
    // given: the shipped answer — the control the mutation has to move
    expect(qaGatesForType('feature').map((g) => g.name)).toEqual([
      'qa-request-exists',
      'test-cases',
      'test-report'
    ]);
    // when:  a table that answers "feature has no QA row at all" is loaded — at
    //        EVERY state, because the derivation counts the phase across all of
    //        them and a single-cell mutation would leave `qa:running` behind
    const planted = await loadAgainstMutatedTable(
      (actual) => (role, state, type) =>
        role === 'qa' && type === 'feature' ? [] : actual(role, state, type)
    );
    // then:  the checker follows the sibling it was handed. A member list would
    //        still answer the same three names here, which is the whole point.
    expect(planted.typeRequiresQaPhase('feature')).toBe(false);
    expect(planted.qaGatesForType('feature')).toEqual([]);
  });

  it('when a sibling table carries a QA row only at a non-terminal state, should still read a phase', async () => {
    // given: the shape the terminal-state-only arming could not see — a table that
    //        states its QA contract at `running` and never reaches `verdict-issued`
    // when:  the sibling is loaded
    // then:  the phase exists and its gate is built, because the derivation counts
    //        the axis and not one cell of it
    const planted = await loadAgainstMutatedTable(
      (actual) => (role, state, type) =>
        role === 'qa' && type === 'docs'
          ? state === 'running'
            ? PLANTED_TEST_REPORT_ROW
            : []
          : actual(role, state, type)
    );

    expect(planted.typeRequiresQaPhase('docs')).toBe(true);
    expect(planted.qaGatesForType('docs').map((g) => g.name)).toEqual([
      'qa-request-exists',
      'test-report'
    ]);
  });

  it('when a sibling table gives a type a QA row, should build the gate that row names', async () => {
    // given: the shipped answer for a type whose table carries no QA row
    expect(qaGatesForType('docs')).toEqual([]);
    // when:  the sibling gives it the table's own test-report row at every state
    //        it could be in
    const planted = await loadAgainstMutatedTable(
      (actual) => (role, state, type) =>
        role === 'qa' && type === 'docs' ? PLANTED_TEST_REPORT_ROW : actual(role, state, type)
    );
    // then:  the gate list follows the row — including which row it is, so the
    //        test-cases gate is still absent
    expect(planted.typeRequiresQaPhase('docs')).toBe(true);
    expect(planted.qaGatesForType('docs').map((g) => g.name)).toEqual([
      'qa-request-exists',
      'test-report'
    ]);
  });

  // EVERY state, not just the terminal one the phase ends in: a table that grows
  // a `qa:` row at an earlier state is the same edit, one state over, and the
  // arming has to cover the axis rather than the one cell the evidence is
  // resolved at.
  /** The two QA states the shipped tables actually use. Literals on purpose: a
   *  `it.each` driven by `QA_STATES` would shrink silently with the constant it
   *  is supposed to be pinning. */
  it.each(['running', 'verdict-issued'])(
    'when a sibling table names an unstaked QA artifact at qa:%s, should refuse and name it',
    async (qaState) => {
      // given: the mutation the reconciliation exists for — a QA row whose path
      //        no declared gate stands for, which would otherwise produce no gate
      //        and no complaint
      let message = '';
      try {
        await loadAgainstMutatedTable(
          (actual) => (role, state, type) =>
            role === 'qa' && state === qaState && type === 'docs'
              ? [
                  {
                    relativePath: 'qa/security-findings.md',
                    description: 'a row no gate stands for'
                  }
                ]
              : actual(role, state, type)
        );
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // then:  the module does not load at all, and the refusal names the row it
      //        could not represent — the failure message, not merely a red
      expect(message).toBe(
        'pipeline-verify: the QA gate list does not follow the type tables — the "docs" table carries the QA prerequisite qa/security-findings.md and no gate in QA_EVIDENCE_GATES stands for it'
      );
    }
  );
});
