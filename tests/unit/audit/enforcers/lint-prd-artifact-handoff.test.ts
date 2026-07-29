/**
 * Slice 2026-07-29-rid-prose-only-sweep-004 — closes peaks-prd
 * discovered lines md-99 / md-166 / md-193 with one enforcer.
 */

import { describe, expect, test } from 'vitest';
import { lintPrdArtifactHandoff } from '../../../../src/services/audit/enforcers/lint-prd-artifact-handoff.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makePrdSkill(body: string): SkillFile {
  return {
    name: 'peaks-prd',
    path: 'skills/bee/peaks-prd/SKILL.md',
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintPrdArtifactHandoff', () => {
  test('passes when Preserved behavior + step 5.5 + Transition verification gates are all present', () => {
    const skill = makePrdSkill([
      '## Runbook',
      '',
      '3. **Preserved behavior** — existing behavior that must not change',
      '',
      '# 5.5 — write the immutable handoff (sha256-locked; BLOCKING before RD/QA handoff)',
      '',
      '### Transition verification gates (MANDATORY — run the command, see the output)'
    ].join('\n'));
    expect(lintPrdArtifactHandoff(skill)).toEqual([]);
  });

  test('emits a hit when step 5.5 is missing', () => {
    const skill = makePrdSkill([
      '## Runbook',
      '',
      '3. **Preserved behavior** — existing behavior that must not change',
      '',
      '### Transition verification gates (MANDATORY — run the command, see the output)'
    ].join('\n'));
    const hits = lintPrdArtifactHandoff(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-prd-artifact-handoff-001');
    expect(hits[0]?.matchedText).toMatch(/5\.5/);
  });

  test('emits a hit when preserved-behavior is missing', () => {
    const skill = makePrdSkill([
      '# 5.5 — write the immutable handoff (sha256-locked)',
      '',
      '### Transition verification gates (MANDATORY)'
    ].join('\n'));
    const hits = lintPrdArtifactHandoff(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/Preserved behavior/);
  });

  test('emits a hit when transition verification gates is missing', () => {
    const skill = makePrdSkill([
      '3. **Preserved behavior** — existing behavior',
      '',
      '# 5.5 — write the immutable handoff'
    ].join('\n'));
    const hits = lintPrdArtifactHandoff(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/Transition verification gates/);
  });

  test('non-peaks-prd SKILL.md is not enforcer-targeted', () => {
    const skill: SkillFile = {
      name: 'peaks-rd',
      path: 'skills/bee/peaks-rd/SKILL.md',
      body: '## Some other content',
      lines: ['## Some other content']
    };
    expect(lintPrdArtifactHandoff(skill)).toEqual([]);
  });
});
