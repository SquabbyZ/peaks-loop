// tests/unit/standards/loop-engineering-readiness-lint.test.ts
//
// Coverage for the hygiene-block exemption in the Loop Engineering readiness
// linter (`src/services/standards/loop-engineering-readiness-lint.ts`).
//
// THE DEFECT THIS LOCKS. `<!-- peaks:loop-hygiene … -->` … `<!-- /peaks:loop-hygiene -->`
// is a hand-maintained block, byte-identical in all 25 shipped `skills/**/SKILL.md`
// and separately guarded by `tests/unit/skills/loop-hygiene-block.test.ts`. One of
// its hard-wrapped continuation lines begins "run `peaks code auto-compact …`
// **yourself**" — a sentence addressed to the ASSISTANT, which a few words later
// forbids handing the step to the user. `checkCliVerbBypass` matches
// `(?:Run|Use|Type|Execute)\s+` case-insensitively and therefore reported the same
// `cli-verb-bypass` finding on every shipped skill. The block is not
// skill-authoring content, so the readiness checks run against the skill's own
// text with that one delimited region blanked first.
//
// What each case pins, in the order the brief named it:
//   1. the strip is bounded — a genuine bypass before or after the region is
//      still found, and keeps its ORIGINAL line number;
//   2. a malformed region fails CLOSED — an opening marker without a closing
//      marker strips nothing, so deleting one line cannot disable the lint;
//   3. content inside the region is genuinely skipped;
//   4. all three checks see the stripped text — including
//      `checkGuidelineReference`, where stripping is the STRICTER outcome;
//   5. text with no markers is untouched.
//
// Dimensions covered:
//   - behavior:    pure lint + strip helper over synthetic documents
//   - integration: the real 25 `skills/**/SKILL.md` files read off the tree
//   - a11y:        the human-readable finding strings and their line numbers
//   - render:      OMITTED — the lint has no rendered surface of its own; the CLI
//                  envelope is covered by
//                  `tests/integration/skill-loop-engineering-readiness-cli.test.ts`

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  HYGIENE_BLOCK_CLOSE_MARKER,
  HYGIENE_BLOCK_OPEN_MARKER,
  lintSkillLoopEngineeringReadiness,
  stripHygieneBlock
} from '../../../src/services/standards/loop-engineering-readiness-lint.js';

declareDimensions(
  'tests/unit/standards/loop-engineering-readiness-lint.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'no rendered surface of its own; the CLI envelope is covered by the integration test'
    }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const GUIDELINE_REF = '.peaks/standards/loop-engineering-guidelines.md';
const OPEN_MARKER = '<!-- peaks:loop-hygiene — HAND-MAINTAINED block, NOT generated -->';
const CLOSE_MARKER = '<!-- /peaks:loop-hygiene -->';

/** A line that `checkCliVerbBypass` flags: a verb outside the allowlist. */
const BYPASS_LINE = 'Run `peaks custom-evolve my-bee` to evolve your bee directly.';
/** A line that `checkJsonHandAuthoring` flags. */
const JSON_LINE = 'Edit the manifest directly with your chosen values.';
/** The real sentence inside the shipped hygiene block — addressed to the LLM. */
const HYGIENE_BYPASS_LINE =
  'run `peaks code auto-compact --project .` **yourself**, then continue. Tell the user the';

function joinLines(lines: readonly string[]): string {
  return lines.join('\n');
}

/** A document whose only issue is whatever the caller appends. */
function baseDoc(...extra: string[]): string {
  return joinLines(['# Peaks-Synthetic', '', `Reference: ${GUIDELINE_REF}`, '', ...extra, '']);
}

/** The findings as a compact `rule` list, plus the raw strings for exact pins. */
function findingsOf(text: string): string[] {
  const result = lintSkillLoopEngineeringReadiness(text);
  return result.ok ? [] : result.findings;
}

function rulesOf(text: string): string[] {
  return findingsOf(text).map((f) => f.split(':')[0] ?? '');
}

