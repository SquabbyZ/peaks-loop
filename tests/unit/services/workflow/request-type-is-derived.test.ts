// tests/unit/services/workflow/request-type-is-derived.test.ts
//
// rid `2026-10-16-type-tables-are-authoritative`. WHICH TYPE a rid is checked AS —
// split out of `type-tables-are-authoritative.test.ts` for the file-size cap (a new
// file over the 500-line tests cap GROWS from 0, which
// `tests/unit/lint/staged-size-leg.test.ts` refuses).
//
// WHY THIS IS ITS OWN SUBJECT. The gap these arms close was the same defect one
// layer above the gate list: `verifyPipeline` took the type as an option and fell
// back to `feature`, and the two callers that matter both left it absent — the CLI
// passed its own option default, and `slice-check` never passed it — so the CHECKER
// read every rid as a feature one while the commit leg read the rid's own `- type:`
// line and got it right. On one docs tree that meant three RD-evidence violations
// and `complete: false` from the CLI, against a satisfied contract from the leg.
//
// AND WHY THE SCOPE IS ARMED HERE TOO. Deriving the type from the rid's carrier
// while scanning every directory under `.peaks/_runtime/` handed the gate table to
// whichever directory sorted first, so the arms below include the two-session
// fixture that this reading needs: a carrier outside the session being read is not
// this rid's carrier.
//
// Dimensions: `render` and `a11y` are omitted — nothing here renders, and the only
// human-facing string involved (the non-member refusal) is asserted in the sibling
// file that owns the a11y arms.
//

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import { type RequestType } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { createRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import { updateStatusBlock } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';
import { resolveRequestType } from '../../../../src/services/workflow/request-type-resolution.js';

declareDimensions(
  'tests/unit/services/workflow/request-type-is-derived.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'nothing here renders: the arms assert a derived type and a verdict object'
    },
    {
      dim: 'a11y',
      reason:
        'the only human-facing string here (the non-member refusal) is asserted in type-tables-are-authoritative.test.ts'
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

/** The two violations a type whose table REQUIRES a QA phase produces when no QA
 *  artifact exists. Text pinned verbatim: it is what a human reads in the commit
 *  refusal, and the PRD's preserved-behaviour clause freezes it. */
const QA_PHASE_SKIPPED =
  'QA phase skipped: peaks-qa was never invoked for this request (no QA request artifact found)';
const RD_WITHOUT_QA =
  'CRITICAL: peaks-rd was invoked but peaks-qa was NOT — QA functional/performance/security testing is mandatory after all RD work';

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

function qaPhaseViolations(violations: readonly string[]): string[] {
  return violations.filter((v) => v === QA_PHASE_SKIPPED || v === RD_WITHOUT_QA);
}

const ws = withTmpWorkspacePerTest('peaks-type-tables-');

// ---------------------------------------------------------------------------
// integration — the request TYPE is derived from the rid, not defaulted
//
// The gap this closes was the same defect one layer up: `verifyPipeline` took the
// type as an option and fell back to `feature`, and the two callers that matter
// both left it absent — so the CHECKER read every rid as a feature one while the
// commit-time carrier read the rid's own `- type:` line and got it right. On one
// docs tree that meant `verify-pipeline` reported three RD-evidence violations and
// `complete: false` while the same invocation with `--type docs` — and the commit
// leg — reported the contract satisfied.
// ---------------------------------------------------------------------------

describe('Scenario: integration — the request type is derived from the rid', () => {
  it('when a docs request is checked with no type given, should read it as docs and complete', async () => {
    // given: the reproduction, in-process — a docs rid on disk, no `--type`
    // when:  the checker is asked
    // then:  it reads the rid's own record instead of defaulting
    await seed(ws(), 'docs');
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID
    });

    expect(result.requestType).toBe('docs');
    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('when a feature request is checked with no type given, should read it as feature and still refuse', async () => {
    // given: the arm that proves the derivation narrows nothing — no QA phase,
    //        and a type whose table requires one
    // when:  the checker is asked with no type
    // then:  the same two QA violations as when the type is passed explicitly
    await seed(ws(), 'feature');
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID
    });

    expect(result.requestType).toBe('feature');
    expect(qaPhaseViolations(result.violations)).toEqual([QA_PHASE_SKIPPED, RD_WITHOUT_QA]);
    expect(result.complete).toBe(false);
  });

  it('when an explicit type is passed, should override what the rid declares', async () => {
    // given: `--type` stays the explicit override — that is what the flag is for
    // when:  a docs rid is checked AS a feature one
    // then:  the override wins over the artifact
    await seed(ws(), 'docs');
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID,
      requestType: 'feature'
    });

    expect(result.requestType).toBe('feature');
    expect(result.complete).toBe(false);
  });

  it('when a typo is passed as the type, should fall through to the rid, not select a table', async () => {
    // given: a caller that misspells the flag value
    // when:  a docs rid is checked with `--type Docs`
    // then:  the unusable value is not an override: the artifact answers
    await seed(ws(), 'docs');
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: RID,
      sessionId: SESSION_ID,
      requestType: 'Docs'
    });

    expect(result.requestType).toBe('docs');
  });

  it('when a bare directory beside the session sorts first, should not let it choose the type', async () => {
    // given: the rid in its own session, and beside it a directory whose name
    //        sorts FIRST whose only content is a carrier declaring another type.
    //        Nothing else reads that directory — the commit leg enumerates the
    //        canonical session dir and nothing else — so a reader that scans every
    //        directory under `.peaks/_runtime/` hands the gate table to whoever
    //        can create a file there.
    // when:  the checker is asked, scoped to the rid's own session
    // then:  the verdict is the one the rid's own carrier gives: the shadow is
    //        not a session, and a carrier outside the session being read is not
    //        this rid's carrier. THE SCOPE has to match the leg's, not just the
    //        order of the carrier directories.
    await seed(ws(), 'docs');
    const scoped = { projectRoot: ws().path, rid: RID, sessionId: SESSION_ID };
    expect((await verifyPipeline(scoped)).requestType).toBe('docs');

    const shadow = join(
      ws().path,
      '.peaks',
      '_runtime',
      SHADOW_SESSION_ID,
      'rd',
      'requests',
      `${RID}.md`
    );
    mkdirSync(dirname(shadow), { recursive: true });
    writeFileSync(shadow, '- type: feature\n', 'utf8');

    const after = await verifyPipeline(scoped);
    expect(after.requestType, 'a bare directory beside the session chose the table').toBe('docs');
    expect(after.complete).toBe(true);
    expect(after.violations).toEqual([]);
  });

  it('when the rid has only a PRD carrier, should read the type from it', async () => {
    // given: the `prd` branch of the carrier order — two thirds of this resolver
    //        were otherwise never the type source in any arm
    // when:  the resolver is asked directly
    // then:  the PRD carrier answers
    await seed(ws(), 'refactor', { withRd: false });
    await expect(
      resolveRequestType({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID })
    ).resolves.toBe('refactor');
  });

  it('when the rid has only a QA carrier, should read the type from it', async () => {
    // given: the `qa` branch — the last fallback, reachable only for a rid whose
    //        RD and PRD records are absent
    // when:  the resolver is asked directly
    // then:  the QA carrier answers
    const created = await createRequestArtifact({
      role: 'qa',
      requestId: QA_ONLY_RID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      requestType: 'chore',
      apply: true
    });
    expect(created.path.endsWith(`${QA_ONLY_RID}.md`)).toBe(true);
    await expect(
      resolveRequestType({ projectRoot: ws().path, rid: QA_ONLY_RID, sessionId: SESSION_ID })
    ).resolves.toBe('chore');
  });

  // THE ACCEPTANCE ARM FOR AN UNRESOLVABLE SCOPE, in both shapes a shadow can take.
  //
  // An earlier version of this arm could not fail: it named its shadow
  // `0000-shadow-probe`, then asserted that a RECOGNISED session answers — so it
  // passed for the reason it claimed to test while the thing it named went
  // untested. "Recognised" is a directory NAME (`/^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$/`)
  // and `discoverSessions` sorts ascending, so a writer-chosen name decided the
  // table; and the carrier lookup in this posture passed no scope at all, so it
  // scanned every directory. Both are exercised here, against a verdict that must
  // not move.
  const UNBOUND_RID = '2026-10-16-unbound-fixture';

  /** The rid's own record, in a directory the repository does NOT recognise and
   *  no binding names: the unbound posture a fresh clone or worktree starts in. */
  async function seedUnbound(): Promise<void> {
    const created = await createRequestArtifact({
      role: 'rd',
      requestId: UNBOUND_RID,
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      requestType: 'docs',
      apply: true
    });
    writeFileSync(
      created.path,
      updateStatusBlock(readFileSync(created.path, 'utf8'), 'spec-locked', TS).updated,
      'utf8'
    );
  }

  function writeShadow(sessionId: string, body: string): void {
    const path = join(
      ws().path,
      '.peaks',
      '_runtime',
      sessionId,
      'rd',
      'requests',
      `${UNBOUND_RID}.md`
    );
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, 'utf8');
  }

  const verdictOf = async (): Promise<unknown> => {
    const result = await verifyPipeline({ projectRoot: ws().path, rid: UNBOUND_RID });
    return { r: result.requestType, c: result.complete, v: result.violations };
  };

  it.each([
    ['a recognised name', '0000-01-01-session-aaaa', '- type: docs\n- state: qa-handoff\n'],
    ['a bare directory', SHADOW_SESSION_ID, '- type: docs\n- state: qa-handoff\n']
  ])(
    'when no session resolves and a shadow is %s, should not let it change the verdict',
    async (_shape, shadowSession, body) => {
      // given: the unbound posture, and the verdict it gives with nothing beside it
      await seedUnbound();
      const baseline = await verdictOf();

      // when:  a carrier for this rid appears in a directory the binding does not
      //        name — one the repository recognises by name, one it does not, both
      //        declaring a type AND a state the rid's own record does not
      writeShadow(shadowSession, body);

      // then:  the verdict is byte-identical. A scope that cannot be resolved is
      //        not a licence to read every directory: the answer has to be the
      //        same with the shadow as without it, and it has to be the
      //        fail-closed one
      expect(await verdictOf()).toEqual(baseline);
      expect(baseline).toMatchObject({ c: false });
    }
  );

  it('when a directory is named after the rid, should not let it supply the evidence', async () => {
    // given: the unbound posture, and the verdict it gives with nothing beside it
    await seedUnbound();
    const baseline = await verdictOf();

    // when:  a directory named after the RID — not a session — holds a full
    //        evidence set. `rdEvidenceDir` falls back to the rid when no scope
    //        resolves, so this is the one directory a shadow can still occupy
    //        after the type and carrier halves were scoped
    for (const [relative, body] of [
      [`prd/handoff-${UNBOUND_RID}.md`, 'schemaVersion: 2\nsha256: 0000\n'],
      [`rd/code-review-${UNBOUND_RID}.md`, '# Code review\n\n## Findings\n\nCRITICAL: none\n'],
      [`audit/security-${UNBOUND_RID}.md`, '# Security audit\n\n## Verdict\n\nPASS\n'],
      [`audit/perf-${UNBOUND_RID}.md`, '# Perf audit\n\n## Baseline\n\nn/a\n'],
      [`qa/test-cases/${UNBOUND_RID}.md`, '# Test cases\n\n## Test cases\n\ntest(x)\n'],
      [`qa/test-reports/${UNBOUND_RID}.md`, '# Test report\n\n## Test execution\n\nall green\n']
    ] as const) {
      const path = join(ws().path, '.peaks', '_runtime', UNBOUND_RID, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, 'utf8');
    }

    // then:  the verdict is byte-identical: no scope means NO evidence is read,
    //        and a rid-derived directory name is not a scope
    expect(await verdictOf()).toEqual(baseline);
    expect(baseline).toMatchObject({ c: false });
  });

  it('when the rid has no artifact at all, should keep the fail-closed default', async () => {
    // given: a rid nothing has written yet — the derivation has nothing to read
    // when:  the checker is asked
    // then:  the heaviest table still applies, so a missing artifact cannot read
    //        as "no gates"
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: '2026-10-16-rid-with-no-artifact',
      sessionId: SESSION_ID
    });

    expect(result.requestType).toBe('feature');
    expect(result.complete).toBe(false);
  });
});
