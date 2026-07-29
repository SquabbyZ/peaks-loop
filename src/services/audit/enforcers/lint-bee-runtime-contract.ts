/**
 * P2-b sweep 008 — peaks-rd / peaks-ui / peaks-txt / peaks-sc
 * runtime contract enforcer. Closes six discovered lines:
 *
 *  - peaks-rd-skill-md-166 : OpenSpec usage (BLOCKING)
 *  - peaks-rd-skill-md-184 : Frontend project generation (MUST NOT)
 *  - peaks-sc-skill-md-150 : Transition verification gates (MANDATORY)
 *  - peaks-txt-skill-md-266 : Memory block embedding rule (MANDATORY)
 *  - peaks-txt-skill-md-277 : Transition verification gates (MANDATORY)
 *  - peaks-ui-skill-md-188 : Transition verification gates (MANDATORY)
 *
 * The contract is a single enforcer per skill: each skill
 * declares its own runtime contract markers. The sweep covers
 * 3 marker classes (OpenSpec, FrontendGen, TransitionGates,
 * MemoryBlock) by 4 skills (rd, ui, sc, txt).
 *
 * scope: each helper scopes to a specific skill via the
 * `name` field on SkillFile; ui-363 + peaks-rd-58 (skill
 * presence) are already closed by sweep 003.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const OPENSPEC_USAGE = /use openspec when the/i;
const FRONTEND_PROJECT_GENERATION = /rd work creates a frontend application/i;
const TRANSITION_GATES = /Transition verification gates/im;
const MEMORY_BLOCK_EMBEDDING = /memory block embedding rule/i;

function findContract(lines: ReadonlyArray<string>): { openspec: boolean; frontendGen: boolean; transitionGates: boolean; memoryBlock: boolean } {
  let openspec = false;
  let frontendGen = false;
  let transitionGates = false;
  let memoryBlock = false;
  for (const line of lines) {
    if (OPENSPEC_USAGE.test(line)) openspec = true;
    if (FRONTEND_PROJECT_GENERATION.test(line)) frontendGen = true;
    if (TRANSITION_GATES.test(line)) transitionGates = true;
    if (MEMORY_BLOCK_EMBEDDING.test(line)) memoryBlock = true;
  }
  return { openspec, frontendGen, transitionGates, memoryBlock };
}

export function lintRdRuntimeContract(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-rd') return [];
  const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
  const { openspec, frontendGen } = findContract(lines);
  if (openspec && frontendGen) return [];
  const missing: string[] = [];
  if (!openspec) missing.push('OpenSpec usage');
  if (!frontendGen) missing.push('Frontend project generation');
  return [{
    catalogId: 'rl-peaks-rd-runtime-contract-001',
    rule: 'peaks-rd SKILL.md must declare the runtime contract (OpenSpec usage + Frontend project generation)',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}

export function lintUiTransitionGates(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-ui') return [];
  const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
  const { transitionGates } = findContract(lines);
  if (transitionGates) return [];
  return [{
    catalogId: 'rl-peaks-ui-transition-gates-001',
    rule: 'peaks-ui SKILL.md must declare the Transition verification gates section',
    file: skill.path,
    line: 1,
    matchedText: 'missing "Transition verification gates" heading'
  }];
}

export function lintScTransitionGates(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-sc') return [];
  const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
  const { transitionGates } = findContract(lines);
  if (transitionGates) return [];
  return [{
    catalogId: 'rl-peaks-sc-transition-gates-001',
    rule: 'peaks-sc SKILL.md must declare the Transition verification gates section',
    file: skill.path,
    line: 1,
    matchedText: 'missing "Transition verification gates" heading'
  }];
}

export function lintTxtRuntimeContract(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-txt') return [];
  const lines = skill.lines.length > 0 ? skill.lines : skill.body.split(/\r?\n/);
  const { transitionGates, memoryBlock } = findContract(lines);
  if (transitionGates && memoryBlock) return [];
  const missing: string[] = [];
  if (!transitionGates) missing.push('Transition verification gates');
  if (!memoryBlock) missing.push('Memory block embedding rule');
  return [{
    catalogId: 'rl-peaks-txt-runtime-contract-001',
    rule: 'peaks-txt SKILL.md must declare the runtime contract (Transition verification gates + Memory block embedding rule)',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}
