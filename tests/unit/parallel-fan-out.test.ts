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
// Some long-form content (sub-agent contracts, hard prohibitions,
// aggregation, degradation) lives in references/ files so SKILL.md
// stays under the 20KB slim cap. Tests that pin on that content
// read the references/ file too and concatenate.
const rdRefBody = readFileSync(
  join(SKILLS_ROOT, 'peaks-rd', 'references', 'rd-fanout-contracts.md'),
  'utf8',
);
// Concatenate SKILL.md + reference so a regex match on either file
// succeeds. This matches the production `loadRunbookSection` pattern
// of preferring inline and falling back to references/.
const rdSkillWithRefs = rdSkill + '\n\n' + rdRefBody;

// Extract a markdown section by heading, scanning forward manually
// rather than relying on a `(?=\n## |\Z)` lookahead. Under the `m`
// flag, `$` matches end-of-line, which would let the lazy capture
// stop at the first newline. This helper does a non-regex
// forward-scan for the next `## ` heading and is stable on every
// platform. The returned body starts AFTER the heading line (not
// the heading substring) so the test can find sub-agent names that
// live in the body, not in the heading line's parenthetical
// suffix.
function extractSection(body: string, heading: string): string {
  const start = body.indexOf(heading);
  if (start < 0) return '';
  const afterHeading = start + heading.length;
  // Skip to the end of the heading line, then past the trailing
  // newlines, so the section body starts on its first content line.
  const lineEnd = body.indexOf('\n', afterHeading);
  if (lineEnd < 0) return '';
  const rest = body.slice(lineEnd + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading < 0 ? rest : rest.slice(0, nextHeading);
}

describe('4-way parallel fan-out (slice 004)', () => {
  describe('peaks-rd/SKILL.md fan-out section', () => {
    test('declares 4 sub-agents in the fan-out section', () => {
      const section = extractSection(rdSkillWithRefs, '## Parallel review fan-out');

      // All 4 sub-agents should be mentioned by name
      expect(section).toMatch(/code-reviewer/);
      expect(section).toMatch(/security-reviewer/);
      expect(section).toMatch(/perf-baseline-reviewer/);
      expect(section).toMatch(/qa-test-cases-writer/);
    });

    test('qa-test-cases-writer sub-agent writes to qa/test-cases/<rid>.md', () => {
      // The 4th sub-agent section must mention the output path. We
      // match the bold-tagged "Sub-agent 4" line, then walk forward
      // to the next `**` bold tag (the next sub-agent block) or the
      // end of the section, whichever comes first. Avoid the
      // `(?=...|\Z)` trap that turns `\Z` into a literal `Z` in JS.
      const match = rdSkillWithRefs.match(
        /\*\*Sub-agent 4 — qa-test-cases-writer\*\*[\s\S]*?(?=\*\*Sub-agent|\n## |\n### )/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain('qa/test-cases/<rid>.md');
    });

    test('qa-test-cases-writer contract: do NOT execute tests, do NOT write to tests/ dir', () => {
      // The 4th sub-agent section must include the "do not execute" + "do not write to tests/" prohibitions
      const match = rdSkillWithRefs.match(
        /\*\*Sub-agent 4 — qa-test-cases-writer\*\*[\s\S]*?(?=\*\*Sub-agent|\n## |\n### )/,
      );
      expect(match).not.toBeNull();
      // The contract says the sub-agent drafts the test plan, doesn't execute it
      expect(match![0]).toMatch(/do NOT need to be executed by this sub-agent/);
    });

    test('Gate C table includes qa/test-cases/<rid>.md for feature/refactor', () => {
      // The Gate C CLI enforcement table is in the "RD evidence" section
      // Each row is a single long line; check that "feature / refactor" is followed
      // by "qa/test-cases" on the same line.
      const featureRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| feature / refactor'));
      expect(featureRow, 'feature/refactor row should exist in Gate C table').toBeDefined();
      expect(featureRow).toContain('qa/test-cases/<rid>.md');
    });

    test('Gate C table includes qa/test-cases/<rid>.md for bugfix', () => {
      const bugfixRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| bugfix'));
      expect(bugfixRow, 'bugfix row should exist in Gate C table').toBeDefined();
      expect(bugfixRow).toContain('qa/test-cases/<rid>.md');
    });

    test('config/docs/chore rows do NOT include qa/test-cases (no acceptance surface)', () => {
      // The config row only has security-review
      const configRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| config'));
      expect(configRow, 'config row should exist in Gate C table').toBeDefined();
      expect(configRow).not.toContain('qa/test-cases');

      // docs/chore row is empty
      const docsRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| docs / chore'));
      expect(docsRow, 'docs/chore row should exist in Gate C table').toBeDefined();
      expect(docsRow).not.toContain('qa/test-cases');
    });

    test('Aggregation step now runs 4 ls checks (B3, B4, B9, plus qa-test-cases)', () => {
      // The Aggregation block is an H2 heading in the references/
      // file. Match the heading line, then walk forward to the next
      // H2 / H3 heading or end-of-input.
      const aggregationMatch = rdSkillWithRefs.match(
        /## Aggregation[\s\S]*?(?=\n## |\Z)/,
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
      // The Degradation block is an H2 heading in the references/
      // file. Match the heading line, then walk forward to the next
      // H2 / H3 heading or end-of-input.
      const degradationMatch = rdSkillWithRefs.match(
        /## Degradation[\s\S]*?(?=\n## |\Z)/,
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
      // The hard-prohibitions block is an H2 heading in the references/
      // file. Match the heading line, then walk forward to the next
      // H2 heading or end-of-input.
      const prohibitionsMatch = rdSkillWithRefs.match(
        /## Hard prohibitions on all 4 sub-agents[\s\S]*?(?=\n## |\Z)/,
      );
      expect(prohibitionsMatch).not.toBeNull();
      // Key prohibitions
      expect(prohibitionsMatch![0]).toContain('Skill(skill="...")');
      expect(prohibitionsMatch![0]).toContain('peaks skill presence:set');
    });
  });
});
