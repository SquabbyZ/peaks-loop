// tests/unit/skills/peaks-design-skill.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { presenceRoleTier } from '../../../src/services/skills/presence-role.js';

declareDimensions('tests/unit/skills/peaks-design-skill.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const BODY = readFileSync(join('skills', 'peaks-design', 'SKILL.md'), 'utf8');

describe('Scenario: behavior — the design orchestrator contract', () => {
  it('when the skill is registered, should have the orchestrator tier', () => {
    // given: the shipped skill set
    // when: the role tier is read
    // then: it is an orchestrator
    expect(presenceRoleTier('peaks-design')).toBe('orchestrator');
  });

  it('when the skill body is read, should reference the loop guideline and the CLI', () => {
    // given: the skill body
    // when: the required references are checked
    // then: both are present
    expect(BODY).toContain('.peaks/standards/loop-engineering-guidelines.md');
    expect(BODY).toContain('peaks design check');
  });

  it('when the skill body is read, should forbid direct source edits', () => {
    // given: the skill body
    // when: the red line is checked
    // then: it names the RD dispatch requirement
    expect(BODY).toContain('peaks sub-agent dispatch rd');
  });
});
