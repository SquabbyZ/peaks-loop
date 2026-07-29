/**
 * P2-b sweep 005 — peaks-rd handoff + coverage enforcers.
 *
 * Closes three peaks-rd discovered lines:
 *  - md-121 : "do not hand off to QA without [tech-doc.md]" (BLOCKING)
 *  - md-127 : "do not hand off to QA without a perf-baseline" (BLOCKING)
 *  - md-162 : "100% coverage target on testable files is meaningful"
 *
 * Two enforcers (handoff + coverage). The handoff enforcer
 * checks for both 'tech-doc' and 'perf-baseline' handoff
 * markers; the coverage enforcer checks for the 100%-target
 * phrasing + the no-coverage-padding rule.
 *
 * scope: peaks-rd only.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const TECH_DOC_HANDOFF = /do not hand off to qa without[^\n]*tech-doc/im;
const PERF_BASELINE_HANDOFF = /do not hand off to qa without[^\n]*perf-baseline/im;

const COVERAGE_TARGET = /100%\s*coverage target[^\n]*testable files/i;
const NO_PADDING = /must not write coverage-padding tests/i;

function findHandoffContract(lines: ReadonlyArray<string>): { techDoc: boolean; perfBaseline: boolean } {
  let techDoc = false;
  let perfBaseline = false;
  for (const line of lines) {
    if (TECH_DOC_HANDOFF.test(line)) techDoc = true;
    if (PERF_BASELINE_HANDOFF.test(line)) perfBaseline = true;
  }
  return { techDoc, perfBaseline };
}

function findCoverageContract(lines: ReadonlyArray<string>): { target: boolean; noPadding: boolean } {
  let target = false;
  let noPadding = false;
  for (const line of lines) {
    if (COVERAGE_TARGET.test(line)) target = true;
    if (NO_PADDING.test(line)) noPadding = true;
  }
  return { target, noPadding };
}

export function lintRdHandoffContract(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-rd') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const { techDoc, perfBaseline } = findHandoffContract(lines);
  if (techDoc && perfBaseline) return [];
  const missing: string[] = [];
  if (!techDoc) missing.push('tech-doc handoff BLOCKING');
  if (!perfBaseline) missing.push('perf-baseline handoff BLOCKING');
  return [{
    catalogId: 'rl-rd-handoff-contract-001',
    rule: 'peaks-rd SKILL.md must declare the QA-handoff BLOCKING contract (tech-doc + perf-baseline)',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}

export function lintRdCoverageDiscipline(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-rd') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const { target, noPadding } = findCoverageContract(lines);
  if (target && noPadding) return [];
  const missing: string[] = [];
  if (!target) missing.push('100% coverage target (testable files) phrasing');
  if (!noPadding) missing.push('"must not write coverage-padding tests" rule');
  return [{
    catalogId: 'rl-rd-coverage-discipline-001',
    rule: 'peaks-rd SKILL.md must declare the coverage discipline (100% target + no-padding rule)',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}
