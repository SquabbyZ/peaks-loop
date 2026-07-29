/**
 * Slice 2026-07-29-rid-prose-only-sweep-007 — closes peaks-ui
 * (3) + peaks-txt (2) + peaks-perf-audit (1) discovered lines.
 */

import { describe, expect, test } from 'vitest';
import {
  lintPeaksUiSuperpowersChain,
  lintPeaksUiInvolvement,
  lintPeaksTxtUpstream,
  lintPeaksPerfAuditScope
} from '../../../../src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(name: string, body: string): SkillFile {
  return {
    name,
    path: `skills/bee/${name}/SKILL.md`,
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintPeaksUiSuperpowersChain', () => {
  test('passes when both markers are present', () => {
    const skill = makeSkill('peaks-ui', [
      'You MUST NOT follow the superpowers chain for worktree decisions.',
      '',
      'The superpowers skills remain available as reference material for brainstorming.'
    ].join('\n'));
    expect(lintPeaksUiSuperpowersChain(skill)).toEqual([]);
  });

  test('emits a hit when reference-material marker is missing', () => {
    const skill = makeSkill('peaks-ui', 'You MUST NOT follow the superpowers chain for worktree decisions.\n');
    const hits = lintPeaksUiSuperpowersChain(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/reference material/);
  });
});

describe('lintPeaksUiInvolvement', () => {
  test('passes when ui-involvement marker is present', () => {
    const skill = makeSkill('peaks-ui', '## Step 1: identify ui involvement (for frontend changes)\n');
    expect(lintPeaksUiInvolvement(skill)).toEqual([]);
  });

  test('emits a hit when missing', () => {
    const skill = makeSkill('peaks-ui', '## Some other heading\n');
    const hits = lintPeaksUiInvolvement(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-ui-involvement-001');
  });
});

describe('lintPeaksTxtUpstream', () => {
  test('passes when both markers are present', () => {
    const skill = makeSkill('peaks-txt', [
      '## 1. inspect upstream skill content before applying any method.',
      '',
      '## 2. memory block embedding rule (MANDATORY)'
    ].join('\n'));
    expect(lintPeaksTxtUpstream(skill)).toEqual([]);
  });

  test('emits a hit when memory-block marker is missing', () => {
    const skill = makeSkill('peaks-txt', '## 1. inspect upstream skill content before applying any method.\n');
    const hits = lintPeaksTxtUpstream(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/memory block/);
  });
});

describe('lintPeaksPerfAuditScope', () => {
  test('passes when non-perf MUST NOT is present', () => {
    const skill = makeSkill('peaks-perf-audit', 'For non-perf-shaped slices, the slice MUST NOT invoke this skill (non-perf).\n');
    expect(lintPeaksPerfAuditScope(skill)).toEqual([]);
  });

  test('emits a hit when missing', () => {
    const skill = makeSkill('peaks-perf-audit', '## Runbook\n');
    const hits = lintPeaksPerfAuditScope(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.catalogId).toBe('rl-peaks-perf-audit-scope-001');
  });

  test('non-target skill is not enforcer-targeted', () => {
    const skill = makeSkill('peaks-rd', 'For non-perf-shaped slices, the slice MUST NOT invoke this skill.\n');
    expect(lintPeaksPerfAuditScope(skill)).toEqual([]);
  });
});
