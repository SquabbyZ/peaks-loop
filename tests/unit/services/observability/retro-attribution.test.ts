// tests/unit/services/observability/retro-attribution.test.ts
//
// WHY THIS FILE EXISTS. The observability stream kept the COUNT of the
// missing artifacts and dropped WHICH artifacts were missing, so the
// historical failures in this repository's own event log name no artifact and
// no skill. The retro-attribution re-derives what the count alone cannot
// carry: the candidate set comes from the prerequisite table, and the
// confidence says how far that derivation can be trusted.
//
// THE CONFIDENCE CEILING IS THE POINT. `exact` means "measured when it
// happened". A retro-attribution is computed from TODAY's table over an event
// that was recorded under an EARLIER table, so the highest confidence it can
// honestly carry is `inferred`, and the table together with the recorded count
// is what decides which of the three levels applies.
//
// THE FIXTURES ARE DERIVED, NOT ASSUMED. Every `(role, state, type)`
// combination the tests use is found by asking the table itself, so a change
// to the table cannot silently turn a "one entry" case into a "several
// entries" case and leave the assertions describing the old shape.
//
// Dimensions:
//   - behavior:   the confidence rules and the candidate set
//   - integration: the derivation against the real prerequisite table
//   - render:     OMITTED — the module returns a structure, it renders no surface
//   - a11y:       OMITTED — no human-visible message originates here

import { describe, expect, it } from 'vitest';

import {
  getPrerequisitesFor,
  VALID_REQUEST_TYPES,
  type RequestType
} from '~/src/services/artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '~/src/services/artifacts/artifact-templates.js';
import {
  ALLOWED_STATES_PER_ROLE,
  type RequestArtifactState
} from '~/src/services/artifacts/request-artifact-state-helpers.js';
import { attributeV1Failure } from '~/src/services/observability/retro-attribution.js';
import { ownerSkillForPath } from '~/src/services/observability/owner-skill-map.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/retro-attribution.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module returns a structure; it renders no surface' },
    { dim: 'a11y', reason: 'no human-visible message originates here' }
  ]
);

const ROLES: readonly RequestArtifactRole[] = ['prd', 'ui', 'rd', 'qa', 'sc'];

/** One transition the table can be asked about. */
type Transition = {
  readonly role: RequestArtifactRole;
  readonly state: RequestArtifactState;
  readonly type: RequestType;
};

/** Every transition the table can be asked about, in a stable order. */
function everyTransition(): readonly Transition[] {
  const transitions: Transition[] = [];
  for (const type of VALID_REQUEST_TYPES) {
    for (const role of ROLES) {
      for (const state of ALLOWED_STATES_PER_ROLE[role]) {
        transitions.push({ role, state, type });
      }
    }
  }
  return transitions;
}

/**
 * The transition whose prereq list holds EXACTLY ONE entry — found by asking
 * the table, not by guessing which combination happens to have one.
 */
function transitionWithOnePrereq(): Transition {
  const found = everyTransition().find(
    (t) => getPrerequisitesFor(t.role, t.state, t.type).length === 1
  );
  if (found === undefined) throw new Error('no transition in the table demands exactly one prereq');
  return found;
}

/**
 * The transition whose prereq list holds SEVERAL entries, taking the shortest
 * such list so the assertions name as few artifacts as the table can.
 */
function transitionWithSeveralPrereqs(): Transition {
  const candidates = everyTransition().filter(
    (t) => getPrerequisitesFor(t.role, t.state, t.type).length > 1
  );
  const found = candidates.reduce<Transition | undefined>((best, t) => {
    if (best === undefined) return t;
    return getPrerequisitesFor(t.role, t.state, t.type).length <
      getPrerequisitesFor(best.role, best.state, best.type).length
      ? t
      : best;
  }, undefined);
  if (found === undefined) throw new Error('no transition in the table demands several prereqs');
  return found;
}

/**
 * The oracle: this file's OWN reading of who owns each artifact the
 * retro-attribution can produce, so the attribution is checked against a
 * second reading rather than against itself.
 *
 * THE SAME SHAPE, A DIFFERENT SET AND SCOPE. A longest-matching-prefix-wins
 * table, as the map is — but three checks show it is not that table copied:
 *
 *   - SCOPE. It answers for the CANDIDATE paths only: no per-file
 *     exact-match rows and no `gateEvidence.*` keys, so on
 *     `gateEvidence.securityReview` the map names a skill and this names none.
 *   - SOURCE. Each row names the PRODUCER, as the artifact contract names it.
 *     The contract settles `rd/security-review-` -> `peaks-security-audit`
 *     (AUDIT_SECURITY "Replaces the v2.11.x rd/security-review.md slot", and
 *     the `gateEvidence.securityReview` key already names that skill) and
 *     `rd/third-party-review-` -> `peaks-reviewer` (THIRD_PARTY_REVIEW names
 *     "third-party reviewer (peaks-reviewer skill)").
 *   - THE TRAILING SEPARATOR. A claim carries the separator after the
 *     artifact name, so `rd/security-review.md.backup` is outside
 *     `rd/security-review-` and falls to the `rd/` claim. The map draws that
 *     same boundary with an `exact` flag — a separate mechanism that agrees
 *     on where the line falls.
 *
 * A MORE SPECIFIC PREFIX WINS, so the two `rd/`-scoped rows below beat the
 * generic `rd/` claim on exactly the paths the map decides.
 */
