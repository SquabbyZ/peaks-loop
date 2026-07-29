/**
 * Slice 2026-07-29-rid-prose-only-sweep-008 — peaks-rd / peaks-ui /
 * peaks-sc / peaks-txt runtime contract enforcer tests.
 */

import { describe, expect, test } from 'vitest';
import {
  lintRdRuntimeContract,
  lintUiTransitionGates,
  lintScTransitionGates,
  lintTxtRuntimeContract
} from '../../../../src/services/audit/enforcers/lint-bee-runtime-contract.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(name: string, body: string): SkillFile {
  return {
    name,
    path: `skills/bee/${name}/SKILL.md`,
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintRdRuntimeContract', () => {
  test('passes when OpenSpec + FrontendGen are both present', () => {
    const skill = makeSkill('peaks-rd', [
      '## OpenSpec usage',
      'For non-trivial RD changes, use OpenSpec when the project already has openspec/.',
      '',
      '## Frontend project generation',
      'When RD work creates a frontend application and the user has not specified a stack, default to React + Vite.'
    ].join('\n'));
    expect(lintRdRuntimeContract(skill)).toEqual([]);
  });

  test('emits a hit when OpenSpec is missing', () => {
    const skill = makeSkill('peaks-rd', '## Frontend project generation\nWhen RD work creates a frontend application\n');
    const hits = lintRdRuntimeContract(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-rd-runtime-contract-001');
    expect(hits[0]?.matchedText).toMatch(/OpenSpec/);
  });
});

describe('lintUiTransitionGates', () => {
  test('passes when Transition verification gates is present', () => {
    const skill = makeSkill('peaks-ui', '### Transition verification gates (MANDATORY — run the command, see the output)\n');
    expect(lintUiTransitionGates(skill)).toEqual([]);
  });
  test('emits a hit when missing', () => {
    const skill = makeSkill('peaks-ui', '## Runbook\n');
    const hits = lintUiTransitionGates(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-ui-transition-gates-001');
  });
  test('non-peaks-ui SKILL.md is not enforcer-targeted', () => {
    const skill = makeSkill('peaks-rd', '### Transition verification gates\n');
    expect(lintUiTransitionGates(skill)).toEqual([]);
  });
});

describe('lintScTransitionGates', () => {
  test('passes when present', () => {
    const skill = makeSkill('peaks-sc', '### Transition verification gates\n');
    expect(lintScTransitionGates(skill)).toEqual([]);
  });
  test('emits a hit when missing', () => {
    const skill = makeSkill('peaks-sc', '## Runbook\n');
    const hits = lintScTransitionGates(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-sc-transition-gates-001');
  });
});

describe('lintTxtRuntimeContract', () => {
  test('passes when both Transition gates + Memory block are present', () => {
    const skill = makeSkill('peaks-txt', [
      '### Transition verification gates (MANDATORY)',
      '',
      '## Memory block embedding rule (BLOCKING)'
    ].join('\n'));
    expect(lintTxtRuntimeContract(skill)).toEqual([]);
  });
  test('emits a hit when memory block is missing', () => {
    const skill = makeSkill('peaks-txt', '### Transition verification gates\n');
    const hits = lintTxtRuntimeContract(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/memory block/i);
  });
});
