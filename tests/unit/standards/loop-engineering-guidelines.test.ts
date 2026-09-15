// tests/unit/standards/loop-engineering-guidelines.test.ts
//
// Coverage for the guideline linter, and for the two claims the guideline file
// makes about itself.
//
// PROVENANCE. `.peaks/standards/loop-engineering-guidelines.md` cited this path
// as the harness that "exercises" the lint. The file was deleted in `f17aa377`
// (2026-07-30) and the citation was never updated, so for weeks the lint had no
// test at all — and, invisible for the same reason, no caller either:
// `lintLoopEngineeringGuidelines` had zero references in the repo because
// `peaks standards lint --category loop-engineering` was never registered.
// Restored by slice 2026-09-15-s4-dangling-citations, which registers the
// subcommand and extends `EXPECTED_RED_LINE_IDS` with `RL-10`.
//
// The last case is the point of the slice: the file used to declare
// "Total red lines: 9 (RL-0..RL-9)" directly above an `## RL-10` heading, and
// nothing compared the declaration to the checklist it claimed to be.
//
// Dimensions covered:
//   - behavior:    the pure lint over synthetic guideline text
//   - render:      the CLI-shaped envelope returned by runLoopEngineeringLint
//   - integration: the real guideline file read off the working tree
//   - a11y:        OMITTED — no human-facing surface of its own; the printer is
//                  covered by the CLI envelope tests

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { EXPECTED_RED_LINE_IDS, REQUIRED_SECTIONS, lintLoopEngineeringGuidelines } from '../../../src/services/standards/loop-engineering-lint.js';
import { runLoopEngineeringLint } from '../../../src/cli/commands/core/standards-command.js';

declareDimensions(
  'tests/unit/standards/loop-engineering-guidelines.test.ts',
  ['behavior', 'render', 'integration'],
  [{ dim: 'a11y', reason: 'no human-facing surface of its own; the CLI printer is covered elsewhere' }],
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const GUIDELINES_PATH = join(REPO_ROOT, '.peaks', 'standards', 'loop-engineering-guidelines.md');

/** A well-formed document carrying every expected red line, mutable per case. */
function syntheticDoc(mutate?: (lines: string[]) => void): string {
  const lines = EXPECTED_RED_LINE_IDS.flatMap((id) => [
    `## ${id} — synthetic ${id}`,
    '',
    '## Failure modes',
    '- drift this rule prevents',
    '',
    '## Rewrite',
    '```text',
    'imperative → declarative',
    '```',
    '',
    '## Self-check',
    '- did the change respect the rule?',
    '',
    '## Out-of-scope',
    '- does not apply elsewhere',
    '',
  ]);
  mutate?.(lines);
  return lines.join('\n');
}

describe('Scenario: behavior — the lint reads the 4-section form', () => {
  it('when every red line carries all 4 sections, should report no findings', () => {
    // given: a document with one complete red line per expected id
    // when: it is linted
    const result = lintLoopEngineeringGuidelines(syntheticDoc());

    // then: the lint is green and sees the whole expected set
    expect(result.ok).toBe(true);
    expect(result.redLines.map((rl) => rl.id)).toEqual([...EXPECTED_RED_LINE_IDS]);
  });

  it('when a red line loses a required section, should name that red line and section', () => {
    // given: the same document with the `## Out-of-scope` heading dropped from RL-3
    const raw = syntheticDoc((lines) => {
      const at = lines.indexOf('## Out-of-scope', lines.indexOf('## RL-3 — synthetic RL-3'));
      lines.splice(at, 1);
    });

    // when: it is linted
    const result = lintLoopEngineeringGuidelines(raw);

    // then: the finding points at the red line and the missing section
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.findings).toEqual(['RL-3 is missing section "Out-of-scope"']);
  });

  it('when an expected red line is absent, should report it as missing', () => {
    // given: the document with the `RL-10` heading removed
    const raw = syntheticDoc((lines) => {
      lines.splice(lines.indexOf('## RL-10 — synthetic RL-10'), 1);
    });

    // when: it is linted
    const result = lintLoopEngineeringGuidelines(raw);

    // then: RL-10 is reported missing — the case the old closed set could not see
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.findings).toEqual(['missing red line: RL-10']);
  });

  it('when the document is empty, should refuse rather than pass vacuously', () => {
    // given: an empty file
    // when: it is linted
    const result = lintLoopEngineeringGuidelines('\n\n');

    // then: the lint fails loudly
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.findings).toContain('guideline file is empty');
  });
});

describe('Scenario: render — the CLI envelope the registered subcommand prints', () => {
  it('when the real project root is linted, should return an ok envelope naming every red line', () => {
    // given: this repository as the project root
    // when: the lint subcommand's pure helper runs
    const envelope = runLoopEngineeringLint(REPO_ROOT);

    // then: the envelope is green and enumerates the expected ids
    expect(envelope.ok).toBe(true);
    expect(envelope.code).toBe('STANDARDS_LINT_OK');
    expect(envelope.data.redLineCount).toBe(EXPECTED_RED_LINE_IDS.length);
    expect(envelope.data.redLineIds).toEqual([...EXPECTED_RED_LINE_IDS]);
    expect(envelope.data.findings).toEqual([]);
  });

  it('when the guideline file is absent from the project root, should fail with LINT_FILE_NOT_FOUND', () => {
    // given: a root with no `.peaks/standards/` at all
    const emptyRoot = join(REPO_ROOT, 'tests', 'unit', '_samples', 'no-such-corpus-root');

    // when: the helper runs
    const envelope = runLoopEngineeringLint(emptyRoot);

    // then: it reports the missing file instead of returning a vacuous pass
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LINT_FILE_NOT_FOUND');
  });
});

describe('Scenario: integration — the shipped guideline file keeps its own promises', () => {
  it('when the real file is linted, should satisfy every red line it declares', () => {
    // given: the shipped guideline file
    // when: it is linted
    const result = lintLoopEngineeringGuidelines(readFileSync(GUIDELINES_PATH, 'utf8'));

    // then: it is green and every expected red line is present (this is the
    // assertion that would have caught the un-enforced RL-10)
    expect(result.ok).toBe(true);
    expect(result.redLines.map((rl) => rl.id)).toEqual([...EXPECTED_RED_LINE_IDS]);
  });

  it('when the file states a red-line total, should state the number the lint enforces', () => {
    // given: the shipped guideline file's own summary line
    const raw = readFileSync(GUIDELINES_PATH, 'utf8');
    const declared = /Total red lines:\s*(\d+)\s*\((RL-\d+\.\.RL-\d+)\)/.exec(raw);

    // when: it is compared to the checklist the lint enforces
    // then: the declaration, the last red line heading and the checklist agree
    expect(declared, 'the file must declare a `Total red lines: N (RL-a..RL-b)` line').not.toBeNull();
    expect(Number(declared?.[1])).toBe(EXPECTED_RED_LINE_IDS.length);
    expect(declared?.[2]).toBe(`RL-0..${EXPECTED_RED_LINE_IDS[EXPECTED_RED_LINE_IDS.length - 1]}`);
    expect(REQUIRED_SECTIONS).toHaveLength(4);
  });
});
