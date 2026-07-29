/**
 * Slice 2026-07-29-rid-prose-only-sweep-001 — first prose-only
 * enforcer unit test. Closes `rl-discovered-skills-bee-peaks-prd-skill-md-56`
 * (and the parallel peaks-rd / peaks-qa lines) by promoting the
 * "Skill presence (MANDATORY first action)" heading to a
 * catalog entry with a real enforcerRef.
 *
 * Test surface: 3 cases.
 *  1. A peaks-prd SKILL.md that has the heading + body +
 *     MANDATORY marker returns zero hits (no false positive).
 *  2. A peaks-prd SKILL.md missing the heading returns a hit
 *     at the file's line 1 (synthetic line for missing
 *     sections).
 *  3. A non-peaks-* SKILL.md (e.g. peaks-zzz) is not
 *     enforcer-targeted (the enforcer scopes to peaks-* bee
 *     SKILL.md).
 */

import { describe, expect, test } from 'vitest';
import { lintSkillPresenceMandatory } from '../../../../src/services/audit/enforcers/lint-skill-presence-mandatory.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(name: string, body: string): SkillFile {
  return {
    name,
    path: `skills/bee/${name}/SKILL.md`,
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintSkillPresenceMandatory', () => {
  test('passes when the heading + body + MANDATORY marker are all present', () => {
    const skill = makeSkill('peaks-prd', [
      '## Frontmatter',
      '',
      '## Skill presence (MANDATORY first action)',
      '',
      'Before any analysis or tool call, immediately run:',
      '',
      '```bash',
      'peaks skill presence --set peaks-prd',
      '```'
    ].join('\n'));
    const hits = lintSkillPresenceMandatory(skill);
    expect(hits).toEqual([]);
  });

  test('emits a hit when the heading is missing', () => {
    const skill = makeSkill('peaks-prd', [
      '## Frontmatter',
      '',
      '## Runbook',
      '',
      'No skill-presence section here.'
    ].join('\n'));
    const hits = lintSkillPresenceMandatory(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-skill-presence-mandatory-001');
    expect(hits[0]?.line).toBe(1);
    expect(hits[0]?.matchedText).toMatch(/missing/);
  });

  test('emits a hit when the heading is present but the body is missing', () => {
    const skill = makeSkill('peaks-prd', [
      '## Skill presence (MANDATORY first action)',
      '',
      'TODO: write the body.'
    ].join('\n'));
    const hits = lintSkillPresenceMandatory(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-skill-presence-mandatory-001');
  });

  test('non-peaks-* SKILL.md is not enforcer-targeted (zero hits)', () => {
    // Use a name that does NOT start with 'peaks-' (the
    // enforcer's scope guard). Defends against accidental
    // widening to arbitrary bee skill names.
    const skill = makeSkill('some-other-skill', '## Some other heading\n');
    const hits = lintSkillPresenceMandatory(skill);
    expect(hits).toEqual([]);
  });

  test('non-bee SKILL.md (e.g. skills/ top-level) is not enforcer-targeted', () => {
    const skill: SkillFile = {
      name: 'peaks-prd',
      path: 'skills/peaks-prd/SKILL.md', // no /bee/ subdir
      body: '## Skill presence (MANDATORY first action)\n',
      lines: ['## Skill presence (MANDATORY first action)']
    };
    const hits = lintSkillPresenceMandatory(skill);
    expect(hits).toEqual([]);
  });
});