const EXPECTED_OWNER_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['prd/', 'peaks-prd'],
  ['ui/', 'peaks-ui'],
  ['rd/', 'peaks-rd'],
  ['qa/', 'peaks-qa'],
  ['sc/', 'peaks-sc'],
  ['mut/', 'peaks-mut'],
  ['audit/security', 'peaks-security-audit'],
  ['audit/perf', 'peaks-perf-audit'],
  ['rd/security-review-', 'peaks-security-audit'],
  ['rd/third-party-review-', 'peaks-reviewer']
];

/**
 * The skill this file's reading gives `path`, or `null` when no prefix
 * claims it. The longest matching prefix wins.
 */
function expectedOwner(path: string): string | null {
  const matches = EXPECTED_OWNER_BY_PREFIX.filter(([prefix]) => path.startsWith(prefix));
  if (matches.length === 0) return null;
  const longest = matches.reduce((best, entry) =>
    entry[0].length > best[0].length ? entry : best
  );
  return longest[1];
}

/**
 * The skill a PREFIX reading gives `path`, or `null` when no prefix claims
 * it. The longest matching prefix wins.
 */
function staleOwner(
  reading: ReadonlyArray<readonly [string, string]>,
  path: string
): string | null {
  const matches = reading.filter(([prefix]) => path.startsWith(prefix));
  if (matches.length === 0) return null;
  const longest = matches.reduce((best, entry) =>
    entry[0].length > best[0].length ? entry : best
  );
  return longest[1];
}
describe('Scenario: behavior — the retro-attribution names the candidates the count cannot', () => {
  it('when the prereq list holds one entry, should infer that entry as the missing artifact', () => {
    // given: a transition whose prereq list holds exactly one entry
    // when: the failure is attributed with a count of one
    // then: the confidence is inferred and the entry is the only candidate
    const transition = transitionWithOnePrereq();
    const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: transition.type,
      typeSource: 'declared',
      missingCount: 1
    });
    expect(prereqs).toHaveLength(1);
    expect(result.confidence).toBe('inferred');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.path).toBe(prereqs[0]?.relativePath);
  });

  it('when the prereq list holds several entries and one is missing, should stay ambiguous', () => {
    // given: a transition whose prereq list holds several entries
    // when: the failure is attributed with a count of one
    // then: the confidence is ambiguous and every entry is a candidate
    const transition = transitionWithSeveralPrereqs();
    const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: transition.type,
      typeSource: 'declared',
      missingCount: 1
    });
    expect(prereqs.length).toBeGreaterThan(1);
    expect(result.confidence).toBe('ambiguous');
    expect(result.candidates.map((c) => c.path)).toEqual(prereqs.map((p) => p.relativePath));
  });

  it('when the count matches the prereq list length, should infer the whole list', () => {
    // given: a transition whose prereq list holds several entries
    // when: the failure is attributed with a count equal to that length
    // then: the confidence is inferred and every entry is a candidate
    const transition = transitionWithSeveralPrereqs();
    const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: transition.type,
      typeSource: 'declared',
      missingCount: prereqs.length
    });
    expect(result.confidence).toBe('inferred');
    expect(result.candidates).toHaveLength(prereqs.length);
  });

  it('when the count does not match the prereq list length, should stay ambiguous', () => {
    // given: a transition whose prereq list holds several entries
    // when: the failure is attributed with a count that matches no subset of them
    // then: the confidence is ambiguous and the whole list stays the candidate set
    const transition = transitionWithSeveralPrereqs();
    const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: transition.type,
      typeSource: 'declared',
      missingCount: prereqs.length - 1
    });
    expect(prereqs.length).toBeGreaterThan(1);
    expect(result.confidence).toBe('ambiguous');
    expect(result.candidates).toHaveLength(prereqs.length);
  });

  it('when the count exceeds the prereq list length, should stay ambiguous on the table entries', () => {
    // given: a transition whose prereq list holds several entries
    // when: the failure is attributed with a count larger than that list
    // then: the confidence is ambiguous and the candidates are the table entries alone
    const transition = transitionWithSeveralPrereqs();
    const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: transition.type,
      typeSource: 'declared',
      missingCount: prereqs.length + 1
    });
    expect(result.confidence).toBe('ambiguous');
    expect(result.candidates.map((c) => c.path)).toEqual(prereqs.map((p) => p.relativePath));
  });

  it('when the transition demands no prerequisite, should answer ambiguous with no candidate', () => {
    // given: a transition the table holds no entry for
    // when: the failure is attributed
    // then: the confidence is ambiguous and no candidate is named
    const empty = everyTransition().find(
      (t) => getPrerequisitesFor(t.role, t.state, t.type).length === 0
    );
    expect(empty).toBeDefined();
    if (empty === undefined) return;
    const result = attributeV1Failure({
      artifactRole: empty.role,
      newState: empty.state,
      requestType: empty.type,
      typeSource: 'declared',
      missingCount: 1
    });
    expect(result.confidence).toBe('ambiguous');
    expect(result.candidates).toHaveLength(0);
  });

  it('when the recorded count is zero, should name no candidate', () => {
    // given: a transition whose prereq list holds one entry
    // when: the failure is attributed with a count of zero
    // then: no candidate is named, because the record says nothing was missing
    const transition = transitionWithOnePrereq();
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: transition.type,
      typeSource: 'declared',
      missingCount: 0
    });
    expect(result.confidence).toBe('ambiguous');
    expect(result.candidates).toHaveLength(0);
  });

  it('when the recorded count is not a number, should keep the whole list as the candidate set', () => {
    // given: a transition whose prereq list holds one entry
    // when: the failure is attributed with a count that is not a readable number
    // then: the confidence is ambiguous and the candidate set is the whole list
    const transition = transitionWithOnePrereq();
    const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
    const unreadableCounts: readonly unknown[] = ['two', undefined, Number.NaN, -1];
    for (const unreadable of unreadableCounts) {
      const result = attributeV1Failure({
        artifactRole: transition.role,
        newState: transition.state,
        requestType: transition.type,
        typeSource: 'declared',
        missingCount: unreadable as number
      });
      expect(result.confidence, `count ${String(unreadable)} was not treated as unreadable`).toBe(
        'ambiguous'
      );
      expect(result.candidates.map((c) => c.path)).toEqual(prereqs.map((p) => p.relativePath));
    }
  });

  it('when the request type is not one the table knows, should answer ambiguous with no candidate', () => {
    // given: a transition the table can be asked about, named with an unknown request type
    // when: the failure is attributed
    // then: the confidence is ambiguous and no candidate is named
    const transition = transitionWithOnePrereq();
    const result = attributeV1Failure({
      artifactRole: transition.role,
      newState: transition.state,
      requestType: 'not-a-request-type' as RequestType,
      typeSource: 'declared',
      missingCount: 1
    });
    expect(result.confidence).toBe('ambiguous');
    expect(result.candidates).toHaveLength(0);
  });

  it('when every transition and count is swept, should never report the exact confidence', () => {
    // given: every transition the table can be asked about
    // when: each is attributed with several counts
    // then: no attribution ever carries the exact confidence
    for (const transition of everyTransition()) {
      const length = getPrerequisitesFor(transition.role, transition.state, transition.type).length;
      for (const count of [0, 1, 2, length, length + 1]) {
        const result = attributeV1Failure({
          artifactRole: transition.role,
          newState: transition.state,
          requestType: transition.type,
          typeSource: 'declared',
          missingCount: count
        });
        expect(result.confidence).not.toBe('exact');
      }
    }
  });
});

