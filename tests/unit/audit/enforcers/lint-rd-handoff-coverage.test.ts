/**
 * Slice 2026-07-29-rid-prose-only-sweep-005 — closes peaks-rd
 * discovered lines md-121 / md-127 (handoff) + md-162 (coverage).
 */

import { describe, expect, test } from 'vitest';
import {
  lintRdHandoffContract,
  lintRdCoverageDiscipline
} from '../../../../src/services/audit/enforcers/lint-rd-handoff-coverage.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makeRdSkill(body: string): SkillFile {
  return {
    name: 'peaks-rd',
    path: 'skills/bee/peaks-rd/SKILL.md',
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintRdHandoffContract', () => {
  test('passes when both handoff markers are present', () => {
    const skill = makeRdSkill([
      '**BLOCKING — Do not hand off to QA without this file.** Every RD invocation that touches code MUST produce a tech-doc artifact.',
      '',
      '**BLOCKING — Do not hand off to QA without a perf-baseline file when the slice has a user-visible performance surface.**'
    ].join('\n'));
    expect(lintRdHandoffContract(skill)).toEqual([]);
  });

  test('emits a hit when tech-doc marker is missing', () => {
    const skill = makeRdSkill([
      '**BLOCKING — Do not hand off to QA without a perf-baseline file.**'
    ].join('\n'));
    const hits = lintRdHandoffContract(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-rd-handoff-contract-001');
    expect(hits[0]?.matchedText).toMatch(/tech-doc/);
  });

  test('non-peaks-rd SKILL.md is not enforcer-targeted', () => {
    const skill: SkillFile = {
      name: 'peaks-prd',
      path: 'skills/bee/peaks-prd/SKILL.md',
      body: '## Runbook',
      lines: ['## Runbook']
    };
    expect(lintRdHandoffContract(skill)).toEqual([]);
  });
});

describe('lintRdCoverageDiscipline', () => {
  test('passes when target + no-padding are both present', () => {
    const skill = makeRdSkill([
      '## Unit-test coverage red line',
      '',
      'The 100% coverage target on testable files is meaningful coverage, not a score to chase. RD must not write coverage-padding tests.'
    ].join('\n'));
    expect(lintRdCoverageDiscipline(skill)).toEqual([]);
  });

  test('emits a hit when no-padding rule is missing', () => {
    const skill = makeRdSkill([
      'The 100% coverage target on testable files is meaningful coverage.'
    ].join('\n'));
    const hits = lintRdCoverageDiscipline(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/coverage-padding/);
  });
});
