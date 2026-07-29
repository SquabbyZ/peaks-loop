/**
 * Slice 2026-07-29-rid-prose-only-sweep-010 — peaks-* runtime
 * contract enforcer tests. Single enforcer file with 7
 * exported functions (one per peaks-* skill that has a
 * runtime contract in the sweep 010 batch). Closes 12 of
 * the 22 remaining discovered lines.
 */

import { describe, expect, test } from 'vitest';
import {
  lintPeaksAuditRuntime,
  lintPeaksContentRuntime,
  lintPeaksIdeRuntime,
  lintPeaksDoctorRuntime,
  lintPeaksIssueFixOrchestratorRuntime,
  lintPeaksSopRuntime,
  lintPeaksSliceDecomposeRuntime
} from '../../../../src/services/audit/enforcers/lint-peaks-skill-runtime.js';
import type { SkillFile } from '../../../../src/services/audit/enforcers/lint-style.js';

function makeSkill(name: string, body: string): SkillFile {
  return {
    name,
    path: `skills/bee/${name}/SKILL.md`,
    body,
    lines: body.split(/\r?\n/)
  };
}

describe('lintPeaksAuditRuntime', () => {
  test('passes when all 3 audit markers are present', () => {
    const skill = makeSkill('peaks-audit', [
      '## Six dimensions',
      '- The audit log is machine-readable (so peaks project scan can pick it up).',
      '- author identity = local gitconfig user.name / user.email.'
    ].join('\n'));
    expect(lintPeaksAuditRuntime(skill)).toEqual([]);
  });
  test('emits a hit with the missing-markers list when sections are absent', () => {
    const skill = makeSkill('peaks-audit', '## Runbook\n');
    const hits = lintPeaksAuditRuntime(skill);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedText).toMatch(/missing markers/);
  });
  test('non-peaks-audit SKILL.md is not enforcer-targeted', () => {
    const skill = makeSkill('peaks-rd', '## Six dimensions\n');
    expect(lintPeaksAuditRuntime(skill)).toEqual([]);
  });
});

describe('lintPeaksContentRuntime', () => {
  test('passes when all 3 content markers are present', () => {
    const skill = makeSkill('peaks-content', [
      '## What this skill do',
      '## Failure mode ( — read before declaring)',
      '## Each red line is written in the surrounding ±2 lines'
    ].join('\n'));
    expect(lintPeaksContentRuntime(skill)).toEqual([]);
  });
  test('emits a hit on missing markers', () => {
    const skill = makeSkill('peaks-content', '## Runbook\n');
    const hits = lintPeaksContentRuntime(skill);
    expect(hits).toHaveLength(1);
  });
});

describe('lintPeaksIdeRuntime', () => {
  test('passes when all 3 ide markers are present', () => {
    const skill = makeSkill('peaks-ide', [
      'This is a general workflow-gating tool, not a debugger.',
      '## What this skill do',
      '## For any consumer of the v2 envelope.'
    ].join('\n'));
    expect(lintPeaksIdeRuntime(skill)).toEqual([]);
  });
  test('emits a hit on missing markers', () => {
    const skill = makeSkill('peaks-ide', '## Runbook\n');
    const hits = lintPeaksIdeRuntime(skill);
    expect(hits).toHaveLength(1);
  });
});

describe('lintPeaksDoctorRuntime', () => {
  test('passes when peaks-doctor marker is present', () => {
    const skill = makeSkill('peaks-doctor', 'peaks-loop doctor is a doctor orchestrator, not a runbook.\n');
    expect(lintPeaksDoctorRuntime(skill)).toEqual([]);
  });
  test('emits a hit when marker is absent', () => {
    const skill = makeSkill('peaks-doctor', '## Runbook\n');
    const hits = lintPeaksDoctorRuntime(skill);
    expect(hits).toHaveLength(1);
  });
});

describe('lintPeaksIssueFixOrchestratorRuntime', () => {
  test('passes when both markers present', () => {
    const skill = makeSkill('peaks-issue-fix-orchestrator', [
      '## Deviation note: at the time of this writing',
      '// autonomous work proceed — return to human'
    ].join('\n'));
    expect(lintPeaksIssueFixOrchestratorRuntime(skill)).toEqual([]);
  });
});

describe('lintPeaksSopRuntime', () => {
  test('passes when both sop markers present', () => {
    const skill = makeSkill('peaks-sop', [
      '## Each red line below is written in the karpathy',
      '## When sop lint reports findings, fix them'
    ].join('\n'));
    expect(lintPeaksSopRuntime(skill)).toEqual([]);
  });
});

describe('lintPeaksSliceDecomposeRuntime', () => {
  test('passes when both slice-decompose markers present', () => {
    const skill = makeSkill('peaks-slice-decompose', [
      '## What this skill do',
      '### Failure mode ( — read before declaring a slice invalid)'
    ].join('\n'));
    expect(lintPeaksSliceDecomposeRuntime(skill)).toEqual([]);
  });
});