describe('Scenario: integration — the derivation reads the real prerequisite table', () => {
  it('when the candidates are returned, should carry the table path and its owning skill', () => {
    // given: every transition the table can be asked about
    // when: each is attributed
    // then: every candidate names a table path, and the skill that owns it is
    //       the one THIS FILE'S OWN READING gives — checked on EVERY candidate
    //       the table can produce, so the reading is consulted on the paths
    //       where the two readings can diverge and not only on one fixture's
    const prereqPaths = new Set<string>();
    for (const transition of everyTransition()) {
      const prereqs = getPrerequisitesFor(transition.role, transition.state, transition.type);
      const result = attributeV1Failure({
        artifactRole: transition.role,
        newState: transition.state,
        requestType: transition.type,
        typeSource: 'declared',
        missingCount: 1
      });
      expect(result.candidates).toHaveLength(prereqs.length);
      for (const candidate of result.candidates) {
        expect(prereqs.map((p) => p.relativePath)).toContain(candidate.path);
        prereqPaths.add(candidate.path);
        expect(candidate.ownerSkill, `unexpected owning skill for ${candidate.path}`).toBe(
          expectedOwner(candidate.path)
        );
      }
    }
    // the sweep really did reach the rd/-scoped artifacts, whose owner is the
    // one the directory claim alone cannot decide
    expect([...prereqPaths].sort()).toEqual(
      expect.arrayContaining(['rd/security-review-<rid>.md', 'rd/third-party-review-<rid>.md'])
    );
  });

  it('when the candidates are returned, should name a skill for every artifact the table demands', () => {
    // given: every transition the table can be asked about
    // when: each is attributed
    // then: every candidate names an owning skill, so no artifact is unattributed
    for (const transition of everyTransition()) {
      const result = attributeV1Failure({
        artifactRole: transition.role,
        newState: transition.state,
        requestType: transition.type,
        typeSource: 'declared',
        missingCount: 1
      });
      for (const candidate of result.candidates) {
        expect(candidate.ownerSkill, `no owning skill for ${candidate.path}`).not.toBeNull();
      }
    }
  });
});

