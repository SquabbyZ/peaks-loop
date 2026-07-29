/**
 * P2-b sweep 006 — peaks-qa gateguard + runtime contract.
 *
 * Closes four peaks-qa discovered lines:
 *  - md-26  : "Pre-flight: gateguard-fact-force conflict" (BLOCKING)
 *  - md-113 : "Transition verification gates" (MANDATORY)
 *  - md-165 : "if playwright mcp is unavailable, the llm checks" (BLOCKING)
 *  - md-201 : "when the target repository has openspec/, qa must" (BLOCKING)
 *
 * Two enforcers:
 *  - lintQaGateguardPreflight: peaks-qa only; checks the
 *    gateguard-fact-force pre-flight heading.
 *  - lintQaRuntimeContract: peaks-qa only; checks for
 *    transition gates + playwright mcp handling + openspec
 *    integration.
 */
import type { LintHit, SkillFile } from './lint-style.js';

const GATEGUARD_HEADING = /Pre-flight:\s*gateguard-fact-force conflict/im;
const TRANSITION_GATES = /Transition verification gates/im;
const PLAYWRIGHT_MCP = /if playwright mcp is unavailable/i;
const OPENSPEC_INTEGRATION = /when the target repository has openspec\//i;

export function lintQaGateguardPreflight(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-qa') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const hasGateguard = lines.some((l) => GATEGUARD_HEADING.test(l));
  if (hasGateguard) return [];
  return [{
    catalogId: 'rl-qa-gateguard-preflight-001',
    rule: 'peaks-qa SKILL.md must declare the `## Pre-flight: gateguard-fact-force conflict (BLOCKING)` section',
    file: skill.path,
    line: 1,
    matchedText: 'missing gateguard pre-flight heading'
  }];
}

export function lintQaRuntimeContract(skill: SkillFile): ReadonlyArray<LintHit> {
  if (skill.name !== 'peaks-qa') return [];
  const lines = skill.lines.length > 0
    ? skill.lines
    : skill.body.split(/\r?\n/);
  const hasTransition = lines.some((l) => TRANSITION_GATES.test(l));
  const hasPlaywright = lines.some((l) => PLAYWRIGHT_MCP.test(l));
  const hasOpenSpec = lines.some((l) => OPENSPEC_INTEGRATION.test(l));
  if (hasTransition && hasPlaywright && hasOpenSpec) return [];
  const missing: string[] = [];
  if (!hasTransition) missing.push('Transition verification gates');
  if (!hasPlaywright) missing.push('Playwright MCP unavailability handling');
  if (!hasOpenSpec) missing.push('OpenSpec integration requirement');
  return [{
    catalogId: 'rl-qa-runtime-contract-001',
    rule: 'peaks-qa SKILL.md must declare the runtime contract (transition gates + Playwright MCP + OpenSpec integration)',
    file: skill.path,
    line: 1,
    matchedText: `missing markers: ${missing.join(', ')}`
  }];
}
