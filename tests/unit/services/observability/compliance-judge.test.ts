// tests/unit/services/observability/compliance-judge.test.ts
//
// The compliance judge: does a skill's own declared steps actually HAPPEN?
//
// WHY THIS FILE EXISTS. The near-miss rate asks how often a passing slice was
// bought by skipping a check. The compliance rate asks the question from the
// other side: for the steps a skill DECLARED, how many left evidence that they
// ran? A missing artifact is the deterministic evidence — no judgement, no
// model, nothing to trust but a file that is either there or not.
//
// WHY THE JUDGE IS A PURE FUNCTION. Whether an artifact exists is the ONLY
// question the judge answers, and the caller answers it (the judge never
// touches a filesystem). That is what makes every arm below a statement about
// the RULES rather than about a machine's state, and it is what lets the same
// spec be judged against a real workspace, a fixture, or a hypothetical.
//
// THE ARMS, in the order the rules compose:
//   1. everything present -> the rate is 1
//   2. one required step missing -> the rate drops, the step fails with a reason
//   3. an optional step missing -> it stays out of the denominator
//   4. a step whose prerequisite did not run -> it is not credited
//   5. a spec that repeats a step id -> the judge refuses to score it
//   6. every spec path is either in the prerequisite table or a declared gap
//
// Dimensions:
//   behavior:   the judging rules (the rate, the denominator, the demotion)
//   integration: the two pilot specs against the real prerequisite table
//   render:     OMITTED - the judge returns records, not a rendered surface
//   a11y:       OMITTED - no operator-facing message originates here

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { allPrerequisitePaths } from '~/src/services/artifacts/prerequisite-path-census.js';
import { ownerSkillForPath } from '~/src/services/observability/owner-skill-map.js';
import { judgeCompliance } from '~/src/services/observability/compliance-judge.js';
import type {
  ComplianceContractGap,
  ComplianceSpec,
  ComplianceStep
} from '~/src/services/observability/compliance-spec.js';
import {
  PEAKS_RD_CONTRACT_GAPS,
  PEAKS_RD_SPEC
} from '~/src/services/observability/compliance-specs/peaks-rd.spec.js';
import {
  PEAKS_RACE_CODE_CONTRACT_GAPS,
  PEAKS_RACE_CODE_SPEC
} from '~/src/services/observability/compliance-specs/peaks-race-code.spec.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/observability/compliance-judge.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the judge returns records, not a rendered surface' },
    { dim: 'a11y', reason: 'no operator-facing message originates in this module' }
  ]
);

/** A step whose only check is "the artifact is there". */
function step(
  id: string,
  artifactExists: string,
  options: { required?: boolean; afterStep?: string } = {}
): ComplianceStep {
  return {
    id,
    description: `step ${id}`,
    required: options.required ?? true,
    ownerSkill: 'peaks-rd',
    verify: { artifactExists },
    ...(options.afterStep === undefined ? {} : { afterStep: options.afterStep })
  };
}

/** A spec over the given steps. */
function spec(id: string, steps: readonly ComplianceStep[]): ComplianceSpec {
  return { id, source: 'test', owner: 'peaks-rd', steps };
}

/** An `exists` that answers true only for the listed paths. */
function present(paths: readonly string[]): (artifactPath: string) => boolean {
  const set = new Set(paths);
  return (artifactPath) => set.has(artifactPath);
}

