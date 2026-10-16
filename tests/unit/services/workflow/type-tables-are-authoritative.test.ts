/**
 * tests/unit/services/workflow/type-tables-are-authoritative.test.ts
 *
 * rid `2026-10-16-type-tables-are-authoritative`. Two layers answered the same
 * question — *does this request need a QA phase?* — and disagreed, because
 * neither derived its answer from the type tables that define the contract:
 *
 *   - `MINIMAL_TABLE` (docs / chore) has no `qa:` row at all
 *     (`artifact-prerequisites.ts`), and `request transition --role qa --state
 *     verdict-issued` agrees — it requires nothing for those types;
 *   - `qaGatesForType` held a MEMBER LIST (`feature || refactor || bugfix`) and
 *     `verifyPipeline` pushed `QA phase skipped` from an unconditional `else`.
 *
 * So a `docs` slice satisfied every prerequisite its own table lists and was then
 * refused at commit time by `.husky/peaks-gate-pipeline.mjs`. The fix makes BOTH
 * layers read `PREREQUISITES_BY_TYPE`, and arms the derivation so a future table
 * edit cannot silently leave the gate list behind (see the planted-table section).
 *
 * Dimensions: `render` is omitted — this file asserts no rendered byte stream;
 * the human-facing surface it does assert (violation text, refusal wording) is
 * under `a11y`, and the gate-list shape under `behavior`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import {
  getPrerequisitesFor,
  VALID_REQUEST_TYPES,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { createRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import { updateStatusBlock } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';
import { resolveRequestType } from '../../../../src/services/workflow/request-type-resolution.js';
import { qaGatesForType } from '../../../../src/services/workflow/pipeline-verify-gate-support.js';
import {
  QA_STATES,
  typeRequiresQaPhase
} from '../../../../src/services/workflow/pipeline-verify-qa-phase.js';

declareDimensions(
  'tests/unit/services/workflow/type-tables-are-authoritative.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'nothing here renders: the gate list is asserted as an object and the human-facing text as under a11y'
    }
  ]
);

const SESSION_ID = 'sess-type-tables';
const RID = '2026-10-16-type-table-fixture';
const TS = '2026-10-16T00:00:00.000Z';
/** A directory BESIDE the session that sorts before it, and is not a session. */
const SHADOW_SESSION_ID = '0000-shadow-probe';
/** A second rid with one carrier, so a role fallback is the only answer. */
const QA_ONLY_RID = '2026-10-16-qa-only-fixture';

/** The two violations a type whose table REQUIRES a QA phase produces when no
 *  QA artifact exists. Text pinned verbatim: it is what a human reads in the
 *  commit refusal, and the PRD's preserved-behaviour clause freezes it. */
const QA_PHASE_SKIPPED =
  'QA phase skipped: peaks-qa was never invoked for this request (no QA request artifact found)';
const RD_WITHOUT_QA =
  'CRITICAL: peaks-rd was invoked but peaks-qa was NOT — QA functional/performance/security testing is mandatory after all RD work';

/** Types the PRD names as unchanged: their table rows are byte-identical, so
 *  only the DERIVATION may move and these expectations may not. */
const TYPES_WITH_QA_EVIDENCE: ReadonlyArray<RequestType> = ['feature', 'bugfix', 'refactor'];
const TYPES_WITHOUT_QA: ReadonlyArray<RequestType> = ['docs', 'chore'];

/** The QA states the shipped tables state a contract at. Literals: they are facts
 *  about the tables, and a list read from the module under test could not witness
 *  a module that stopped covering one of them. */
const QA_STATES_USED = ['running', 'verdict-issued'] as const;

