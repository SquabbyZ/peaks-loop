import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = resolve(__dirname, '..', '..', 'skills');

const rdSkill = readFileSync(join(SKILLS_ROOT, 'peaks-rd', 'SKILL.md'), 'utf8');
const qaSkill = readFileSync(join(SKILLS_ROOT, 'peaks-qa', 'SKILL.md'), 'utf8');
const workflowGatesRef = readFileSync(
  join(SKILLS_ROOT, 'peaks-solo', 'references', 'workflow-gates-and-types.md'),
  'utf8',
);

describe('4-way parallel fan-out (slice 004)', () => {
  describe('peaks-rd/SKILL.md fan-out section', () => {
    test('declares 4 sub-agents in the fan-out section', () => {
      // The fan-out section is `## Parallel review fan-out (...)`
      const fanOutSectionMatch = rdSkill.match(
        /## Parallel review fan-out.*?(?=\n## |\Z)/s,
      );
      expect(fanOutSectionMatch).not.toBeNull();
      const section = fanOutSectionMatch![0];

      // All 4 sub-agents should be mentioned by name
      expect(section).toMatch(/code-reviewer/);
      expect(section).toMatch(/security-reviewer/);
      expect(section).toMatch(/perf-baseline-reviewer/);
      expect(section).toMatch(/qa-test-cases-writer/);
    });

    test('qa-test-cases-writer sub-agent writes to qa/test-cases/<rid>.md', () => {
      // The 4th sub-agent section must mention the output path
      const writerSection = rdSkill.match(
        /\*\*Sub-agent 4 — qa-test-cases-writer[\s\S]*?(?=\*\*Hard prohibitions|\Z)/,
      );
      expect(writerSection).not.toBeNull();
      expect(writerSection![0]).toContain('qa/test-cases/<rid>.md');
    });

    test('qa-test-cases-writer contract: do NOT execute tests, do NOT write to tests/ dir', () => {
      // The 4th sub-agent section must include the "do not execute" + "do not write to tests/" prohibitions
      const writerSection = rdSkill.match(
        /\*\*Sub-agent 4 — qa-test-cases-writer[\s\S]*?(?=\*\*Hard prohibitions|\Z)/,
      );
      expect(writerSection).not.toBeNull();
      // The contract says the sub-agent drafts the test plan, doesn't execute it
      expect(writerSection![0]).toMatch(/do NOT need to be executed by this sub-agent/);
    });

    test('Gate C table includes qa/test-cases/<rid>.md for feature/refactor', () => {
      // The Gate C CLI enforcement table is in the "RD evidence" section
      // Each row is a single long line; check that "feature / refactor" is followed
      // by "qa/test-cases" on the same line.
      const featureRow = rdSkill
        .split('\n')
        .find((line) => line.includes('| feature / refactor'));
      expect(featureRow, 'feature/refactor row should exist in Gate C table').toBeDefined();
      expect(featureRow).toContain('qa/test-cases/<rid>.md');
    });

    test('Gate C table includes qa/test-cases/<rid>.md for bugfix', () => {
      const bugfixRow = rdSkill
        .split('\n')
        .find((line) => line.includes('| bugfix'));
      expect(bugfixRow, 'bugfix row should exist in Gate C table').toBeDefined();
      expect(bugfixRow).toContain('qa/test-cases/<rid>.md');
    });

    test('config/docs/chore rows do NOT include qa/test-cases (no acceptance surface)', () => {
      // The config row only has security-review
      const configRow = rdSkill
        .split('\n')
        .find((line) => line.includes('| config'));
      expect(configRow, 'config row should exist in Gate C table').toBeDefined();
      expect(configRow).not.toContain('qa/test-cases');

      // docs/chore row is empty
      const docsRow = rdSkill
        .split('\n')
        .find((line) => line.includes('| docs / chore'));
      expect(docsRow, 'docs/chore row should exist in Gate C table').toBeDefined();
      expect(docsRow).not.toContain('qa/test-cases');
    });

    test('Aggregation step now runs 4 ls checks (B3, B4, B9, plus qa-test-cases)', () => {
      const aggregationMatch = rdSkill.match(
        /\*\*Aggregation[\s\S]*?(?=\*\*Degradation|\Z)/,
      );
      expect(aggregationMatch).not.toBeNull();
      const section = aggregationMatch![0];
      // 4 ls checks: code-review, security-review, perf-baseline, qa-test-cases
      expect(section).toContain('Gate B3');
      expect(section).toContain('Gate B4');
      expect(section).toContain('Gate B9');
      expect(section).toMatch(/qa-test-cases|qa\/test-cases/);
    });

    test('Degradation: qa-test-cases sub-agent failure falls back to inline QA drafting', () => {
      const degradationMatch = rdSkill.match(
        /\*\*Degradation[\s\S]*?(?=\*\*Why this works|\Z)/,
      );
      expect(degradationMatch).not.toBeNull();
      expect(degradationMatch![0]).toContain('qa-test-cases-subagent-degraded-to-inline-qa-draft');
    });
  });

  describe('peaks-solo/references/workflow-gates-and-types.md Gate C', () => {
    test('feature/refactor row (in the bash code block) includes qa/test-cases/<rid>.md', () => {
      // The Gate C content is inside a ```bash code block.
      // The row we want is the commented-out line `#   feature / refactor → ls ...`.
      // A more specific match: the row is preceded by `# Type-specific RD evidence` and
      // contains both `feature / refactor` and `qa/test-cases`.
      const featureRow = workflowGatesRef
        .split('\n')
        .find((line) => line.includes('feature / refactor') && line.includes('qa/test-cases'));
      expect(featureRow, 'feature/refactor row in Gate C bash block should include qa/test-cases').toBeDefined();
    });

    test('bugfix row (in the bash code block) includes qa/test-cases/<rid>.md', () => {
      const bugfixRow = workflowGatesRef
        .split('\n')
        .find((line) => line.includes('rd/bug-analysis.md') && line.includes('qa/test-cases'));
      expect(bugfixRow, 'bugfix row in Gate C bash block should include qa/test-cases').toBeDefined();
    });
  });

  describe('peaks-qa/SKILL.md (downstream consumer)', () => {
    test('QA main loop is aware of pre-drafted test-cases (slice 004 optimization)', () => {
      // The QA test-case generation step (step 4) should mention the optimization
      expect(qaSkill).toContain('pre-drafted');
      expect(qaSkill).toContain('slice 004');
    });

    test('QA fallback: if qa/test-cases/<rid>.md is missing, draft inline as before', () => {
      // The QA main loop should still know how to draft test-cases inline if the
      // pre-drafted file is missing (sub-agent failure)
      expect(qaSkill).toContain('Missing');
      expect(qaSkill).toMatch(/drafts it inline/);
    });
  });

  describe('Hard prohibitions preserved across all 4 sub-agents', () => {
    test('All 4 sub-agents are covered by the same Hard prohibitions block', () => {
      // The hard-prohibitions block must be a single block (not duplicated per sub-agent)
      const prohibitionsMatch = rdSkill.match(
        /\*\*Hard prohibitions on all 4 sub-agents[\s\S]*?(?=\*\*Aggregation|\Z)/,
      );
      expect(prohibitionsMatch).not.toBeNull();
      // Key prohibitions
      expect(prohibitionsMatch![0]).toContain('Skill(skill="...")');
      expect(prohibitionsMatch![0]).toContain('peaks skill presence:set');
    });
  });
});