describe('Scenario: behavior — the judge scores a spec against what exists', () => {
  it('when every required artifact is present, should report a full compliance rate', () => {
    // given: a spec of two required steps whose artifacts both exist
    // when: the spec is judged
    // then: the rate is 1 and both steps are credited
    const specUnderTest = spec('s', [step('a', 'a.md'), step('b', 'b.md')]);
    const result = judgeCompliance(specUnderTest, present(['a.md', 'b.md']));
    expect(result.complianceRate).toBe(1);
    expect(result.steps.every((s) => s.executed)).toBe(true);
    expect(result.specId).toBe('s');
  });

  it('when one required artifact is missing, should drop the rate and name the failure', () => {
    // given: a spec of three required steps with one artifact absent
    // when: the spec is judged
    // then: the rate falls to two thirds and the missing step carries a reason
    const specUnderTest = spec('s', [step('a', 'a.md'), step('b', 'b.md'), step('c', 'c.md')]);
    const result = judgeCompliance(specUnderTest, present(['a.md', 'c.md']));
    expect(result.complianceRate).toBeCloseTo(2 / 3, 10);
    const failed = result.steps.find((s) => s.stepId === 'b');
    expect(failed?.executed).toBe(false);
    expect(failed?.failureReason).toBeTruthy();
  });

  it('when an optional artifact is missing, should keep it out of the denominator', () => {
    // given: two required steps that exist and one optional step whose artifact does not
    // when: the spec is judged
    // then: the rate is still 1 and the optional step is reported as not executed
    const specUnderTest = spec('s', [
      step('a', 'a.md'),
      step('b', 'b.md'),
      step('optional', 'c.md', { required: false })
    ]);
    const result = judgeCompliance(specUnderTest, present(['a.md', 'b.md']));
    expect(result.complianceRate).toBe(1);
    const optional = result.steps.find((s) => s.stepId === 'optional');
    expect(optional?.executed).toBe(false);
    expect(optional?.failureReason).toBeTruthy();
  });

  it('when a step depends on a step that did not execute, should not credit the dependent', () => {
    // given: a dependent step whose own artifact exists but whose prerequisite is missing
    // when: the spec is judged
    // then: the dependent is not executed, the reason names the prerequisite, and the
    //       rate counts the dependent as failed even though its artifact was there
    const specUnderTest = spec('s', [
      step('prereq', 'a.md'),
      step('dependent', 'b.md', { afterStep: 'prereq' })
    ]);
    const result = judgeCompliance(specUnderTest, present(['b.md']));
    const dependent = result.steps.find((s) => s.stepId === 'dependent');
    expect(dependent?.executed).toBe(false);
    expect(dependent?.failureReason).toContain('prereq');
    expect(result.complianceRate).toBe(0);
  });

  it('when the missing artifact is at the root of a dependency chain, should demote every dependent', () => {
    // given: a three-step chain declared back to front, with the root artifact absent
    // when: the spec is judged
    // then: every step that depended on the root is not credited
    const specUnderTest = spec('s', [
      step('c', 'c.md', { afterStep: 'b' }),
      step('b', 'b.md', { afterStep: 'a' }),
      step('a', 'a.md')
    ]);
    const result = judgeCompliance(specUnderTest, present(['b.md', 'c.md']));
    expect(result.steps.every((s) => !s.executed)).toBe(true);
    expect(result.complianceRate).toBe(0);
  });

  it('when a step names a dependency the spec does not declare, should not credit the step', () => {
    // given: a step whose afterStep names an id that is not in the spec
    // when: the spec is judged
    // then: the step is not credited and the reason names the unknown dependency
    const specUnderTest = spec('s', [step('dependent', 'b.md', { afterStep: 'nowhere' })]);
    const result = judgeCompliance(specUnderTest, present(['b.md']));
    const dependent = result.steps.find((s) => s.stepId === 'dependent');
    expect(dependent?.executed).toBe(false);
    expect(dependent?.failureReason).toContain('nowhere');
  });

  it('when a required step depends on a missing optional step, should not credit the dependent', () => {
    // given: a required step whose prerequisite is optional and did not execute
    // when: the spec is judged
    // then: the dependent is not credited, because the thing it was ordered against is absent
    const specUnderTest = spec('s', [
      step('optional-prereq', 'a.md', { required: false }),
      step('dependent', 'b.md', { afterStep: 'optional-prereq' })
    ]);
    const result = judgeCompliance(specUnderTest, present(['b.md']));
    const dependent = result.steps.find((s) => s.stepId === 'dependent');
    expect(dependent?.executed).toBe(false);
    expect(dependent?.failureReason).toContain('optional-prereq');
    // the optional step is still reported as not executed, and stays out of the
    // denominator; the required dependent counts as failed
    const optional = result.steps.find((s) => s.stepId === 'optional-prereq');
    expect(optional?.executed).toBe(false);
    expect(result.complianceRate).toBe(0);
  });

  it('when a spec declares the same step id twice, should refuse to judge it', () => {
    // given: a malformed spec whose two steps share one id
    // when: the spec is judged
    // then: the judge refuses, naming the duplicated id, rather than scoring it
    const specUnderTest = spec('s', [step('twice', 'a.md'), step('twice', 'b.md')]);
    expect(() => judgeCompliance(specUnderTest, present(['a.md', 'b.md']))).toThrow(/twice/);
  });

  it('when a spec declares no required step, should report no demonstrated compliance', () => {
    // given: a spec whose only step is optional
    // when: the spec is judged
    // then: the rate is 0, because nothing was demanded and nothing was shown
    const specUnderTest = spec('s', [step('optional', 'a.md', { required: false })]);
    const result = judgeCompliance(specUnderTest, present([]));
    expect(result.complianceRate).toBe(0);
  });

  it('when the judge probes artifacts, should ask about the declared path verbatim', () => {
    // given: a spec whose step declares a path
    // when: the spec is judged
    // then: the caller is asked about exactly that path
    const asked: string[] = [];
    const specUnderTest = spec('s', [step('a', 'rd/code-review-<rid>.md')]);
    judgeCompliance(specUnderTest, (artifactPath) => {
      asked.push(artifactPath);
      return true;
    });
    expect(asked).toEqual(['rd/code-review-<rid>.md']);
  });

  it('when the spec declares no steps, should report an empty result at a zero rate', () => {
    // given: a spec with no steps at all
    // when: the spec is judged
    // then: there are no step results and the rate is 0
    const result = judgeCompliance(spec('s', []), present([]));
    expect(result.steps).toEqual([]);
    expect(result.complianceRate).toBe(0);
  });
});

