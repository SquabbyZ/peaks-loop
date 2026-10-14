// tests/unit/services/artifacts/security-review-rid-scoping.test.ts
//
// Guards backlog 9.37 — the `config` type's security review is per-rid.
//
// The defect: `SECURITY_REVIEW.relativePath` was the bare `rd/security-review.md`,
// the only `rd:qa-handoff` row for `config`. Two config slices in one session wrote
// the same file, the second overwrote the first, and BOTH transitions passed —
// because the row declares no `mustContain` / `mustContainAny` / `headingMustContain`,
// so the gate only ever asks whether the file EXISTS. Slice 2 was then judged by a
// security review of slice 1's diff, and nothing in the artifact or the gate said so.
// That is strictly worse than 9.36's instance, which collided on a file whose body
// the gate does read.
//
// So the assertions are deliberately not "the gate passes":
//   - the canonical name carries the rid and the bare name survives as the legacy
//     tier (render), read off the table rather than copied from it
//   - the row still pins NO body markers — that is *why* the collision was silent,
//     so a later slice that adds a marker has to confront this case
//   - two config slices in one session each resolve their OWN review (behavior)
//   - the red direction is the COLLISION, not an absence: a session holding a
//     stale bare review and one rid's scoped review must leave the OTHER rid
//     unresolved. Under the bare canonical path that rid resolved the stale file
//     and passed, which is the observed defect.
//   - a session holding only the bare file still clears `rd:qa-handoff` (legacy
//     tier), and the two readers that name the file OUTSIDE the table still
//     resolve it: the final-review segment matcher and the judged-declaration
//     tier list. A segment match fails by NOT matching, which looks like success,
//     so those arms assert the positive — a resolved read — not the absence of a
//     complaint.
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
  type ArtifactPrerequisite,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { securityArtifactTiers } from '../../../../src/services/audit-independent/judged-declaration-check.js';
import { readEvidence } from '../../../../src/services/final-review/final-review-evidence-collect.js';
import { deriveGateEvidence } from '../../../../src/services/prd/gate-evidence-derivation.js';

import {
  makeProjectRoot,
  missingPath,
  posix,
  RID_A,
  RID_B,
  securityBody,
  SESSION_ID,
  tempRoots,
  writeArtifact
} from './_audit-artifact-rid-fixtures.js';

declareDimensions(
  'tests/unit/services/artifacts/security-review-rid-scoping.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'resolver returns a result envelope and a path; prints nothing and exits nothing'
    }
  ]
);

/** The pre-scoping location the v2.11.x sessions on disk still hold. */
const BARE_SECURITY_REVIEW = 'rd/security-review.md';

/** The scoped name for one rid, built from the rid on purpose.
 *
 *  A literal copied out of the table would drift from the row it is meant to
 *  pin, and — worse — an expectation READ from the table moves with it: reverting
 *  `relativePath` would move the expectation too and every arm would stay green.
 *  Building it from the rid is what makes the behavior arms below go red when the
 *  row is reverted. The render arm is the one that reads the table, and it asserts
 *  a property (`<rid>` present) rather than an equality with a derived value. */
function scopedSecurityReview(rid: string): string {
  return `rd/security-review-${rid}.md`;
}

/** The `config` row's security prerequisite, read off the real table. */
function configSecurityPrerequisite(): ArtifactPrerequisite {
  const row = getPrerequisitesFor('rd', 'qa-handoff', 'config');
  if (row.length !== 1) throw new Error(`config rd:qa-handoff row holds ${row.length} prereqs`);
  return row[0]!;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Seed ONLY the artifact the `config` row requires, at `relativePath`.
 *  Nothing else: config's `rd:qa-handoff` row is `[SECURITY_REVIEW]` alone — no
 *  handoff capsule, no code review, no test cases — so seeding more would let a
 *  failure be blamed on something other than the row under test. */
function seedConfigSecurityReview(projectRoot: string, relativePath: string, rid: string): void {
  writeArtifact(projectRoot, relativePath, securityBody(rid));
}

async function configGate(
  projectRoot: string,
  requestId: string
): Promise<{ missing: string[]; warnings: string[]; ok: boolean }> {
  const result = await checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestType: 'config' as RequestType,
    requestId
  });
  return {
    missing: result.missing.map((entry) => entry.path),
    warnings: result.warnings.map((entry) => entry.path),
    ok: result.ok
  };
}

