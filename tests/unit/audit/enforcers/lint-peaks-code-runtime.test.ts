/**
 * Slice 2026-07-29-rid-prose-only-sweep-009 — peaks-code SKILL.md
 * runtime contract tests.
 */

import { describe, expect, test } from 'vitest';
import { lintPeaksCodeRuntimeContract } from '../../../../src/services/audit/enforcers/lint-peaks-code-runtime.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makePeakCodeSkill(body: string): SkillFile {
  return {
    name: 'peaks-code',
    path: 'skills/peaks-code/SKILL.md',
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintPeaksCodeRuntimeContract', () => {
  test('emits a hit with the missing-markers list when sections are absent', () => {
    const skill = makePeakCodeSkill('## Runbook\n');
    const hits = lintPeaksCodeRuntimeContract(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-code-runtime-contract-001');
    expect(hits[0]?.matchedText).toMatch(/Scope/);
    expect(hits[0]?.matchedText).toMatch(/Step 11/);
  });

  test('emits a partial hit when only some markers are present', () => {
    const skill = makePeakCodeSkill([
      '## Scope (RL-8 — red line, locked 2026-07-08)',
      '## Peaks-Loop Startup sequence (MANDATORY)'
    ].join('\n'));
    const hits = lintPeaksCodeRuntimeContract(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/missing markers/);
  });

  test('non-peaks-code SKILL.md is not enforcer-targeted', () => {
    const skill: SkillFile = {
      name: 'peaks-rd',
      path: 'skills/bee/peaks-rd/SKILL.md',
      body: '## Scope\n',
      lines: ['## Scope']
    };
    expect(lintPeaksCodeRuntimeContract(skill)).toEqual([]);
  });
});
