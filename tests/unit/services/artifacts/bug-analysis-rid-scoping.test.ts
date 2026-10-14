// tests/unit/services/artifacts/bug-analysis-rid-scoping.test.ts
//
// Guards `rid-bug-analysis-is-per-rid`.
//
// The defect: the bugfix planning artefact was required at the bare path
// `rd/bug-analysis.md`, so two slices of THAT type in one session shared one
// file. The workaround was worse than the collision — a producer escaping it
// declared a type it was not, and the type selects the prerequisite table, so a
// structural collision converted into a SILENTLY LIGHTER gate.
//
// So the assertions are deliberately not "the gate passes":
//   - the canonical name carries the request id, and the bare name survives as
//     the legacy tier (render)
//   - two slices of that type in ONE session each resolve their OWN file, and
//     neither is judged on the other's bytes (behavior) — the red-direction
//     input is the shared file itself, not a missing one
//   - a session holding only the bare file still clears `rd:implemented` (AC-3)
//   - the three readers that name the file OUTSIDE the table still resolve it:
//     the final-review segment matcher, the verify-pipeline probe name, and the
//     injected contract block (integration). A segment match fails by NOT
//     matching, so each of those arms asserts the positive — a resolved read —
//     rather than the absence of a complaint.
//
// Dimensions covered: render / behavior / integration.
// a11y omitted: this suite reads a resolver result envelope and a file path; it
// prints nothing and exits nothing.

import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { buildArtifactContractBlock } from '../../../../src/services/artifacts/artifact-contract-block.js';
import {
  checkPrerequisites,
  getPrerequisitesFor,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { readEvidence } from '../../../../src/services/final-review/final-review-evidence-collect.js';
import {
  contractEvidencePaths,
  rdGatesForType,
  resolveRdEvidencePaths
} from '../../../../src/services/workflow/pipeline-verify-gate-support.js';

import {
  codeReviewBody,
  karpathyBody,
  makeProjectRoot,
  missingPath,
  perfBody,
  posix,
  RID_A,
  RID_B,
  securityBody,
  SESSION_ID,
  tempRoots,
  writeArtifact
} from './_audit-artifact-rid-fixtures.js';
import { writeJudgedFixtureSource } from './_judged-declaration-fixture.js';

declareDimensions(
  'tests/unit/services/artifacts/bug-analysis-rid-scoping.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'resolver returns a result envelope and a path; prints nothing and exits nothing'
    }
  ]
);

/** The slice's own plan artefact name, built the way the table builds it. */
const BUG_ANALYSIS_RID_PATH = 'rd/bug-analysis-<rid>.md';
const BUG_ANALYSIS_BARE_PATH = 'rd/bug-analysis.md';

/** The literal the verify-pipeline probe map holds for this gate. Copied here
 *  on purpose: the point of the pin below is that THIS string still resolves
 *  through the table. Deriving it from the map would make the pin tautological. */
const PROBE_NAME_VERIFY_PIPELINE_HOLDS = 'rd/bug-analysis.md';

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** A body the gate must REJECT: the marker that makes it an analysis is absent,
 *  so a file that holds it cannot serve as this slice's evidence. */
function stubBody(rid: string): string {
  return `# Bug analysis (stub) — \`${rid}\`\n\nstill being written\n`;
}

function bugAnalysisBody(rid: string): string {
  return `# Bug analysis — \`${rid}\`\n\n## Root cause\n\n${rid} did it.\n\n## Fix approach\n\npin it.\n`;
}

/** The complete `rd:qa-handoff` set for a BUGFIX slice, at the rid-scoped
 *  locations only. Seeding the complete set is what lets an assertion be
 *  `ok === true` rather than "a name is absent" — an assertion on a string the
 *  resolver never emits is vacuously true. */
function seedBugfixSlice(projectRoot: string, rid: string): void {
  writeJudgedFixtureSource(projectRoot);
  writeArtifact(projectRoot, `rd/bug-analysis-${rid}.md`, bugAnalysisBody(rid));
  writeArtifact(projectRoot, `rd/code-review-${rid}.md`, codeReviewBody(rid));
  writeArtifact(
    projectRoot,
    `prd/handoff-${rid}.md`,
    '---\nschemaVersion: 2\nsha256: deadbeef\n---\n\n# Handoff\n'
  );
  writeArtifact(projectRoot, `audit/security-${rid}.md`, securityBody(rid));
  writeArtifact(projectRoot, `audit/perf-${rid}.md`, perfBody(rid));
  writeArtifact(projectRoot, `rd/karpathy-review-${rid}.md`, karpathyBody(rid));
  writeArtifact(projectRoot, `qa/test-cases/${rid}.md`, `## Test cases\n\ntest('x', () => {});\n`);
  writeArtifact(projectRoot, 'qa/.initiated', '');
}

