/**
 * Slice 2026-07-29-rid-prose-only-sweep-002 — second prose-only
 * enforcer unit test. Closes rl-discovered-skills-bee-peaks-prd-skill-md-292
 * and -301 (Document snapshot placement + Prohibited paths).
 */

import { describe, expect, test } from 'vitest';
import { lintPrdSourceSnapshot } from '../../../../src/services/audit/enforcers/lint-prd-source-snapshot.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makePrdSkill(body: string): SkillFile {
  return {
    name: 'peaks-prd',
    path: 'skills/bee/peaks-prd/SKILL.md',
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintPrdSourceSnapshot', () => {
  test('passes when placement + prohibited-paths + subdir are all present', () => {
    const skill = makePrdSkill([
      '## Frontmatter',
      '',
      '## Document snapshot placement (BLOCKING)',
      '',
      'All intermediate snapshots MUST go into `.peaks/_runtime/<session-id>/prd/source/` — never to project root.',
      '',
      '**Prohibited paths** (BLOCKING):',
      '- `./feishu-doc-snapshot.md`'
    ].join('\n'));
    expect(lintPrdSourceSnapshot(skill)).toEqual([]);
  });

  test('emits a hit when placement heading is missing', () => {
    const skill = makePrdSkill([
      '## Frontmatter',
      '',
      '## Runbook',
      '',
      'No snapshot-placement section.'
    ].join('\n'));
    const hits = lintPrdSourceSnapshot(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-prd-source-snapshot-placement-001');
    expect(hits[0]?.line).toBe(1);
    expect(hits[0]?.matchedText).toMatch(/missing/);
  });

  test('emits a hit when placement present but prohibited-paths missing', () => {
    const skill = makePrdSkill([
      '## Document snapshot placement (BLOCKING)',
      '',
      'All intermediate snapshots MUST go into `.peaks/_runtime/<session-id>/prd/source/`.'
    ].join('\n'));
    const hits = lintPrdSourceSnapshot(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-prd-source-snapshot-placement-001');
  });

  test('non-peaks-prd SKILL.md is not enforcer-targeted (zero hits)', () => {
    const skill: SkillFile = {
      name: 'peaks-rd',
      path: 'skills/bee/peaks-rd/SKILL.md',
      body: '## Document snapshot placement (BLOCKING)\n',
      lines: ['## Document snapshot placement (BLOCKING)']
    };
    expect(lintPrdSourceSnapshot(skill)).toEqual([]);
  });
});
