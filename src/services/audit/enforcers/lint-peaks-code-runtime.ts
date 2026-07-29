/**
 * P2-b sweep 009 — peaks-code SKILL.md runtime contract.
 * Single enforcer closing 13 of the 33 remaining discovered
 * lines (peaks-code-skill-md-6, 79, 93, 111, 119, 121, 123,
 * 125, 153, 184, 188, 248).
 *
 * The contract is the section-marker skeleton that every
 * peaks-code SKILL.md must declare. Each heading is one of
 * the peaks-code runbook's red-line chapters; the enforcer
 * checks the headings are present and emits a hit on each
 * missing one.
 *
 * scope: peaks-code only.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const REQUIRED_HEADINGS: ReadonlyArray<{ name: string; pattern: RegExp }> = Object.freeze([
  { name: 'Scope (rl-8 red line)', pattern: /scope \(rl-8/i },
  { name: 'No auto-compact prose ban', pattern: /no auto-compact prose ban/i },
  { name: 'Superpowers 协作边界', pattern: /peaks-loop superpowers 协作边界/i },
  { name: 'npm-contract boundary', pattern: /npm-contract boundary/i },
  { name: 'Startup sequence', pattern: /peaks-loop startup sequence/i },
  { name: 'Step 0.8 job-shape detection', pattern: /step 0\.8.*job-shape detection/i },
  { name: 'Local intermediate artifact workspace', pattern: /peaks-loop local intermediate artifact workspace/i },
  { name: 'Pre-rd project scan checklist', pattern: /peaks-loop pre-rd project scan checklist/i },
  { name: 'Step 11 memory sediment', pattern: /step 11.*memory sediment/i },
  { name: '--enforce-job-mode (v3.1.2)', pattern: /enforce-job-mode \(v3\.1\.2\)/i }
]);

export function lintPeaksCodeRuntimeContract(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-code') return [];
  const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
  const missing: string[] = [];
  for (const h of REQUIRED_HEADINGS) {
    if (!lines.some((l) => h.pattern.test(l))) missing.push(h.name);
  }
  if (missing.length === 0) return [];
  return [{
    catalogId: 'rl-peaks-code-runtime-contract-001',
    rule: 'peaks-code SKILL.md must declare the runbook section markers (Scope, no auto-compact, superpowers bridge, npm-contract, startup sequence, step 0.8 job-shape, local intermediate artifact workspace, pre-rd project scan checklist, step 11 memory sediment, --enforce-job-mode v3.1.2).',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}