async function bugfixGate(
  projectRoot: string,
  requestId: string,
  newState: 'implemented' | 'qa-handoff'
): Promise<{ missing: string[]; warnings: string[]; ok: boolean }> {
  const result = await checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd',
    newState,
    requestType: 'bugfix' as RequestType,
    requestId
  });
  return {
    missing: result.missing.map((entry) => entry.path),
    warnings: result.warnings.map((entry) => entry.path),
    ok: result.ok
  };
}

function bugAnalysisSource(projectRoot: string, rid: string) {
  const candidate = readEvidence(projectRoot, SESSION_ID, rid, false).find(
    (entry) => entry.source.key === 'rd-bug-analysis'
  );
  if (candidate === undefined) throw new Error('no rd-bug-analysis evidence source');
  return candidate;
}

describe('(render) the declared naming contract', () => {
  it('names the bugfix plan artefact with the request id, bare name as the legacy tier', () => {
    const prereqs = getPrerequisitesFor('rd', 'qa-handoff', 'bugfix');
    const bugAnalysis = prereqs.find(
      (candidate) => candidate.relativePath === BUG_ANALYSIS_RID_PATH
    );

    expect(bugAnalysis).toBeDefined();
    expect(bugAnalysis?.legacyRelativePath).toBe(BUG_ANALYSIS_BARE_PATH);
    // The plan artefact is the row this slice is about; the body contract that
    // makes it an analysis is unchanged by the move, so it is asserted here too
    // (a rename that dropped the markers would gate nothing).
    expect(bugAnalysis?.mustContain).toEqual(['## Root cause', '## Fix approach']);
  });

  it('is the row the type gate reads at rd:implemented, not a second copy', () => {
    // `rd:implemented` requires exactly this row, so the same rid substitution
    // reaches both transitions. Two rows would let the two states disagree.
    const implemented = getPrerequisitesFor('rd', 'implemented', 'bugfix');
    expect(implemented.map((prereq) => prereq.relativePath)).toEqual([BUG_ANALYSIS_RID_PATH]);
  });

  it('injects the rid-scoped name into the artefact contract block an RD receives', () => {
    const block = buildArtifactContractBlock({
      role: 'rd',
      requestType: 'bugfix',
      requestTypeSource: 'declared',
      requestId: RID_A
    });
    expect(block).toContain(`rd/bug-analysis-${RID_A}.md`);
    expect(block).not.toContain(BUG_ANALYSIS_BARE_PATH);
  });
});

describe('(behavior) two bugfix slices in one session', () => {
  it('lets both rids reach rd:qa-handoff, each on its OWN analysis file', async () => {
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_A);
    seedBugfixSlice(projectRoot, RID_B);

    const a = await bugfixGate(projectRoot, RID_A, 'qa-handoff');
    const b = await bugfixGate(projectRoot, RID_B, 'qa-handoff');

    expect(a.missing).toEqual([]);
    expect(b.missing).toEqual([]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it('does not judge a rid on the sibling slice whose analysis already existed', async () => {
    // The red-direction input is the COLLISION, not an absence: a session where
    // one slice's analysis is already on disk at the bare name, written by a
    // different request, and the current rid has its own file. Under the bare
    // canonical path the current rid resolved the sibling's bytes and passed on
    // them — which is the observed defect, and the reason the workaround was to
    // declare a type the slice was not.
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_A);
    seedBugfixSlice(projectRoot, RID_B);
    // The sibling's leftover at the pre-scoping name: a stub, so a run that
    // served it would report a BODY violation rather than silently agreeing.
    writeArtifact(projectRoot, BUG_ANALYSIS_BARE_PATH, stubBody(RID_A));

    const b = await bugfixGate(projectRoot, RID_B, 'qa-handoff');

    expect(b.missing).not.toContain(missingPath(BUG_ANALYSIS_RID_PATH, RID_B));
    expect(b.missing).toEqual([]);
  });

  it('still fails the rid whose own file does not satisfy the body contract', async () => {
    // The control on the same fixture: the resolution above must not be so
    // forgiving that it accepts anything. Write the CURRENT rid a stub at its
    // own name and the gate must name it.
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_A);
    seedBugfixSlice(projectRoot, RID_B);
    writeArtifact(projectRoot, `rd/bug-analysis-${RID_A}.md`, stubBody(RID_A));

    const a = await bugfixGate(projectRoot, RID_A, 'qa-handoff');
    const b = await bugfixGate(projectRoot, RID_B, 'qa-handoff');

    expect(a.missing).toContain(missingPath(BUG_ANALYSIS_RID_PATH, RID_A));
    expect(b.missing).toEqual([]);
  });
});