describe('Scenario: behavior — the hygiene region is excluded from the checks', () => {
  it('when a bypass-style line sits inside the hygiene region, should report no finding', () => {
    // given: a skill whose only bypass sentence is inside the delimited block
    // when: it is linted
    // then: the block is not skill-authoring content and produces nothing
    const text = baseDoc(
      OPEN_MARKER,
      '',
      '## Loop hygiene (every turn — MANDATORY)',
      '',
      "**Context is this skill's own business.** Run `peaks skill presence --json` every turn and",
      HYGIENE_BYPASS_LINE,
      'ratio in one line if it helps.',
      '',
      CLOSE_MARKER,
      ''
    );

    const result = lintSkillLoopEngineeringReadiness(text);

    expect(result.ok).toBe(true);
    expect(findingsOf(text)).toEqual([]);
  });

  it('when a JSON hand-authoring phrase sits inside the region, should report no finding', () => {
    // given: a skill whose only hand-authoring phrase is inside the block
    // when: it is linted
    // then: the second check also sees the stripped text
    const text = baseDoc(OPEN_MARKER, JSON_LINE, CLOSE_MARKER, '');

    const result = lintSkillLoopEngineeringReadiness(text);

    expect(result.ok).toBe(true);
  });

  it('when a bypass line precedes the opening marker, should still flag it', () => {
    // given: an out-of-scope bypass above an otherwise clean hygiene region
    // when: it is linted
    // then: the strip starts at the opening marker and swallowed nothing before it
    const text = baseDoc(BYPASS_LINE, '', OPEN_MARKER, HYGIENE_BYPASS_LINE, CLOSE_MARKER, '');

    const rules = rulesOf(text);

    expect(rules).toEqual(['cli-verb-bypass']);
  });

  it('when a bypass line follows the closing marker, should still flag it at its original line', () => {
    // given: an out-of-scope bypass below the region, five lines down
    // when: it is linted
    // then: it is found, and the blanked region kept the numbering honest
    const lines = [
      '# Peaks-Synthetic',
      '',
      `Reference: ${GUIDELINE_REF}`,
      '',
      OPEN_MARKER,
      HYGIENE_BYPASS_LINE,
      CLOSE_MARKER,
      '',
      BYPASS_LINE,
      ''
    ];

    const findings = findingsOf(joinLines(lines));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('cli-verb-bypass: line 9 ');
    expect(findings[0]).toContain('`peaks custom-evolve`');
  });

  it('when the opening marker has no closing marker, should strip nothing and still flag', () => {
    // given: a truncated region — the shape a deleted closing line leaves behind
    // when: it is linted
    // then: it fails closed — a lint that one deleted line can switch off is worse
    //       than the false positive this exemption exists to fix
    const text = baseDoc(OPEN_MARKER, HYGIENE_BYPASS_LINE, '');

    const result = lintSkillLoopEngineeringReadiness(text);

    expect(result.ok).toBe(false);
    expect(rulesOf(text)).toEqual(['cli-verb-bypass']);
  });

  it('when only a closing marker is present, should strip nothing', () => {
    // given: an orphan closing marker with a bypass beneath it
    // when: it is linted
    // then: markers need a pair; a lone one exempts nothing
    const text = baseDoc(CLOSE_MARKER, HYGIENE_BYPASS_LINE, '');

    const result = lintSkillLoopEngineeringReadiness(text);

    expect(result.ok).toBe(false);
    expect(rulesOf(text)).toEqual(['cli-verb-bypass']);
  });

  it('when the guideline reference sits only inside the region, should still report it missing', () => {
    // given: the reference is inside the block and nowhere else
    // when: it is linted
    // then: stripping makes the guideline check STRICTER, not looser — the shared
    //       block cannot satisfy a per-skill requirement
    const text = joinLines([
      '# Peaks-Synthetic',
      '',
      OPEN_MARKER,
      `Reference: ${GUIDELINE_REF}`,
      HYGIENE_BYPASS_LINE,
      CLOSE_MARKER,
      ''
    ]);

    const rules = rulesOf(text);

    expect(rules).toEqual(['missing-guideline-reference']);
  });

  it('when a document has no markers at all, should return it unchanged and lint it identically', () => {
    // given: a marker-free skill with one bypass line
    // when: the strip helper runs and the lint runs
    // then: nothing was removed, so the finding is the exact pre-fix string
    const text = baseDoc(BYPASS_LINE);

    const stripped = stripHygieneBlock(text);
    const findings = findingsOf(text);

    expect(stripped).toBe(text);
    expect(findings).toEqual([
      `cli-verb-bypass: line 5 introduces CLI verb \`peaks custom-evolve\` to be typed by the user (${BYPASS_LINE}) — only LLM-coordinated verbs from the sediment/asset/evolution surface are allowed (RL-1)`
    ]);
  });

  it('when the region is stripped, should keep the surrounding text byte-identical', () => {
    // given: prose on both sides of a one-line region
    // when: the region is stripped
    // then: only the region's non-newline characters are gone
    const text = baseDoc(OPEN_MARKER, 'inside', CLOSE_MARKER, 'after the block');

    const stripped = stripHygieneBlock(text);

    expect(stripped).not.toContain('inside');
    expect(stripped).toContain('after the block');
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length);
  });
});

