import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type {
  AuditSource,
  DimensionJudgement
} from '../../../src/services/design/audit/audit-finding.js';
import { auditColor, auditColorDimension } from '../../../src/services/design/audit/audit-color.js';
import { runAuditProject } from '../../../src/services/design/audit/audit-project.js';
import {
  auditSpacing,
  auditSpacingDimension
} from '../../../src/services/design/audit/audit-spacing.js';
import { auditType, auditTypeDimension } from '../../../src/services/design/audit/audit-type.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-counts.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const TREE = join(FIXTURES, 'three-page-tree');

const scale: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

type Tokens = { color?: Record<string, { $value: string }> };

const tokens = JSON.parse(readFileSync(join(FIXTURES, 'tokens-color.json'), 'utf8')) as Tokens;

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

/** A judgement is a denominator and a numerator that never exceeds it. */
function expectJudgement(judgement: DimensionJudgement): void {
  expect(Number.isInteger(judgement.measured)).toBe(true);
  expect(Number.isInteger(judgement.onContract)).toBe(true);
  expect(judgement.measured).toBeGreaterThanOrEqual(0);
  expect(judgement.onContract).toBeGreaterThanOrEqual(0);
  expect(judgement.onContract).toBeLessThanOrEqual(judgement.measured);
}

describe('Scenario: render — the judgement is the documented pair', () => {
  it('when a detector judges values, should expose measured and on-contract counts', () => {
    // given: a page with four on-ladder and three off-ladder spacing values
    // when: the dimension audit runs
    // then: the judgement carries both counts and the findings keep their shape
    const result = auditSpacingDimension({
      tokenScale: scale,
      sources: [source('off-ladder-page.tsx')]
    });
    expect(Object.keys(result).sort()).toEqual(['findings', 'judgement']);
    expect(Object.keys(result.judgement).sort()).toEqual(['measured', 'onContract']);
    expectJudgement(result.judgement);
    expect(result.judgement.measured).toBeGreaterThan(0);
  });
});

describe('Scenario: behavior — exposing counts never changes a finding', () => {
  it('when a dimension is audited both ways, should return the identical finding list', () => {
    // given: one fixture per value dimension
    // when: the legacy array function and the counting wrapper run on the same input
    // then: the findings are deep-equal, so only the counts are new
    const spacingInput = { tokenScale: scale, sources: [source('off-ladder-page.tsx')] };
    const typeInput = { tokenScale: scale, sources: [source('type-crowded-page.tsx')] };
    const colorInput = {
      tokenScale: scale,
      sources: [source('color-seven-family-page.tsx')],
      tokens
    };
    expect(auditSpacingDimension(spacingInput).findings).toEqual(auditSpacing(spacingInput));
    expect(auditTypeDimension(typeInput).findings).toEqual(auditType(typeInput));
    expect(auditColorDimension(colorInput).findings).toEqual(auditColor(colorInput));
    expectJudgement(auditSpacingDimension(spacingInput).judgement);
    expectJudgement(auditTypeDimension(typeInput).judgement);
    expectJudgement(auditColorDimension(colorInput).judgement);
  });
});

describe('Scenario: behavior — a ratio never moves without a finding', () => {
  it('when spacing is off-ladder, should emit one finding per off value', () => {
    // given: four off-ladder spacing literals
    // when: the counting wrapper judges them
    // then: measured minus on-contract equals the non-unmeasured finding count
    const result = auditSpacingDimension({
      tokenScale: scale,
      sources: [source('off-ladder-page.tsx')]
    });
    const off = result.judgement.measured - result.judgement.onContract;
    const judged = result.findings.filter((finding) => finding.severity !== 'unmeasured');
    expect(off).toBeGreaterThan(0);
    expect(judged).toHaveLength(off);
  });

  it('when a colour literal is off-token, should emit one hard finding per literal', () => {
    // given: one raw `#ff00aa` and one literal that maps to a declared token
    // when: the counting wrapper judges them
    // then: measured minus on-contract equals the hard finding count
    const result = auditColorDimension({
      tokenScale: scale,
      sources: [source('color-raw-hex-page.tsx')],
      tokens
    });
    const off = result.judgement.measured - result.judgement.onContract;
    expect(off).toBe(1);
    expect(result.findings.filter((finding) => finding.severity === 'hard')).toHaveLength(off);
  });

  it('when type is off-ladder, should emit one finding per distinct off value', () => {
    // given: `text-[11px]` twice and `text-[13px]` once
    // when: the counting wrapper judges them
    // then: each distinct value has its own finding at the line that declares it
    const fixture = readFileSync(join(FIXTURES, 'type-off-ladder-page.tsx'), 'utf8').split('\n');
    const lineOf = (needle: string): number =>
      fixture.findIndex((line) => line.includes(needle)) + 1;
    const result = auditTypeDimension({
      tokenScale: scale,
      sources: [source('type-off-ladder-page.tsx')]
    });
    const offLadder = result.findings.filter((finding) =>
      finding.techText.includes(' off-ladder x')
    );
    expect(offLadder.map((finding) => finding.value)).toEqual(['11px', '13px']);
    // The expected line is derived from the fixture's own text, so a runner that
    // prepends a directive (Stryker's `@ts-nocheck`) cannot shift the assertion
    // away from the product behaviour it pins.
    expect(offLadder.map((finding) => finding.techText)).toEqual([
      `type-off-ladder-page.tsx:${lineOf('text-[11px]')} font-size:11px off-ladder x2 (tokenScale.font: 12/14/16/20/24/32)`,
      `type-off-ladder-page.tsx:${lineOf('text-[13px]')} font-size:13px off-ladder x1 (tokenScale.font: 12/14/16/20/24/32)`
    ]);
  });
});