describe('(integration) the legacy tier and the readers outside the table', () => {
  it('clears rd:implemented for a session holding only the bare file', async () => {
    // The session on disk that predates the scoping. It still resolves, or the
    // upgrade would fail a transition on a file the producer was told to write.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, BUG_ANALYSIS_BARE_PATH, bugAnalysisBody(RID_A));

    const result = await bugfixGate(projectRoot, RID_A, 'implemented');

    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('resolves the final-review evidence reader to the rid-scoped file (the positive)', () => {
    // A segment match fails by NOT matching, and that looks like success. So
    // this asserts `read === 'ok'`, not "no complaint": a matcher still pinned
    // to the bare name reports `missing` here.
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_A);

    const candidate = bugAnalysisSource(projectRoot, RID_A);

    expect(candidate.read).toBe('ok');
    expect(candidate.relativePath).toBe(
      `.peaks/_runtime/${SESSION_ID}/rd/bug-analysis-${RID_A}.md`
    );
    expect(candidate.raw?.toString('utf8')).toContain(RID_A);
  });

  it('reads the rid its OWN analysis when both rids and a stale bare file are on disk', () => {
    // Three files, three bodies. Only a rid-scoped canonical segment returns
    // the CURRENT rid's bytes; a fall-through to the bare name returns the
    // stale one, and a fall-through to the sibling returns the sibling's.
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_A);
    seedBugfixSlice(projectRoot, RID_B);
    writeArtifact(projectRoot, BUG_ANALYSIS_BARE_PATH, stubBody(RID_A));

    for (const rid of [RID_A, RID_B]) {
      const candidate = bugAnalysisSource(projectRoot, rid);
      expect(candidate.read).toBe('ok');
      expect(candidate.relativePath).toBe(
        `.peaks/_runtime/${SESSION_ID}/rd/bug-analysis-${rid}.md`
      );
      expect(candidate.raw?.toString('utf8')).toContain(`${rid} did it.`);
    }
  });

  it('still reads the bare path when it is the only one there', () => {
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, BUG_ANALYSIS_BARE_PATH, bugAnalysisBody(RID_A));

    const candidate = bugAnalysisSource(projectRoot, RID_A);

    expect(candidate.read).toBe('ok');
    expect(candidate.relativePath).toBe(`.peaks/_runtime/${SESSION_ID}/${BUG_ANALYSIS_BARE_PATH}`);
  });

  it('pins the probe name verify-pipeline hard-codes against the table', () => {
    // `RD_EVIDENCE_PROBE['bug-analysis']` in pipeline-verify-gate-support.ts is
    // the literal pinned here. The map is not a second path table because
    // `contractEvidencePaths` is consulted with this name first — and that only
    // holds while the table still accepts the name. Drop the legacy tier and
    // this returns null, the map's literal stops resolving, and this fails.
    const paths = contractEvidencePaths(
      'rd',
      'qa-handoff',
      'bugfix',
      PROBE_NAME_VERIFY_PIPELINE_HOLDS
    );

    expect(paths).not.toBeNull();
    expect(paths?.[0]).toBe(BUG_ANALYSIS_RID_PATH);
    expect(paths?.slice(1)).toContain(BUG_ANALYSIS_BARE_PATH);
  });

  it('passes the bug-analysis gate over a rid-scoped file, with no legacy-form note', () => {
    // End to end through the reader the pin above protects: gate built, probe
    // mapped, path substituted, file resolved. `[LEGACY_EVIDENCE_PATH]` would
    // mean the bare tier served it, which for a freshly written slice is wrong.
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_A);

    const gates = rdGatesForType('bugfix');
    resolveRdEvidencePaths(gates, SESSION_ID, projectRoot, RID_A, 'bugfix', [], [], {
      anyEvidenceResolved: false,
      allResolvedPathsCanonical: true
    });

    const gate = gates.find((entry) => entry.name === 'bug-analysis');
    expect(gate?.passed).toBe(true);
    // `join()` yields backslashes on Windows, so the comparison normalises
    // separators first — an un-normalised `toContain` is always false there.
    expect(posix(gate?.detail ?? '')).toContain(`rd/bug-analysis-${RID_A}.md`);
    expect(gate?.detail).not.toContain('LEGACY_EVIDENCE_PATH');
  });

  it('fails the bug-analysis gate when only the sibling slice file exists', () => {
    // The control for the case above: same reader, same assertion shape, but
    // only the OTHER rid's file is on disk — so a resolver that matched any
    // `rd/bug-analysis*.md` would pass here and the positive arm would be
    // vacuous. `passed` must be false, and for THIS rid's path.
    const projectRoot = makeProjectRoot();
    seedBugfixSlice(projectRoot, RID_B);

    const gates = rdGatesForType('bugfix');
    resolveRdEvidencePaths(gates, SESSION_ID, projectRoot, RID_A, 'bugfix', [], [], {
      anyEvidenceResolved: false,
      allResolvedPathsCanonical: true
    });

    const gate = gates.find((entry) => entry.name === 'bug-analysis');
    expect(gate?.passed).toBe(false);
    expect(posix(gate?.detail ?? '')).toContain(`rd/bug-analysis-${RID_A}.md`);
  });
});
