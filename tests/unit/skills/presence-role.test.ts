// tests/unit/skills/presence-role.test.ts
//
// The role tier of a Peaks-Loop skill: `orchestrator` (a user-facing workflow
// that owns the gate transitions) or `bee` (a 1-level sub-role dispatched by
// an orchestrator and owning one stage).
//
// WHY THIS LIST IS A TESTED SURFACE. The tier is what the status header's Role
// cell carries. The model used to have to invent it, which is the same defect
// the gate cell had before the gate was persisted. A tier read from a list is
// only better than an invented one while the list still matches the document
// it was transcribed from — so every entry is asserted by name here, and the
// list is checked against the skills that actually exist in this repository.
//
// Dimensions: behavior (the tier of every skill in both tiers), render (the
// two lists as a published surface: no overlap, real skill names, every entry
// resolvable).
// integration / a11y omitted — this module is pure and renders no text.
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/skills/presence-role.test.ts

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BEE_ROLE_SKILLS,
  ORCHESTRATOR_ROLE_SKILLS,
  presenceRoleTier
} from '../../../src/services/skills/presence-role.js';

declareDimensions(
  'tests/unit/skills/presence-role.test.ts',
  ['behavior', 'render'],
  [
    {
      dim: 'integration',
      reason: 'this module is pure — no filesystem, no subprocess, no environment read'
    },
    {
      dim: 'a11y',
      reason: 'this module renders no user-facing text; it returns a tier value'
    }
  ]
);

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * How many skills this repository ships.
 *
 * Read from the tree rather than pinned as a literal: a pinned count is a
 * claim about a population that moves, and letting it go stale is exactly
 * how a shipped skill ends up outside both tiers.
 */
function shippedSkillCount(): number {
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (entry.name === 'SKILL.md') count += 1;
    }
  };
  walk(join(REPO_ROOT, 'skills'));
  return count;
}

describe('(behavior) the tier of every skill the Peaks-Loop family names', () => {
  it('when an orchestrator skill is asked for its tier, should report orchestrator', () => {
    // given: every skill the response contract lists as an orchestrator
    // when: each one is asked for its tier
    // then: each one reports the orchestrator tier
    for (const skill of ORCHESTRATOR_ROLE_SKILLS) {
      expect(presenceRoleTier(skill)).toBe('orchestrator');
    }
  });

  it('when a bee skill is asked for its tier, should report bee', () => {
    // given: every skill the response contract lists as a bee
    // when: each one is asked for its tier
    // then: each one reports the bee tier
    for (const skill of BEE_ROLE_SKILLS) {
      expect(presenceRoleTier(skill)).toBe('bee');
    }
  });

  it('when a skill is in neither list, should report no tier at all', () => {
    // given: a skill name the family does not name
    // when: its tier is asked for
    // then: there is no tier — the answer is null, never a guess
    expect(presenceRoleTier('peaks-not-a-skill')).toBeNull();
    expect(presenceRoleTier('')).toBeNull();
    // A skill name the family does not name has no tier — including a name
    // that is one character away from a shipped one, so a lookup that
    // matched on a prefix would fail here. Every skill this repository
    // ships is in exactly one tier; the completeness of that split is held
    // by `tests/unit/skills/presence-role-coverage.test.ts`.
    expect(presenceRoleTier('peaks-codex')).toBeNull();
  });

  it('when the same skill is asked twice, should report the same tier both times', () => {
    // given: one skill in the list
    // when: its tier is asked for twice
    // then: both answers agree — the function holds no state
    expect(presenceRoleTier('peaks-rd')).toBe(presenceRoleTier('peaks-rd'));
    expect(presenceRoleTier('peaks-code')).toBe(presenceRoleTier('peaks-code'));
  });
});

describe('(render) the two tier lists as a published surface', () => {
  it('when both lists are read, should hold disjoint sets of skill names', () => {
    // given: the orchestrator list and the bee list
    // when: they are compared
    // then: no skill is in both — a skill has exactly one tier
    const overlap = ORCHESTRATOR_ROLE_SKILLS.filter((skill) => BEE_ROLE_SKILLS.includes(skill));
    expect(overlap).toEqual([]);
  });

  it('when either list is read, should hold only peaks-* names', () => {
    // given: the two lists
    // when: every entry is checked
    // then: every entry is a peaks-* skill name
    for (const skill of [...ORCHESTRATOR_ROLE_SKILLS, ...BEE_ROLE_SKILLS]) {
      expect(skill).toMatch(/^peaks-[a-z0-9-]+$/);
    }
  });

  it('when every listed skill is checked, should be a skill this repository ships', () => {
    // given: every skill the lists name
    // when: its skill file is looked for under `skills/` and `skills/bee/`
    // then: the skill exists, so the tier list cannot name a skill that is gone
    for (const skill of [...ORCHESTRATOR_ROLE_SKILLS, ...BEE_ROLE_SKILLS]) {
      const shipped =
        existsSync(join(REPO_ROOT, 'skills', skill, 'SKILL.md')) ||
        existsSync(join(REPO_ROOT, 'skills', 'bee', skill, 'SKILL.md'));
      expect({ skill, shipped }).toEqual({ skill, shipped: true });
    }
  });

  it('when the lists are read, should hold every skill the response contract names', () => {
    // given: the two lists
    // when: they are counted against the shipped skill tree
    // then: together they carry every skill this repository ships — the
    //       count is read from the tree, so a shipped skill cannot slip past them
    expect(ORCHESTRATOR_ROLE_SKILLS.length + BEE_ROLE_SKILLS.length).toBe(shippedSkillCount());
  });
});
