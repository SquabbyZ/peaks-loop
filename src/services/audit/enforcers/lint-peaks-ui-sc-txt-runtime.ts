/**
 * P2-b sweep 007 — peaks-ui / peaks-txt / peaks-perf-audit runtime
 * contract enforcers. Closes the remaining 6 discovered lines:
 *
 *  - peaks-ui-skill-md-X (3 lines):
 *      identify ui involvement
 *      superpowers chain refusal (L1 worktree governance)
 *      superpowers skills remain available as reference material
 *  - peaks-txt-skill-md-X (2 lines):
 *      inspect upstream skill content before applying any method
 *      memory block embedding rule
 *  - peaks-perf-audit-skill-md-X (1 line):
 *      MUST NOT invoke perf-audit for non-perf slices
 *
 * Four enforcers in one file (the runtime contract cluster):
 *  - lintPeaksUiSuperpowersChain — both superpowers-refusal
 *    + reference-material markers required.
 *  - lintPeaksTxtUpstreamInspection — the inspect-upstream
 *    + memory-block markers.
 *  - lintPeaksPerfAuditScope — the non-perf MUST NOT.
 *  - lintPeaksUiInvolvement — the ui-involvement identification
 *    block (peaks-ui only).
 */
import type { LintHit, SkillFile } from './lint-style.js';

const SUPERPOWERS_REFUSAL = /MUST NOT follow the superpowers chain/i;
const SUPERPOWERS_REFERENCE = /superpowers skills remain available as reference material/i;
const UI_INVOLVEMENT = /identify ui involvement/i;
const TXT_INSPECT_UPSTREAM = /inspect upstream skill content before applying any method/i;
const TXT_MEMORY_BLOCK = /memory block embedding rule/i;
const PERF_AUDIT_NON_PERF = /MUST NOT invoke this skill[\s\S]*?non-perf/i;

export function lintPeaksUiSuperpowersChain(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-ui') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const hasRefusal = lines.some((l) => SUPERPOWERS_REFUSAL.test(l));
  const hasReference = lines.some((l) => SUPERPOWERS_REFERENCE.test(l));
  if (hasRefusal && hasReference) return [];
  const missing: string[] = [];
  if (!hasRefusal) missing.push('MUST NOT follow the superpowers chain');
  if (!hasReference) missing.push('superpowers skills remain available as reference material');
  return [{
    catalogId: 'rl-peaks-ui-superpowers-chain-001',
    rule: 'peaks-ui SKILL.md must declare the superpowers chain refusal + reference-material contract',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}

export function lintPeaksUiInvolvement(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-ui') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const hasInvolvement = lines.some((l) => UI_INVOLVEMENT.test(l));
  if (hasInvolvement) return [];
  return [{
    catalogId: 'rl-peaks-ui-involvement-001',
    rule: 'peaks-ui SKILL.md must declare the UI-involvement identification block',
    file: skill.path,
    line: 1,
    matchedText: 'missing "identify ui involvement" marker'
  }];
}

export function lintPeaksTxtUpstream(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-txt') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const hasInspect = lines.some((l) => TXT_INSPECT_UPSTREAM.test(l));
  const hasMemoryBlock = lines.some((l) => TXT_MEMORY_BLOCK.test(l));
  if (hasInspect && hasMemoryBlock) return [];
  const missing: string[] = [];
  if (!hasInspect) missing.push('inspect upstream skill content before applying any method');
  if (!hasMemoryBlock) missing.push('memory block embedding rule');
  return [{
    catalogId: 'rl-peaks-txt-upstream-001',
    rule: 'peaks-txt SKILL.md must declare the upstream-inspection + memory-block contract',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}

export function lintPeaksPerfAuditScope(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-perf-audit') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const hasNonPerf = lines.some((l) => PERF_AUDIT_NON_PERF.test(l));
  if (hasNonPerf) return [];
  return [{
    catalogId: 'rl-peaks-perf-audit-scope-001',
    rule: 'peaks-perf-audit SKILL.md must declare the non-perf MUST NOT invoke clause',
    file: skill.path,
    line: 1,
    matchedText: 'missing "MUST NOT invoke this skill for non-perf slices" marker'
  }];
}
