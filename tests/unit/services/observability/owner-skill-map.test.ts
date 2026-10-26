// tests/unit/services/observability/owner-skill-map.test.ts
//
// WHY THIS FILE EXISTS. The observability event stream kept the COUNT of
// missing artifacts and dropped WHICH artifacts were missing, so a reader
// could not tell which skill failed to deliver what. The owner-skill map is
// the lookup that turns an artifact path into the skill that owns it.
//
// THE CENSUS ARM IS THE ONE THAT MATTERS LONG-TERM. Every path the
// prerequisite tables demand must resolve to an owning skill. A path that
// resolves to nothing is a missing artifact that names no skill, which is the
// whole gap this work closes — so the census is asserted here rather than
// left to a reader to notice.
//
// Dimensions:
//   - behavior:   the lookup itself — known paths resolve, unknown paths do not
//   - integration: the lookup against the real prerequisite table
//   - render:     OMITTED — the map answers with a skill name, not a surface
//   - a11y:       OMITTED — no operator-facing message originates here

import { describe, expect, it } from 'vitest';

import { allPrerequisitePaths } from '~/src/services/artifacts/prerequisite-path-census.js';
import { ownerSkillForPath } from '~/src/services/observability/owner-skill-map.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/owner-skill-map.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the map answers with a skill name; it renders no surface' },
    { dim: 'a11y', reason: 'no human-visible message originates here' }
  ]
);

describe('Scenario: behavior — a path resolves to the skill that owns the artifact', () => {
  it('when the path names a known artifact directory, should resolve that owning skill', () => {
    // given: one artifact path per known owning directory
    // when: the owning skill is looked up for each path
    // then: each path names the skill that produces that artifact
    expect(ownerSkillForPath('rd/bug-analysis-<rid>.md')).toBe('peaks-rd');
    expect(ownerSkillForPath('qa/test-cases/<rid>.md')).toBe('peaks-qa');
    expect(ownerSkillForPath('audit/security-<rid>.md')).toBe('peaks-security-audit');
    expect(ownerSkillForPath('audit/perf-<rid>.md')).toBe('peaks-perf-audit');
  });

  it('when the path names the bare security audit location, should resolve the audit skill', () => {
    // given: the bare location the security audit artifact also lives at
    // when: the owning skill is looked up for it
    // then: it names the audit skill, and not the owner of the other audit
    expect(ownerSkillForPath('audit/security.md')).toBe('peaks-security-audit');
    expect(ownerSkillForPath('audit/perf-<rid>.md')).not.toBe('peaks-security-audit');
  });

  it('when the path names no known directory, should answer null instead of guessing', () => {
    // given: a path under a directory that no skill owns
    // when: the owning skill is looked up for it
    // then: the lookup reports no owner rather than a plausible one
    expect(ownerSkillForPath('nope/whatever.md')).toBeNull();
  });
});

describe('Scenario: integration — the census covers every demanded path', () => {
  it('when every path in the prerequisite table is looked up, should name an owner for each', () => {
    // given: the set of paths the prerequisite tables demand
    // when: each one is looked up
    // then: no demanded path is left without an owning skill
    const paths = allPrerequisitePaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(ownerSkillForPath(p), `no ownerSkill for ${p}`).not.toBeNull();
    }
  });
});
