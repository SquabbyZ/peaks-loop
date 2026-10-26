// tests/unit/services/observability/owner-skill-map.test.ts
//
// WHY THIS FILE EXISTS. The observability event stream kept the COUNT of
// missing artifacts and dropped WHICH artifacts were missing, so a reader
// could not tell which skill failed to deliver what. The owner-skill map is
// the lookup that turns an artifact path into the skill that owns it.
//
// THE COVERAGE ARM IS THE ONE THAT MATTERS LONG-TERM. Every path that can
// reach the missing list must either name an owning skill or be listed as
// ownerless WITH A REASON. A path that does neither is a missing artifact
// that names no skill and no explanation — the whole gap this work closes.
// The census is asserted here rather than left to a reader to notice, and
// the census reads the paths from the modules that define them, so a path
// source added upstream reaches this arm without anyone editing a list here.
//
// Dimensions:
//   - behavior:   the lookup itself — known paths resolve, unknown paths do not
//   - integration: the lookup against the real prerequisite table
//   - render:     OMITTED — the map answers with a skill name, not a surface
//   - a11y:       OMITTED — no operator-facing message originates here

import { describe, expect, it } from 'vitest';

import { allPrerequisitePaths } from '~/src/services/artifacts/prerequisite-path-census.js';
import {
  ownerSkillForPath,
  unownedPathReason
} from '~/src/services/observability/owner-skill-map.js';
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

  it('when the path merely starts with an owned file name, should not claim that owner', () => {
    // given: a file whose name begins with an owned bare audit file name
    // when: the owning skill is looked up for it
    // then: the exact-match row does not claim it
    expect(ownerSkillForPath('audit/security.md.backup')).toBeNull();
  });

  it('when the path names no known directory, should answer null instead of guessing', () => {
    // given: a path under a directory that no skill owns
    // when: the owning skill is looked up for it
    // then: the lookup reports no owner rather than a plausible one
    expect(ownerSkillForPath('nope/whatever.md')).toBeNull();
  });
});

describe('Scenario: behavior — a gate-evidence key names the skill that produces that evidence', () => {
  it('when the path names a gate-evidence key, should resolve the producing skill', () => {
    // given: one path per declared gate-evidence key
    // when: the owning skill is looked up for each path
    // then: each key names the skill that produces the evidence it declares
    expect(ownerSkillForPath('gateEvidence.codeReview')).toBe('peaks-rd');
    expect(ownerSkillForPath('gateEvidence.securityReview')).toBe('peaks-security-audit');
    expect(ownerSkillForPath('gateEvidence.perfBaseline')).toBe('peaks-perf-audit');
    expect(ownerSkillForPath('gateEvidence.prdHandoff')).toBe('peaks-prd');
    expect(ownerSkillForPath('gateEvidence.projectScan')).toBe('peaks-code');
  });

  it('when the path names an unreadable capsule, should report no owner but a stated reason', () => {
    // given: the path shape an unreadable handoff capsule reports
    // when: the owning skill is looked up for it
    // then: no skill owns it and the reason why is available
    expect(ownerSkillForPath('gateEvidence(frontmatter-malformed)')).toBeNull();
    expect(unownedPathReason('gateEvidence(frontmatter-malformed)')).toContain('capsule');
  });
});

describe('Scenario: integration — the census covers every path that can reach the missing list', () => {
  it('when every demanded path is looked up, should name an owner or state why it has none', () => {
    // given: every path shape the prerequisite check can report as missing
    // when: each one is looked up
    // then: each one names an owning skill or carries an ownerless reason
    const paths = allPrerequisitePaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const owner = ownerSkillForPath(p);
      const reason = unownedPathReason(p);
      expect(
        owner !== null || reason !== null,
        `no ownerSkill and no ownerless reason for ${p}`
      ).toBe(true);
    }
  });

  it('when the census is read, should include the legacy tiers and the declaration shapes', () => {
    // given: the census of the paths that can reach the missing list
    // when: it is read
    // then: it names the legacy tiers, the declared keys and the unreadable capsule
    const paths = allPrerequisitePaths();
    expect(paths).toContain('audit/security.md');
    expect(paths).toContain('audit/perf.md');
    expect(paths).toContain('rd/karpathy-review.md');
    expect(paths).toContain('gateEvidence.securityReview');
    expect(paths).toContain('gateEvidence(frontmatter-malformed)');
  });
});