describe('Scenario: integration — the oracle reaches the artifacts where the two readings diverge', () => {
  it('when the oracle is the pre-slice directory-only reading, should disagree on the rd-scoped artifacts', () => {
    // given: the reading this file used before it named the two rd/-scoped
    //        artifacts — the generic rd/ directory claim alone
    // when: each is compared with the owner map
    // then: the directory claim answers the rd/ owner for both, so the
    //       comparison reports the disagreement — the two new rows are
    //       LOAD-BEARING, and the comparison would have caught the stale
    //       reading
    const staleReading: ReadonlyArray<readonly [string, string]> = [
      ['prd/', 'peaks-prd'],
      ['ui/', 'peaks-ui'],
      ['rd/', 'peaks-rd'],
      ['qa/', 'peaks-qa'],
      ['sc/', 'peaks-sc'],
      ['mut/', 'peaks-mut'],
      ['audit/security', 'peaks-security-audit'],
      ['audit/perf', 'peaks-perf-audit']
    ];
    for (const [path, owner] of [
      ['rd/security-review-<rid>.md', 'peaks-security-audit'],
      ['rd/third-party-review-<rid>.md', 'peaks-reviewer']
    ] as const) {
      expect(expectedOwner(path)).toBe(owner);
      expect(ownerSkillForPath(path)).toBe(owner);
      // the stale reading answers the rd/ owner for both, so it disagrees
      // with the map on exactly the paths this slice closes
      expect(staleOwner(staleReading, path)).toBe('peaks-rd');
      expect(staleOwner(staleReading, path)).not.toBe(owner);
    }
  });

  it('when a file merely begins with a claimed artifact name, should not hand it to that producer', () => {
    // given: a file whose name starts with a claimed artifact name — the
    //        claim carries the trailing separator, so this file is outside it
    // when: the reading is asked about it
    // then: the directory claim answers, not the artifact's producer —
    //       the same boundary the map draws with its exact-row rule,
    //       reached here by the separator instead of a per-file flag
    expect(expectedOwner('rd/security-review-<rid>.md')).toBe('peaks-security-audit');
    expect(expectedOwner('rd/security-review.md.backup')).toBe('peaks-rd');
  });

  it('when the legacy bare security-review location is asked about, should state the one divergence left outside scope', () => {
    // given: the security review's LEGACY location — the bare file with no
    //        request id in its name, which the judged-declaration check still
    //        probes as a tier, so it is a live path for the owner map
    // when: each reading is asked about it
    // then: the map names the audit skill through its EXACT row and this
    //       reading answers the `rd/` claim — the one path both readings
    //       answer and disagree on. (Every other map claim is a prefix this
    //       reading also makes, a `gateEvidence.*` key it leaves unclaimed,
    //       or an exact row it resolves to the same skill.) The divergence
    //       is the SCOPE boundary, not a defect: the table never demands this
    //       path, so the candidate set can never contain it. The last
    //       assertion is what keeps that true — a future table that adds the
    //       legacy tier as a candidate turns this red, and the reading must
    //       then be extended rather than silently outvoted.
    expect(ownerSkillForPath('rd/security-review.md')).toBe('peaks-security-audit');
    expect(expectedOwner('rd/security-review.md')).toBe('peaks-rd');
    const candidatePaths = new Set(
      everyTransition().flatMap((t) =>
        getPrerequisitesFor(t.role, t.state, t.type).map((p) => p.relativePath)
      )
    );
    expect(candidatePaths.has('rd/security-review.md')).toBe(false);
  });

  it('when the owner map and the oracle are asked about a declaration key, should answer differently', () => {
    // given: a gate-evidence declaration key — a name of evidence, not an
    //        artifact path
    // when: each reading is asked about it
    // then: the map names the skill that produces that evidence and this
    //       reading names none — so the two tables are not one table copied
    //       twice, and the oracle's scope is the candidate-path set
    expect(ownerSkillForPath('gateEvidence.securityReview')).toBe('peaks-security-audit');
    expect(expectedOwner('gateEvidence.securityReview')).toBeNull();
  });
});
