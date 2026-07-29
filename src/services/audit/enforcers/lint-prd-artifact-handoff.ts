/**
 * P2-b sweep 004 — PRD artifact handoff enforcer.
 *
 * Closes three peaks-prd discovered lines (md-99, md-166, md-193):
 *  - 99  : preserved behavior section in the PRD template
 *  - 166 : "5.5 — write the immutable handoff" step
 *  - 193 : "Transition verification gates" section
 *
 * The three are one logical contract (the PRD runbook must
 * declare these handoff markers). A single enforcer scanning
 * the SKILL.md for all three closes the cluster in one pass.
 *
 * scope: peaks-prd only.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const PRESERVED_BEHAVIOR = /\bPreserved behavior\b/;
const HANDOFF_STEP_5_5 = /5\.5\s*—\s*write the immutable handoff/im;
const TRANSITION_GATES = /Transition verification gates/im;

function findPrdHandoffContract(lines: ReadonlyArray<string>): {
  preserved: boolean;
  handoffStep: boolean;
  transitionGates: boolean;
} {
  let preserved = false;
  let handoffStep = false;
  let transitionGates = false;
  for (const line of lines) {
    if (PRESERVED_BEHAVIOR.test(line)) preserved = true;
    if (HANDOFF_STEP_5_5.test(line)) handoffStep = true;
    if (TRANSITION_GATES.test(line)) transitionGates = true;
  }
  return { preserved, handoffStep, transitionGates };
}

export function lintPrdArtifactHandoff(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-prd') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const { preserved, handoffStep, transitionGates } = findPrdHandoffContract(lines);
  if (preserved && handoffStep && transitionGates) return [];
  const missing: string[] = [];
  if (!preserved) missing.push('Preserved behavior');
  if (!handoffStep) missing.push('step 5.5 (write the immutable handoff)');
  if (!transitionGates) missing.push('Transition verification gates');
  return [{
    catalogId: 'rl-prd-artifact-handoff-001',
    rule: 'peaks-prd SKILL.md must declare the artifact handoff contract (Preserved behavior + step 5.5 + Transition verification gates)',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}
