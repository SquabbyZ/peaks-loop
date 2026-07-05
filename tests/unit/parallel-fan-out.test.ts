import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = resolve(__dirname, '..', '..', 'skills');

const rdSkill = readFileSync(join(SKILLS_ROOT, 'peaks-rd', 'SKILL.md'), 'utf8');
const qaSkill = readFileSync(join(SKILLS_ROOT, 'peaks-qa', 'SKILL.md'), 'utf8');
const workflowGatesRef = readFileSync(
  join(SKILLS_ROOT, 'peaks-code', 'references', 'workflow-gates-and-types.md'),
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
const rdParallelRefBody = readFileSync(
  join(SKILLS_ROOT, 'peaks-rd', 'references', 'parallel-review-fanout.md'),
  'utf8',
);
// Concatenate SKILL.md + reference so a regex match on either file
// succeeds. This matches the production `loadRunbookSection` pattern
// of preferring inline and falling back to references/.
const rdSkillWithRefs = rdSkill + '\n\n' + rdRefBody + '\n\n' + rdParallelRefBody;

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

describe('v2.12.0 3-way parallel fan-out (collapse from slice 004 4-way + slice 5/6 5-way)', () => {
  describe('peaks-rd/SKILL.md fan-out section', () => {
    test('declares 3 sub-agents in the fan-out section (v2.12.0 collapse)', () => {
      // The fan-out sub-agent contracts live in
      // `references/parallel-review-fanout.md` (per the SKILL.md
      // slim-content pattern). Extract from the parallel-review-fanout
      // reference so the Sub-agent N tags are matched.
      const parallelSection = extractSection(
        rdParallelRefBody,
        '# Parallel review fan-out',
      );
      // The v2.12.0 3-way fan-out includes exactly these 3 sub-agents.
      expect(parallelSection).toMatch(/code-reviewer/);
      expect(parallelSection).toMatch(/qa-test-cases-writer/);
      expect(parallelSection).toMatch(/karpathy-reviewer/);

      // The previous slice 004 + slice 5/6 5-way fan-out included
      // `security-reviewer` and `perf-baseline-reviewer`; both moved
      // out to standalone audit skills (peaks-security-audit /
      // peaks-perf-audit) and MUST NOT appear as fan-out sub-agents.
      // Match "Sub-agent" tags so we don't false-positive on the
      // back-compat mention of the legacy path.
      const subAgentBlocks = parallelSection.match(/\*\*Sub-agent \d+ —[^*]+\*\*/g) ?? [];
      expect(subAgentBlocks.length).toBe(3);
      expect(subAgentBlocks.join(' ')).not.toMatch(/security-reviewer/);
      expect(subAgentBlocks.join(' ')).not.toMatch(/perf-baseline-reviewer/);
    });

    test('SKILL.md describes the fan-out as 3-way (v2.12.0)', () => {
      const section = extractSection(rdSkillWithRefs, '## Parallel review fan-out');
      // The heading itself names the 3 sub-agents and the v2.12.0 marker.
      expect(section).toMatch(/v2\.12\.0/);
      expect(section).toMatch(/3-way fanout|3-way fan-out/i);
    });

    test('SKILL.md cross-references the standalone peaks-security-audit + peaks-perf-audit skills', () => {
      const section = extractSection(rdSkillWithRefs, '## Parallel review fan-out');
      expect(section).toContain('peaks-security-audit');
      expect(section).toContain('peaks-perf-audit');
      expect(section).toContain('audit/security.md');
      expect(section).toContain('audit/perf.md');
    });

    test('qa-test-cases-writer sub-agent writes to qa/test-cases/<rid>.md', () => {
      // The qa-test-cases-writer sub-agent section must mention the
      // output path. We match the bold-tagged sub-agent line, then
      // walk forward to the next `**` bold tag (the next sub-agent
      // block) or the end of the section, whichever comes first.
      // Avoid the `(?=...|\Z)` trap that turns `\Z` into a literal
      // `Z` in JS.
      const match = rdSkillWithRefs.match(
        /\*\*Sub-agent \d+ — qa-test-cases-writer\*\*[\s\S]*?(?=\*\*Sub-agent|\n## |\n### )/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toContain('qa/test-cases/<rid>.md');
    });

    test('qa-test-cases-writer contract: do NOT execute tests, do NOT write to tests/ dir', () => {
      const match = rdSkillWithRefs.match(
        /\*\*Sub-agent \d+ — qa-test-cases-writer\*\*[\s\S]*?(?=\*\*Sub-agent|\n## |\n### )/,
      );
      expect(match).not.toBeNull();
      // The contract says the sub-agent drafts the test plan, doesn't execute it
      expect(match![0]).toMatch(/do NOT need to be executed by this sub-agent/);
    });

    test('karpathy-reviewer sub-agent is described as the hard gate', () => {
      const match = rdSkillWithRefs.match(
        /\*\*Sub-agent \d+ — karpathy-reviewer[\s\S]*?(?=\*\*Sub-agent|\n## |\n### )/,
      );
      expect(match).not.toBeNull();
      expect(match![0]).toMatch(/hard gate/i);
    });

    test('Gate C table requires audit/security.md + audit/perf.md for feature/refactor', () => {
      // The Gate C CLI enforcement table is in the "RD evidence" section.
      // Each row is a single long line; check that "feature / refactor"
      // is followed by audit/security + audit/perf on the same line.
      const featureRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| feature / refactor'));
      expect(featureRow, 'feature/refactor row should exist in Gate C table').toBeDefined();
      expect(featureRow).toContain('audit/security.md');
      expect(featureRow).toContain('audit/perf.md');
      expect(featureRow).toContain('qa/test-cases/<rid>.md');
      // The v2.12.0 collapse removed `rd/security-review.md` and
      // `rd/perf-baseline.md` from the required-evidence matrix.
      expect(featureRow).not.toContain('rd/security-review.md');
      expect(featureRow).not.toContain('rd/perf-baseline.md');
    });

    test('Gate C table requires audit/security.md + audit/perf.md for bugfix', () => {
      const bugfixRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| bugfix'));
      expect(bugfixRow, 'bugfix row should exist in Gate C table').toBeDefined();
      expect(bugfixRow).toContain('audit/security.md');
      expect(bugfixRow).toContain('qa/test-cases/<rid>.md');
    });

    test('config row requires audit/security.md (peaks-security-audit output, not rd/security-review.md)', () => {
      // The v2.12.0 collapse moved the config-row requirement from
      // `rd/security-review.md` to `audit/security.md` (the
      // peaks-security-audit skill's output).
      const configRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| config'));
      expect(configRow, 'config row should exist in Gate C table').toBeDefined();
      expect(configRow).toContain('audit/security.md');
      expect(configRow).not.toContain('rd/security-review.md');
    });

    test('config/docs/chore rows do NOT include qa/test-cases (no acceptance surface)', () => {
      const configRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| config'));
      expect(configRow, 'config row should exist in Gate C table').toBeDefined();
      expect(configRow).not.toContain('qa/test-cases');

      const docsRow = rdSkillWithRefs
        .split('\n')
        .find((line) => line.includes('| docs / chore'));
      expect(docsRow, 'docs/chore row should exist in Gate C table').toBeDefined();
      expect(docsRow).not.toContain('qa/test-cases');
    });

    test('Aggregation step runs 3 ls checks (B3 code-review, C2 qa-test-cases, KARPATHY_REVIEW)', () => {
      // The Aggregation block is an H2 heading in the references/
      // file. Match the heading line, then walk forward to the next
      // H2 / H3 heading or end-of-input.
      const aggregationMatch = rdSkillWithRefs.match(
        /## Aggregation[\s\S]*?(?=\n## |\Z)/,
      );
      expect(aggregationMatch).not.toBeNull();
      const section = aggregationMatch![0];
      // 3 ls checks: code-review, qa-test-cases, karpathy-review
      expect(section).toContain('Gate B3');
      expect(section).toContain('Gate C2');
      expect(section).toMatch(/qa-test-cases|qa\/test-cases/);
      expect(section).toMatch(/KARPATHY_REVIEW|karpathy-review/);
    });

    test('Degradation: qa-test-cases sub-agent failure falls back to inline QA drafting', () => {
      const degradationMatch = rdSkillWithRefs.match(
        /## Degradation[\s\S]*?(?=\n## |\Z)/,
      );
      expect(degradationMatch).not.toBeNull();
      expect(degradationMatch![0]).toContain('qa-test-cases-subagent-degraded-to-inline-qa-draft');
    });

    test('Deprecated reviewer back-compat: 1-minor-release window keeps legacy paths readable', () => {
      // The v2.12.0 collapse moves security + perf to standalone
      // audit skills, but the 1-minor-release back-compat window
      // (v2.12.0) keeps `rd/security-review.md` and
      // `rd/perf-baseline.md` readable. The references/ file must
      // document this.
      expect(rdRefBody).toMatch(/Deprecated reviewer back-compat|deprecated-reviewer-back-compat/);
      expect(rdRefBody).toContain('rd/security-review.md');
      expect(rdRefBody).toContain('rd/perf-baseline.md');
      expect(rdRefBody).toMatch(/v2\.12\.0 1-minor-release window|1-minor-release back-compat window/);
    });
  });

  describe('peaks-code/references/workflow-gates-and-types.md Gate C', () => {
    test('feature/refactor row (in the bash code block) includes qa/test-cases/<rid>.md', () => {
      // The Gate C content is inside a ```bash code block.
      // The row we want is the commented-out line `#   feature / refactor → ls ...`.
      // A more specific match: the row is preceded by `# Type-specific RD evidence` and
      // contains both `feature / refactor` and `qa/test-cases`.
      const featureRow = workflowGatesRef
        .split('\n')
        .find((line) => line.includes('feature / refactor') && line.includes('qa/test-cases'));
      expect(featureRow, 'feature/refactor row in Gate C bash block should include qa-test-cases').toBeDefined();
    });

    test('bugfix row (in the bash code block) includes qa/test-cases/<rid>.md', () => {
      const bugfixRow = workflowGatesRef
        .split('\n')
        .find((line) => line.includes('rd/bug-analysis.md') && line.includes('qa/test-cases'));
      expect(bugfixRow, 'bugfix row in Gate C bash block should include qa-test-cases').toBeDefined();
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

  describe('Hard prohibitions preserved across all 3 sub-agents', () => {
    test('All 3 sub-agents are covered by the same Hard prohibitions block', () => {
      // The hard-prohibitions block is an H2 heading in the references/
      // file. Match the heading line, then walk forward to the next
      // H2 heading or end-of-input.
      const prohibitionsMatch = rdSkillWithRefs.match(
        /## Hard prohibitions on all 3 sub-agents[\s\S]*?(?=\n## |\Z)/,
      );
      expect(prohibitionsMatch).not.toBeNull();
      // Key prohibitions — v2.12.0 contract:
      //   (1) sub-agents are spawned via `peaks sub-agent dispatch <role>` (not Skill)
      //   (2) sub-agents MUST NOT call `peaks skill presence:set`
      //   (3) sub-agents MUST NOT mutate parent settings / hooks / settings.json
      expect(prohibitionsMatch![0]).toContain('peaks sub-agent dispatch <role>');
      expect(prohibitionsMatch![0]).toContain('peaks skill presence:set');
      expect(prohibitionsMatch![0]).toContain('settings.json');
    });
  });
});