function securityReviewSource(projectRoot: string, rid: string) {
  const candidate = readEvidence(projectRoot, SESSION_ID, rid, false).find(
    (entry) => entry.source.key === 'rd-security-review'
  );
  if (candidate === undefined) throw new Error('no rd-security-review evidence source');
  return candidate;
}

describe('(render) the declared naming contract', () => {
  it('names the config security review with the request id, bare name as the legacy tier', () => {
    const prereq = configSecurityPrerequisite();

    // The rid is what separates two config slices in one session. Asserted as a
    // property, not against a value read back out of the same field.
    expect(prereq.relativePath).toContain('<rid>');
    expect(prereq.relativePath.replace('<rid>', RID_A)).toBe(scopedSecurityReview(RID_A));
    expect(prereq.legacyRelativePath).toBe(BARE_SECURITY_REVIEW);
  });

  it('still declares no body markers, which is why the collision was silent', () => {
    // This is the fact that made 9.37 worse than 9.36: the gate asks whether the
    // file exists and never opens it, so an overwritten review cannot be detected
    // by this row at all. Adding a marker later is a real change; this case makes
    // it a deliberate one.
    const prereq = configSecurityPrerequisite();

    expect(prereq.mustContain).toBeUndefined();
    expect(prereq.mustContainAny).toBeUndefined();
    expect(prereq.headingMustContain).toBeUndefined();
  });

  it('is the ONLY artifact the config type requires at rd:qa-handoff', () => {
    const relativePaths = getPrerequisitesFor('rd', 'qa-handoff', 'config').map(
      (prereq) => prereq.relativePath
    );

    expect(relativePaths).toEqual([configSecurityPrerequisite().relativePath]);
  });

  it('injects the rid-scoped name into the artefact contract block an RD receives', () => {
    const block = buildArtifactContractBlock({
      role: 'rd',
      requestType: 'config',
      requestTypeSource: 'declared',
      requestId: RID_A
    });

    expect(block).toContain(scopedSecurityReview(RID_A));
    expect(block).not.toContain(BARE_SECURITY_REVIEW);
  });

  it('declares the rid-scoped path in the config capsule gateEvidence map', () => {
    const evidence = deriveGateEvidence({
      sessionId: SESSION_ID,
      requestId: RID_A,
      requestType: 'config'
    });

    expect(posix(evidence.securityReview ?? '')).toContain(scopedSecurityReview(RID_A));
  });
});

describe('(behavior) two config slices in one session', () => {
  it('lets both rids reach rd:qa-handoff, each on its OWN security review', async () => {
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_A), RID_A);
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_B), RID_B);

    const a = await configGate(projectRoot, RID_A);
    const b = await configGate(projectRoot, RID_B);

    expect(a.missing).toEqual([]);
    expect(b.missing).toEqual([]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it('still lets the bare review serve ANY rid — the accepted cost of the legacy tier', async () => {
    // Measured, not assumed, and recorded because it bounds what this slice fixed.
    // The legacy tier resolves `rd/security-review.md` for whatever rid asks, so a
    // session that still carries a bare review is served exactly as before. The
    // collision is closed at the PRODUCER (which now writes the scoped name) and
    // at the ordering (the scoped file wins when both exist) — not by refusing the
    // tier, which is what keeps every session already on disk working. Removing
    // this tier is the deferred question the PRD records; it is not in scope here.
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, BARE_SECURITY_REVIEW, RID_A);

    const b = await configGate(projectRoot, RID_B);

    expect(b.ok).toBe(true);
    expect(b.missing).toEqual([]);
  });

  it('passes each rid on its own file even with a stale bare review present', async () => {
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_A), RID_A);
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_B), RID_B);
    seedConfigSecurityReview(projectRoot, BARE_SECURITY_REVIEW, RID_A);

    const a = await configGate(projectRoot, RID_A);
    const b = await configGate(projectRoot, RID_B);

    expect(a.missing).toEqual([]);
    expect(b.missing).toEqual([]);
  });

  it('still fails the rid whose own review is absent when only the sibling has one', async () => {
    // The control on the arm above: resolution must not become so forgiving that
    // any `rd/security-review*.md` satisfies it. Only A wrote a review, so only A
    // may pass, and B's failure must name B's own path.
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_A), RID_A);

    const b = await configGate(projectRoot, RID_B);

    expect(b.ok).toBe(false);
    expect(b.missing).toEqual([missingPath('rd/security-review-<rid>.md', RID_B)]);
  });
});