describe('Scenario: integration — the pilot specs stay tied to the artifact contract', () => {
  const pilots: readonly {
    readonly spec: ComplianceSpec;
    readonly gaps: readonly ComplianceContractGap[];
  }[] = [
    { spec: PEAKS_RD_SPEC, gaps: PEAKS_RD_CONTRACT_GAPS },
    { spec: PEAKS_RACE_CODE_SPEC, gaps: PEAKS_RACE_CODE_CONTRACT_GAPS }
  ];

  it('when every step path is checked against the prerequisite table, should be in it or declared a gap', () => {
    // given: the two pilot specs
    // when: each declared artifact path is looked up in the prerequisite table
    // then: every path is either in the table or named in the spec's gap list
    const inTable = new Set(allPrerequisitePaths());
    for (const pilot of pilots) {
      const declared = new Set(pilot.gaps.map((gap) => gap.path));
      for (const s of pilot.spec.steps) {
        const path = s.verify.artifactExists;
        expect(
          inTable.has(path) || declared.has(path),
          `${pilot.spec.id}: ${path} is in neither the prerequisite table nor the declared gaps`
        ).toBe(true);
      }
    }
  });

  it('when a declared gap is checked against the prerequisite table, should still be absent', () => {
    // given: the declared contract gaps of the two pilot specs
    // when: each gap path is looked up in the prerequisite table
    // then: none of them is in the table, so a declaration cannot rot unnoticed
    const inTable = new Set(allPrerequisitePaths());
    for (const pilot of pilots) {
      for (const gap of pilot.gaps) {
        expect(inTable.has(gap.path), `${pilot.spec.id}: ${gap.path} is now in the table`).toBe(
          false
        );
        expect(gap.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('when a declared gap is checked against its spec, should name a step of that spec', () => {
    // given: the declared contract gaps of the two pilot specs
    // when: each gap path is looked up among the spec's own steps
    // then: every gap names an artifact some step of that spec verifies
    for (const pilot of pilots) {
      const verified = new Set(pilot.spec.steps.map((s) => s.verify.artifactExists));
      for (const gap of pilot.gaps) {
        expect(verified.has(gap.path), `${pilot.spec.id}: ${gap.path} names no step`).toBe(true);
      }
    }
  });

  it('when each step owner is checked, should name the skill that owns the artifact', () => {
    // given: the two pilot specs
    // when: each step's owner skill is compared with the owner map's answer
    // then: the owner is the mapped owner, or the spec's own skill where the map is silent
    for (const pilot of pilots) {
      for (const s of pilot.spec.steps) {
        const mapped = ownerSkillForPath(s.verify.artifactExists);
        expect(s.ownerSkill, `${pilot.spec.id}/${s.id}`).toBe(mapped ?? pilot.spec.owner);
      }
    }
  });

  it('when each owner skill is checked on disk, should have a skill file', () => {
    // given: the owner skills named by the two pilot specs
    // when: the skill directories are looked for
    // then: every named owner is a skill that ships
    const owners = new Set(pilots.flatMap((pilot) => pilot.spec.steps.map((s) => s.ownerSkill)));
    for (const owner of owners) {
      expect(
        ['skills', 'skills/bee'].some((dir) => existsSync(`${dir}/${owner}/SKILL.md`)),
        `${owner} has no SKILL.md`
      ).toBe(true);
    }
  });

  it('when the step ids of a spec are checked, should be unique', () => {
    // given: the two pilot specs
    // when: the ids of each spec's steps are collected
    // then: no id repeats, so a step result names exactly one step
    for (const pilot of pilots) {
      const ids = pilot.spec.steps.map((s) => s.id);
      expect(new Set(ids).size, `${pilot.spec.id} repeats a step id`).toBe(ids.length);
    }
  });

  it('when a step names a dependency, should be a step of the same spec', () => {
    // given: the two pilot specs
    // when: each afterStep reference is resolved inside its own spec
    // then: every reference names a step that exists
    for (const pilot of pilots) {
      const ids = new Set(pilot.spec.steps.map((s) => s.id));
      for (const s of pilot.spec.steps) {
        if (s.afterStep === undefined) continue;
        expect(ids.has(s.afterStep), `${pilot.spec.id}/${s.id} names ${s.afterStep}`).toBe(true);
      }
    }
  });

  it('when the pilot specs are judged against an empty workspace, should report no compliance', () => {
    // given: the two pilot specs and a workspace holding nothing
    // when: both specs are judged
    // then: both report a zero rate, and every required step is uncredited
    for (const pilot of pilots) {
      const result = judgeCompliance(pilot.spec, present([]));
      expect(result.complianceRate).toBe(0);
      expect(result.steps.every((s) => !s.executed)).toBe(true);
    }
  });

  it('when the rd spec is checked for parallel audits, should model both of them', () => {
    // given: the rd pilot spec
    // when: its required steps are read
    // then: the security audit and its sibling, the perf audit, are both there —
    //       a spec that modelled one audit and not the other would let the rate
    //       read "the skill did its job" while half the obligation went unmeasured
    const requiredIds = PEAKS_RD_SPEC.steps.filter((s) => s.required).map((s) => s.id);
    expect(requiredIds).toContain('rd-security-audit');
    expect(requiredIds).toContain('rd-perf-audit');
  });
});