describe('Scenario: integration — the fixture finding set is pinned', () => {
  it('when the three-page tree is audited, should return exactly the recorded findings', () => {
    // given: the clean / spacing / hard-colour fixture
    // when: the project reader audits it
    // then: every finding is the one recorded before the score shape changed
    const result = runAuditProject({ appRoot: TREE });
    if (result.kind !== 'audited') throw new Error(`unexpected result ${result.kind}`);
    const recorded = result.pages.flatMap((page) =>
      page.findings.map((finding) => [
        page.path,
        finding.dimension,
        finding.severity,
        finding.line,
        finding.value,
        finding.expected,
        finding.techText
      ])
    );
    // A content-derived line is still pinned, but it survives a runner that
    // prepends a directive to the sandbox copy (Stryker `@ts-nocheck`): the
    // assertion is "the finding sits on the line that declares the value".
    const spacingLines = readFileSync(join(TREE, 'pages', 'spacing.tsx'), 'utf8').split('\n');
    const lineOf = (needle: string): number =>
      spacingLines.findIndex((line) => line.includes(needle)) + 1;
    const gap = lineOf('gap-[9px]');
    const pad13 = lineOf('p-[13px]');
    const pad15 = lineOf('p-[15px]');
    const calc = lineOf('calc(4px * 2)');
    expect(recorded).toEqual([
      [
        'pages/clean.tsx',
        'hierarchy',
        'soft',
        1,
        'none',
        'h1',
        'pages/clean.tsx:1 heading:h1 missing'
      ],
      [
        'pages/spacing.tsx',
        'spacing',
        'soft',
        gap,
        'gap-[9px]',
        '8',
        `pages/spacing.tsx:${gap} gap:gap-[9px] not in tokenScale.space`
      ],
      [
        'pages/spacing.tsx',
        'spacing',
        'soft',
        pad13,
        'p-[13px]',
        '12',
        `pages/spacing.tsx:${pad13} padding:p-[13px] not in tokenScale.space`
      ],
      [
        'pages/spacing.tsx',
        'spacing',
        'soft',
        pad15,
        'p-[15px]',
        '16',
        `pages/spacing.tsx:${pad15} padding:p-[15px] not in tokenScale.space`
      ],
      [
        'pages/spacing.tsx',
        'spacing',
        'unmeasured',
        calc,
        'calc(4px * 2)',
        '',
        `pages/spacing.tsx:${calc} padding:calc(4px * 2) unmeasured (calc())`
      ],
      [
        'pages/spacing.tsx',
        'hierarchy',
        'soft',
        1,
        'none',
        'h1',
        'pages/spacing.tsx:1 heading:h1 missing'
      ],
      [
        'pages/theme.css',
        'color',
        'hard',
        3,
        '#ff00aa',
        'declared token',
        'pages/theme.css:3 color:#ff00aa raw colour not a declared token'
      ]
    ]);
  });
});

describe('Scenario: a11y — the finding still speaks to a person', () => {
  it('when the colour finding is judged with counts, should keep its bilingual pair', () => {
    // given: the raw colour the contract does not declare
    // when: the counting wrapper produces the finding
    // then: the plain sentence and the greppable line are unchanged
    const findings = auditColorDimension({
      tokenScale: scale,
      sources: [source('three-page-tree/pages/theme.css')],
      tokens
    }).findings;
    expect(findings[0]?.humanText).toContain('应该改用 token');
    expect(findings[0]?.techText).toBe(
      'three-page-tree/pages/theme.css:3 color:#ff00aa raw colour not a declared token'
    );
  });
});