describe('(integration) the legacy tier and the readers outside the table', () => {
  it('clears rd:qa-handoff for a session holding only the bare review', async () => {
    // The session on disk that predates the scoping. It still resolves, or the
    // upgrade would fail a transition on the file the producer was told to write.
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, BARE_SECURITY_REVIEW, RID_A);

    const result = await configGate(projectRoot, RID_A);

    expect(result.missing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('resolves the final-review evidence reader to the rid-scoped review (the positive)', () => {
    // A segment matcher fails by NOT matching, and that looks like success. So
    // this asserts `read === 'ok'` against a session that holds ONLY the scoped
    // file: a source still pinned to the bare name reports `missing` here.
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_A), RID_A);

    const candidate = securityReviewSource(projectRoot, RID_A);

    expect(candidate.read).toBe('ok');
    expect(candidate.relativePath).toBe(
      `.peaks/_runtime/${SESSION_ID}/${scopedSecurityReview(RID_A)}`
    );
    expect(candidate.raw?.toString('utf8')).toContain(RID_A);
  });

  it('still reads the bare review when it is the only one there', () => {
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, BARE_SECURITY_REVIEW, RID_A);

    const candidate = securityReviewSource(projectRoot, RID_A);

    expect(candidate.read).toBe('ok');
    expect(candidate.relativePath).toBe(`.peaks/_runtime/${SESSION_ID}/${BARE_SECURITY_REVIEW}`);
  });

  it('reads each rid its OWN review when both rids and a stale bare review are on disk', () => {
    // The arm the `missing` list above cannot give: a resolved path names WHICH
    // file served the rid. Three files, three bodies — only a rid-scoped tier
    // returns the CURRENT rid's bytes. A fall-through to the bare legacy file
    // returns the stale one, and a fall-through to the sibling returns the
    // sibling's, which is the collision this slice exists to remove.
    const projectRoot = makeProjectRoot();
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_A), RID_A);
    seedConfigSecurityReview(projectRoot, scopedSecurityReview(RID_B), RID_B);
    seedConfigSecurityReview(projectRoot, BARE_SECURITY_REVIEW, RID_A);

    for (const rid of [RID_A, RID_B]) {
      const candidate = securityReviewSource(projectRoot, rid);
      expect(candidate.read).toBe('ok');
      expect(candidate.relativePath).toBe(
        `.peaks/_runtime/${SESSION_ID}/${scopedSecurityReview(rid)}`
      );
      expect(candidate.raw?.toString('utf8')).toContain(rid);
    }
  });

  it('keeps the rid-scoped review ahead of the bare one in the judged-declaration tiers', () => {
    // `resolveSecurityArtifact` returns the FIRST tier that exists and then asks
    // that file to declare the paths it judged. Drop the scoped tier and a config
    // slice falls through to a different slice's bare review — and, when none is
    // there at all, the check silently finds nothing to verify.
    const tiers = securityArtifactTiers(RID_A);

    expect(tiers).toContain(scopedSecurityReview(RID_A));
    expect(tiers).toContain(BARE_SECURITY_REVIEW);
    expect(tiers.indexOf(scopedSecurityReview(RID_A))).toBeLessThan(
      tiers.indexOf(BARE_SECURITY_REVIEW)
    );
  });
});
