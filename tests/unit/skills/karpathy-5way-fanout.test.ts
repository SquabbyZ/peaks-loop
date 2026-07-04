/**
 * karpathy-3way-fanout test (v2.12.0 — Group A collapse).
 *
 * Slice 5/6 — karpathy-enforcement pinned the original 5-way fan-out
 * (`code-reviewer` + `security-reviewer` + `perf-baseline-reviewer` +
 * `qa-test-cases-writer` + `karpathy-reviewer`). v2.12.0 Group A
 * collapsed that fan-out to **3 sub-agents** by moving
 * `security-reviewer` + `perf-baseline-reviewer` out into standalone
 * audit skills (`peaks-security-audit` + `peaks-perf-audit`).
 *
 * This file preserves the karpathy-enforcement contract tests from
 * slice 5/6 and re-pins them against the v2.12.0 3-way shape:
 *  - AC-1: SKILL.md 3-way fanout segment names the 3 reviewers
 *  - AC-2: rd-fanout-contracts.md contains the karpathy-reviewer contract
 *  - AC-3: rd-sub-agent-dispatch.md injects the 4-section karpathy context
 *  - AC-4: CLI `request transition` requires rd/karpathy-review.md
 *  - AC-5: `peaks scan karpathy` subcommand is registered with 3 options
 *  - AC-6: karpathy-service exports 4 violation types + 4-kind scan report
 *  - AC-7: v2.12.0 3-way — security-reviewer + perf-baseline-reviewer
 *          removed from the RD fan-out (RD_FANOUT_REVIEWERS = 3)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '..', '..', '..');

function read(rel: string): string {
  return readFileSync(resolve(REPO, rel), 'utf8');
}

function extractSection(body: string, heading: string): string {
  const start = body.indexOf(heading);
  if (start < 0) return '';
  const afterHeading = start + heading.length;
  const lineEnd = body.indexOf('\n', afterHeading);
  if (lineEnd < 0) return '';
  const rest = body.slice(lineEnd + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading < 0 ? rest : rest.slice(0, nextHeading);
}

describe('v2.12.0 — karpathy-3way-fanout (collapse from slice 5/6 5-way)', () => {
  it('AC-1.a peaks-rd/SKILL.md names karpathy-reviewer in the 3-way fanout section', () => {
    const skill = read('skills/peaks-rd/SKILL.md');
    expect(skill).toMatch(/3-way fanout/i);
    expect(skill).toMatch(/karpathy-reviewer/);
  });

  it('AC-1.b SKILL.md lists the 3 reviewer names in the fanout section (v2.12.0)', () => {
    const skill = read('skills/peaks-rd/SKILL.md');
    // v2.12.0 3-way fan-out: code-reviewer + qa-test-cases-writer + karpathy-reviewer.
    for (const name of ['code-reviewer', 'qa-test-cases-writer', 'karpathy-reviewer']) {
      expect(skill).toContain(name);
    }
  });

  it('AC-1.c SKILL.md describes karpathy-reviewer as a hard gate', () => {
    const skill = read('skills/peaks-rd/SKILL.md');
    expect(skill).toMatch(/Hard Karpathy-Gate|hard gate/i);
  });

  it('AC-1.d SKILL.md v2.12.0 collapse: security-reviewer + perf-baseline-reviewer removed from fan-out', () => {
    const skill = read('skills/peaks-rd/SKILL.md');
    // The fan-out section must cross-reference the standalone
    // peaks-security-audit + peaks-perf-audit skills that replaced
    // the removed sub-agent slots.
    const fanoutSection = extractSection(skill, '## Parallel review fan-out');
    expect(fanoutSection, 'fan-out section should exist').not.toBe('');
    expect(fanoutSection).toContain('peaks-security-audit');
    expect(fanoutSection).toContain('peaks-perf-audit');
    // The fan-out section must not enumerate the removed sub-agents
    // as fan-out sub-agents (Sub-agent N — <name> tag pattern).
    const subAgentTags = fanoutSection.match(/\*\*Sub-agent \d+ —[^*]+\*\*/g) ?? [];
    expect(subAgentTags.join(' ')).not.toMatch(/security-reviewer/);
    expect(subAgentTags.join(' ')).not.toMatch(/perf-baseline-reviewer/);
  });

  it('AC-2.a rd-fanout-contracts.md contains a karpathy-reviewer contract section', () => {
    const contracts = read('skills/peaks-rd/references/rd-fanout-contracts.md');
    expect(contracts).toMatch(/###\s+karpathy-reviewer/);
  });

  it('AC-2.b rd-fanout-contracts.md defines the 4 violation kinds', () => {
    const contracts = read('skills/peaks-rd/references/rd-fanout-contracts.md');
    for (const kind of ['think-before-coding', 'simplicity-first', 'surgical-changes', 'goal-driven-execution']) {
      expect(contracts).toContain(kind);
    }
  });

  it('AC-2.c rd-fanout-contracts.md defines the JSON envelope shape', () => {
    const contracts = read('skills/peaks-rd/references/rd-fanout-contracts.md');
    for (const key of ['passed', 'violations', 'gateAction']) {
      expect(contracts).toContain(key);
    }
  });

  it('AC-3 rd-sub-agent-dispatch.md injects the 4-section karpathy context block', () => {
    const dispatch = read('skills/peaks-rd/references/rd-sub-agent-dispatch.md');
    for (const heading of ['Think Before Coding', 'Simplicity First', 'Surgical Changes', 'Goal-Driven Execution']) {
      expect(dispatch).toContain(heading);
    }
  });

  it('AC-4 KARPATHY_REVIEW prereq is wired into the FEATURE_TABLE rd:qa-handoff row', () => {
    const prereq = read('src/services/artifacts/artifact-prerequisites.ts');
    expect(prereq).toContain('KARPATHY_REVIEW');
    // The feature table's rd:qa-handoff row must list KARPATHY_REVIEW.
    expect(prereq).toMatch(/'rd:qa-handoff':\s*\[[^\]]*KARPATHY_REVIEW[^\]]*\]/);
    // The 4 guideline markers must be referenced in the prereq.
    for (const marker of ['Think Before Coding', 'Simplicity First', 'Surgical Changes', 'Goal-Driven Execution']) {
      expect(prereq).toContain(marker);
    }
  });

  it('AC-5.a scan-commands.ts registers the karpathy subcommand', () => {
    const cmds = read('src/cli/commands/scan-commands.ts');
    expect(cmds).toMatch(/\.command\(\s*['"]karpathy['"]\s*\)/);
  });

  it('AC-5.b scan-commands.ts declares 3 options for karpathy (--project --format --scope)', () => {
    const cmds = read('src/cli/commands/scan-commands.ts');
    // Find the karpathy block, then assert 3 option calls inside
    // (1 .requiredOption for --project + 2 .option for --format / --scope).
    const start = cmds.indexOf(".command('karpathy')");
    expect(start).toBeGreaterThan(-1);
    // The next .command( defines the boundary.
    const next = cmds.indexOf('.command(', start + 1);
    const end = next === -1 ? cmds.length : next;
    const block = cmds.slice(start, end);
    const requiredOptionMatches = block.match(/\.requiredOption\(/g) ?? [];
    const optionMatches = block.match(/\.option\(/g) ?? [];
    expect(requiredOptionMatches.length + optionMatches.length).toBe(3);
  });

  it('AC-5.c scan-commands.ts karpathy description references the 4 guidelines', () => {
    const cmds = read('src/cli/commands/scan-commands.ts');
    const start = cmds.indexOf(".command('karpathy')");
    const next = cmds.indexOf('.command(', start + 1);
    const end = next === -1 ? cmds.length : next;
    const block = cmds.slice(start, end);
    expect(block).toMatch(/Think Before Coding|Simplicity First|Surgical Changes|Goal-Driven/);
  });

  it('AC-6.a karpathy-service.ts exports the 4 KarpathyViolationKind type union members', () => {
    const svc = read('src/services/scan/karpathy-service.ts');
    expect(svc).toMatch(/export type KarpathyViolationKind/);
    for (const kind of ['think-before-coding', 'simplicity-first', 'surgical-changes', 'goal-driven-execution']) {
      expect(svc).toContain(`'${kind}'`);
    }
  });

  it('AC-6.b karpathy-service.ts KarpathyScanReport has counts + sectionCoverage + violations + gateAction', () => {
    const svc = read('src/services/scan/karpathy-service.ts');
    expect(svc).toMatch(/export type KarpathyScanReport/);
    expect(svc).toContain('counts');
    expect(svc).toContain('sectionCoverage');
    expect(svc).toContain('violations');
    expect(svc).toContain('gateAction');
  });

  it('AC-6.c karpathy-service.ts exports scanKarpathy + formatKarpathyMarkdown', () => {
    const svc = read('src/services/scan/karpathy-service.ts');
    expect(svc).toMatch(/export async function scanKarpathy/);
    expect(svc).toMatch(/export function formatKarpathyMarkdown/);
  });

  it('AC-7.a reviewer-dispatch-policy.ts RD_FANOUT_REVIEWERS = 3 (v2.12.0 collapse)', () => {
    const policy = read('src/services/rd/reviewer-dispatch-policy.ts');
    // The 3-element fan-out (v2.12.0) replaces the 5-element one (v2.11.x).
    expect(policy).toMatch(
      /export const RD_FANOUT_REVIEWERS\s*=\s*\[[\s\S]*?'code-reviewer'[\s\S]*?'qa-test-cases-writer'[\s\S]*?'karpathy-reviewer'[\s\S]*?\]/,
    );
    // The removed reviewers MUST be exposed as RD_DEPRECATED_REVIEWERS.
    expect(policy).toMatch(/RD_DEPRECATED_REVIEWERS/);
    expect(policy).toContain("'security-reviewer'");
    expect(policy).toContain("'perf-baseline-reviewer'");
  });

  it('AC-7.b parallel-review-fanout.md is the v2.12.0 3-way fan-out reference', () => {
    const parallel = read('skills/peaks-rd/references/parallel-review-fanout.md');
    expect(parallel).toMatch(/3 sub-agents|v2\.12\.0/);
    // The removed sub-agents must NOT appear as live sub-agent entries.
    const subAgentBlocks = parallel.match(/\*\*Sub-agent \d+ —[^*]+\*\*/g) ?? [];
    expect(subAgentBlocks.length).toBe(3);
    expect(subAgentBlocks.join(' ')).not.toMatch(/security-reviewer/);
    expect(subAgentBlocks.join(' ')).not.toMatch(/perf-baseline-reviewer/);
  });
});