describe('Scenario: integration — the 25 shipped skills carry the block', () => {
  /** Every shipped SKILL.md: `skills/<id>/` plus the nested `skills/bee/<id>/`. */
  function shippedSkillPaths(): string[] {
    const out: string[] = [];
    const root = join(REPO_ROOT, 'skills');
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const candidates = [join(dir, 'SKILL.md')];
      for (const inner of readdirSync(dir, { withFileTypes: true })) {
        if (inner.isDirectory()) candidates.push(join(dir, inner.name, 'SKILL.md'));
      }
      out.push(...candidates.filter((p) => existsSync(p)));
    }
    return out.sort();
  }

  it('when every shipped SKILL.md is linted, should raise no finding from the hygiene sentence', () => {
    // given: the real shipped skill population
    // when: each is linted
    // then: the block's assistant-addressed sentence is reported nowhere, while
    //       genuinely out-of-scope bypasses elsewhere stay visible. Every file
    //       here must carry the delimiters, or the exemption is not what is
    //       being measured.
    const paths = shippedSkillPaths();

    const texts = paths.map((p) => ({ p, text: readFileSync(p, 'utf-8') }));
    const offenders = texts
      .map(({ p, text }) => ({ p, findings: findingsOf(text) }))
      .filter(({ findings }) => findings.some((f) => f.includes('`peaks code`')));

    expect(paths.length).toBeGreaterThan(0);
    expect(texts.filter(({ text }) => !text.includes(HYGIENE_BLOCK_OPEN_MARKER))).toEqual([]);
    expect(texts.filter(({ text }) => !text.includes(HYGIENE_BLOCK_CLOSE_MARKER))).toEqual([]);
    expect(offenders).toEqual([]);
  });

  it('when peaks-maker SKILL.md is linted, should pass outright', () => {
    // given: the one shipped skill that carries both the block and a guideline reference
    // when: it is linted
    // then: the integration suite's peaks-maker assertion has a green pure-function base
    const text = readFileSync(join(REPO_ROOT, 'skills', 'peaks-maker', 'SKILL.md'), 'utf-8');

    const result = lintSkillLoopEngineeringReadiness(text);

    expect(result.ok).toBe(true);
  });
});

describe('Scenario: a11y — findings stay human-readable after the strip', () => {
  it('when a finding is produced outside the region, should name the rule, line and excerpt', () => {
    // given: a marker-free bypass line
    // when: it is linted
    // then: the shape a user reads is unchanged
    const findings = findingsOf(baseDoc(BYPASS_LINE));

    expect(findings[0]).toMatch(
      /^cli-verb-bypass: line \d+ introduces CLI verb `peaks custom-evolve`/
    );
    expect(findings[0]).toContain(BYPASS_LINE);
  });

  it('when a document is only whitespace, should keep the empty-document message', () => {
    // given: an empty skill body
    // when: it is linted
    // then: the emptiness guard runs before any strip
    const result = lintSkillLoopEngineeringReadiness('  \n\n ');

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.findings).toEqual([
      'skill-md-empty: SKILL.md text is empty or missing'
    ]);
  });
});