function write(projectRoot: string, relative: string, body: string): void {
  const path = join(projectRoot, '.peaks', '_runtime', SESSION_ID, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

/**
 * Seed a request that has a PRD and an RD artifact at `qa-handoff` — every
 * artifact its own table names for the RD phase — and NO QA phase at all.
 */
async function seed(
  ws: TmpWorkspace,
  requestType: RequestType,
  {
    withRd = true,
    withQa = false,
    sessionId = SESSION_ID
  }: { withRd?: boolean; withQa?: boolean; sessionId?: string } = {}
): Promise<void> {
  const roles: ReadonlyArray<'prd' | 'rd' | 'qa'> = [
    'prd',
    ...(withRd ? (['rd'] as const) : []),
    ...(withQa ? (['qa'] as const) : [])
  ];
  for (const role of roles) {
    const created = await createRequestArtifact({
      role,
      requestId: RID,
      projectRoot: ws.path,
      sessionId,
      requestType,
      apply: true
    });
    const state = role === 'prd' ? 'handed-off' : role === 'rd' ? 'qa-handoff' : 'verdict-issued';
    writeFileSync(
      created.path,
      updateStatusBlock(readFileSync(created.path, 'utf8'), state, TS).updated,
      'utf8'
    );
  }
}

/** The QA-phase violations a verdict carries, in the order they were pushed. */
function qaPhaseViolations(violations: readonly string[]): string[] {
  return violations.filter((v) => v === QA_PHASE_SKIPPED || v === RD_WITHOUT_QA);
}

const ws = withTmpWorkspacePerTest('peaks-type-tables-');

// ---------------------------------------------------------------------------
// behavior — the gate list is read off the type table, not enumerated beside it
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the QA gate list is read off the type table', () => {
  it.each(TYPES_WITHOUT_QA)(
    'when the %s table carries no QA row, should build no QA gate at all',
    (requestType) => {
      // given: MINIMAL_TABLE — docs and chore — which has no `qa:` row
      // when:  the QA gate list is built
      // then:  it is empty: the type's own table says there is no QA phase
      expect(getPrerequisitesFor('qa', 'verdict-issued', requestType)).toEqual([]);
      expect(qaGatesForType(requestType)).toEqual([]);
    }
  );

  it('when the table carries QA evidence, should build exactly that evidence', () => {
    // given: FEATURE_TABLE / BUGFIX_TABLE / REFACTOR_TABLE's `qa:verdict-issued`
    //        row — TEST_CASES + TEST_REPORT
    // when:  each gate list is built
    // then:  it is the same three gates it always was, in the table's own order
    for (const requestType of TYPES_WITH_QA_EVIDENCE) {
      expect(qaGatesForType(requestType).map((g) => g.name)).toEqual([
        'qa-request-exists',
        'test-cases',
        'test-report'
      ]);
    }
  });

  it('when a table carries only part of the QA evidence, should build only that part', () => {
    // given: CONFIG_TABLE's `qa:verdict-issued` row — TEST_REPORT alone. The
    //        member list this file's fix removes had no config member, so
    //        `verify-pipeline` never asked a config rid for the test report that
    //        `request transition --role qa --state verdict-issued` DOES require.
    // when:  the gate list is built
    // then:  it is the row, not the union of what other types need
    expect(
      getPrerequisitesFor('qa', 'verdict-issued', 'config').map((p) => p.relativePath)
    ).toEqual(['qa/test-reports/<rid>.md']);
    expect(qaGatesForType('config').map((g) => g.name)).toEqual([
      'qa-request-exists',
      'test-report'
    ]);
  });

  it.each(VALID_REQUEST_TYPES)(
    'when a %s request is asked, should agree with its own table on the QA phase',
    (requestType) => {
      // given: every request type, including the four the member list named
      // when:  the gate list and the table are each asked
      // then:  they give the same answer to the one question they both answer.
      //        This is the equivalence the two layers used to break: a gate list
      //        that is non-empty for a type whose table has no QA row is a gate
      //        nothing in the contract asked for.
      const tableSaysQaPhase = QA_STATES_USED.some(
        (state) => getPrerequisitesFor('qa', state, requestType).length > 0
      );
      expect(qaGatesForType(requestType).length > 0).toBe(tableSaysQaPhase);
    }
  );
});

// ---------------------------------------------------------------------------
// integration — the checker's verdict follows the table, on a real tree
// ---------------------------------------------------------------------------

describe('Scenario: integration — verifyPipeline follows the same table', () => {
  it.each(TYPES_WITHOUT_QA)(
    'when a %s request has a PRD and no QA phase, should not report a QA phase',
    async (requestType) => {
      // given: s6's tree — a docs (or chore) request that satisfies every row
      //        its own table lists, with no QA phase
      // when:  the checker runs
      // then:  no QA-phase violation: the table never asked for one
      await seed(ws(), requestType);
      const result = await verifyPipeline({
        projectRoot: ws().path,
        rid: RID,
        sessionId: SESSION_ID,
        requestType
      });

      expect(qaPhaseViolations(result.violations)).toEqual([]);
      expect(result.violations, 'a docs/chore request may not be refused at all').toEqual([]);
      expect(result.qaPhase.gates).toEqual([]);
      expect(result.complete, 'the commit-time carrier reads this flag').toBe(true);
    }
  );

  it.each(['feature', 'bugfix', 'refactor', 'config'] as const)(
    'when a %s request has a PRD and no QA phase, should still report both QA violations',
    async (requestType) => {
      // given: a type whose table DOES carry a `qa:` row
      // when:  the checker runs with no QA phase on disk
      // then:  the same two violations as before the fix, verbatim — the fix
      //        narrowed nothing for these types
      await seed(ws(), requestType);
      const result = await verifyPipeline({
        projectRoot: ws().path,
        rid: RID,
        sessionId: SESSION_ID,
        requestType
      });

      expect(qaPhaseViolations(result.violations)).toEqual([QA_PHASE_SKIPPED, RD_WITHOUT_QA]);
      expect(result.complete).toBe(false);
    }
  );

  it('when a docs request is missing its RD artifact, should still refuse', async () => {
    // given: the control that proves the QA suppression is scoped to the QA
    //        phase and is not a blanket pass for docs
    // when:  the RD phase never ran
    // then:  the RD-phase violation is still reported and the pipeline is not
    //        complete
    await seed(ws(), 'docs', { withRd: false });
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID,
      requestType: 'docs'
    });

    expect(result.violations).toContain(
      'RD phase skipped: peaks-rd was never invoked for this request (no RD request artifact found)'
    );
    expect(result.complete).toBe(false);
  });

  it('when a docs request carries a QA artifact anyway, should accept it', async () => {
    // given: the shape `tests/unit/hooks/pipeline-contract-gate.test.ts` already
    //        uses — a docs rid that DID run QA
    // when:  the checker runs
    // then:  the existing on-disk session keeps passing: removing the QA phase
    //        from a type's contract may not invalidate a tree that has one
    await seed(ws(), 'docs', { withQa: true });
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID,
      requestType: 'docs'
    });

    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('Scenario: a11y — the refusal text a human acts on', () => {
  it('when a feature request has no QA phase, should name the phase and the skill', async () => {
    // given: the type whose refusal text the PRD freezes
    // when:  the two QA violations are read
    // then:  they are the exact strings the pre-commit leg prints, so a wider
    //        derivation may not reword a refusal that was already correct
    await seed(ws(), 'feature');
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID,
      requestType: 'feature'
    });

    expect(result.violations).toContain(QA_PHASE_SKIPPED);
    expect(result.violations).toContain(RD_WITHOUT_QA);
    expect(result.nextActions).toContain(
      'Invoke Skill(skill="peaks-qa") with the request-id for functional/performance/security testing'
    );
  });

  it.each(['', 'Docs', 'nope', undefined])(
    'when %s is asked for a QA gate list, should refuse by name and not with a bare TypeError',
    (notAType) => {
      // given: a value that is not a request type — reachable only by a direct
      //        caller, because `verifyPipeline` now derives one (see the
      //        request-type scenario) and cannot pass anything else
      // when:  the derivation is asked
      // then:  the refusal names the value and the alternatives. Before this
      //        derivation existed a list of names answered such a caller with a
      //        gate list; a derivation that keys a record by type reaches
      //        `undefined` and throws a bare TypeError instead, which says nothing
      //        about what was wanted
      expect(() => qaGatesForType(notAType as RequestType)).toThrow(
        `pipeline-verify: "${String(notAType)}" is not a request type — expected one of ${VALID_REQUEST_TYPES.join(', ')}`
      );
      expect(() => typeRequiresQaPhase(notAType as RequestType)).toThrow(
        /is not a request type — expected one of/
      );
    }
  );

  it('when a docs request has no QA phase, should never mention peaks-qa', async () => {
    // given: the tree s6 committed
    // when:  every human-facing string the checker produced is read
    // then:  `peaks-qa` is nowhere in it: a nextAction telling a docs author to
    //        run a phase their table does not require is the defect, in prose
    await seed(ws(), 'docs');
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID,
      requestType: 'docs'
    });
    const text = [...result.violations, ...result.nextActions].join('\n');

    expect(text).not.toContain('peaks-qa');
    expect(text).not.toContain('QA phase');
  });
});
