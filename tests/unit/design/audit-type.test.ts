import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type {
  AuditFinding,
  AuditInput,
  AuditSource
} from '../../../src/services/design/audit/audit-finding.js';
import {
  auditType,
  measureType,
  typeSizeLevels
} from '../../../src/services/design/audit/audit-type.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';
import { readPavedRoad } from '../../../src/services/design/source-scan/inputs.js';

declareDimensions('tests/unit/design/audit-type.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const CUSTOM = join(FIXTURES, 'custom-scale-project/design');

const custom = readPavedRoad(CUSTOM);
const builtIn: DesignTokenScale = buildPavedRoad({
  pageRoots: ['src/pages'],
  componentEntrypoints: []
}).tokenScale;

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

function run(scale: DesignTokenScale, name: string): AuditFinding[] {
  return auditType({ tokenScale: scale, sources: [source(name)] });
}

function levelFindings(findings: readonly AuditFinding[]): AuditFinding[] {
  return findings.filter((finding) => finding.techText.includes('levels='));
}

/**
 * The injection control: the level rule inverted.
 *
 * `auditType` reports MORE than four levels. This wrapper reports four or
 * fewer, so a flip in the real rule makes both detectors fire on the same
 * fixture and the calibration below fails instead of passing vacuously.
 */
function invertedTypeLevels(input: AuditInput): AuditFinding[] {
  const levels = typeSizeLevels(measureType(input.sources));
  if (levels.length > 4) return [];
  const file = input.sources[0]?.file ?? '';
  return [
    {
      dimension: 'type',
      severity: 'soft',
      file,
      line: 1,
      value: levels.join('/'),
      expected: '>4',
      humanText: `反向检测器把 ${levels.length} 级字号报成了问题。`,
      techText: `${file}:1 font-size:${levels.join('/')} levels=${levels.length} <= 4 (inverted)`
    }
  ];
}

describe('Scenario: render — a finding carries the documented shape', () => {
  it('when a crowded page is audited, should render one finding per rule with all fields', () => {
    // given: the crowded fixture and its declared scale
    // when: the type audit runs
    // then: five soft findings carry the documented fields and every rule text
    const findings = run(custom.tokenScale, 'type-crowded-page.tsx');
    expect(findings).toHaveLength(5);
    for (const finding of findings) {
      expect(Object.keys(finding).sort()).toEqual([
        'dimension',
        'expected',
        'file',
        'humanText',
        'line',
        'severity',
        'techText',
        'value'
      ]);
      expect(finding.dimension).toBe('type');
      expect(finding.severity).toBe('soft');
    }
    expect(findings.map((finding) => finding.techText)).toEqual([
      'type-crowded-page.tsx:3 font-size:12/14/15/16/20 levels=5 > 4',
      'type-crowded-page.tsx:5 font-size:14/15 gap=1 < step=2',
      'type-crowded-page.tsx:6 font-size:15/16 gap=1 < step=2',
      'type-crowded-page.tsx:3 font-weight:400/500/700 missing 600',
      'type-crowded-page.tsx:5 font-size:15px off-ladder x1 (tokenScale.font: 12/14/16/20/24/32)'
    ]);
  });
});

describe('Scenario: behavior — crowded levels, weights and unreadable sizes', () => {
  it('when a page uses three levels and all four core weights, should report nothing', () => {
    // given: the clean type fixture and a contract that declares a weight scale
    // when: the type audit runs
    // then: no finding is emitted
    expect(custom.tokenScale.weight).toEqual(['400', '500', '600', '700']);
    expect(run(custom.tokenScale, 'type-clean-page.tsx')).toEqual([]);
  });

  it('when a page uses five levels and misses 600, should report crowd, adjacency and the missing weight', () => {
    // given: the crowded fixture
    // when: the type audit runs
    // then: one levels finding, two sub-step adjacency pairs and one weight finding fire
    const findings = run(custom.tokenScale, 'type-crowded-page.tsx');
    expect(findings.filter((finding) => finding.techText.includes('levels='))).toHaveLength(1);
    expect(findings.filter((finding) => finding.techText.includes('gap='))).toHaveLength(2);
    expect(findings.filter((finding) => finding.techText.includes('missing'))).toHaveLength(1);
  });

  it('when a size and a weight resolve through runtime variables, should report both as unmeasured', () => {
    // given: a source whose size and weight are CSS variables
    // when: the type audit runs against a contract that declares a weight scale
    // then: two unmeasured findings name --text-sm and --weight
    const inline: AuditSource = {
      file: 'vars.tsx',
      source:
        'export const X = () => <p className="text-[var(--text-sm)] font-[var(--weight)]">x</p>;\n'
    };
    const findings = auditType({ tokenScale: custom.tokenScale, sources: [inline] });
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === 'unmeasured')).toBe(true);
    expect(findings.some((finding) => finding.techText.includes('--text-sm'))).toBe(true);
    expect(findings.some((finding) => finding.techText.includes('--weight'))).toBe(true);
  });

  it('when the contract declares a two-weight scale, should require only those weights', () => {
    // given: a page using 400 and 500, and a contract whose weight ladder is [400, 500]
    // when: the type audit runs
    // then: 600/700 are not "missing" — the requirement is the declared ladder
    const declared: DesignTokenScale = { ...builtIn, weight: ['400', '500'] };
    const source500: AuditSource = {
      file: 'pages/weights.tsx',
      source: 'export const X = () => <p className="font-normal font-medium">x</p>;\n'
    };
    const findings = auditType({ tokenScale: declared, sources: [source500] });
    expect(findings.some((finding) => finding.techText.includes('missing'))).toBe(false);
  });

  it('when the contract declares no weight scale, should report the weight part as unmeasured', () => {
    // given: the clean type fixture judged against the built-in scale, which has no weight group
    // when: the type audit runs
    // then: the only finding is the unmeasured weight gap, not a violation
    const findings = run(builtIn, 'type-clean-page.tsx');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toContain('tokenScale.weight not declared');
  });

  it('when the level rule is inverted, should disagree on both calibration pages', () => {
    // given: the clean and crowded fixtures, and an inverted level rule
    // when: both rules are applied to the same declared scale
    // then: the real rule fires only on the crowded page and the inverted one only on the clean page
    const clean: AuditInput = {
      tokenScale: custom.tokenScale,
      sources: [source('type-clean-page.tsx')]
    };
    const crowded: AuditInput = {
      tokenScale: custom.tokenScale,
      sources: [source('type-crowded-page.tsx')]
    };
    expect(levelFindings(auditType(clean))).toEqual([]);
    expect(levelFindings(auditType(crowded))).toHaveLength(1);
    expect(invertedTypeLevels(clean)).toHaveLength(1);
    expect(invertedTypeLevels(crowded)).toEqual([]);
  });
});

describe('Scenario: behavior — every off-ladder value is a finding', () => {
  it('when two off-ladder sizes repeat, should emit one finding per value with its count', () => {
    // given: `text-[11px]` twice and `text-[13px]` once against the built-in ladder
    // when: the type audit runs
    // then: one finding per distinct value names the first witness and the count
    const findings = run(builtIn, 'type-off-ladder-page.tsx');
    const offLadder = findings.filter((finding) => finding.techText.includes(' off-ladder x'));
    expect(offLadder.map((finding) => finding.techText)).toEqual([
      'type-off-ladder-page.tsx:3 font-size:11px off-ladder x2 (tokenScale.font: 12/14/16/20/24/32)',
      'type-off-ladder-page.tsx:5 font-size:13px off-ladder x1 (tokenScale.font: 12/14/16/20/24/32)'
    ]);
  });

  it('when the contract declares the sizes the page uses, should report nothing off-ladder', () => {
    // given: the same page and a ladder that declares 11 and 13
    // when: the type audit runs
    // then: the same values are on-contract — the oracle, not the page, changed
    const declared: DesignTokenScale = { ...builtIn, font: ['11', '13', '16'] };
    const findings = run(declared, 'type-off-ladder-page.tsx');
    expect(findings.filter((finding) => finding.techText.includes(' off-ladder x'))).toEqual([]);
  });

  it('when a page stays on the ladder, should emit no off-ladder finding', () => {
    // given: the clean type fixture
    // when: the type audit runs
    // then: no off-ladder finding exists to explain a ratio
    const findings = run(custom.tokenScale, 'type-clean-page.tsx');
    expect(findings.filter((finding) => finding.techText.includes(' off-ladder x'))).toEqual([]);
  });
});

describe('Scenario: integration — the audit reads the contract on disk', () => {
  it('when the fixture project declares a weight scale, should use it instead of unmeasured', () => {
    // given: the same clean page and two contracts, one with a weight scale and one without
    // when: the type audit runs against each
    // then: the declared scale yields no finding and the built-in one yields the unmeasured gap
    expect(run(custom.tokenScale, 'type-clean-page.tsx')).toEqual([]);
    expect(run(builtIn, 'type-clean-page.tsx')).toHaveLength(1);
  });
});

describe('Scenario: a11y — the bilingual pair is actionable', () => {
  it('when the crowded page is reported, should explain each rule in Chinese', () => {
    // given: the crowded fixture
    // when: the type audit runs
    // then: each human sentence names what is wrong in plain Chinese
    const findings = run(custom.tokenScale, 'type-crowded-page.tsx');
    expect(findings.some((finding) => finding.humanText.includes('超过 4 级'))).toBe(true);
    expect(findings.some((finding) => finding.humanText.includes('只差 1px'))).toBe(true);
    expect(findings.some((finding) => finding.humanText.includes('缺少 600'))).toBe(true);
  });

  it('when a variable-backed size is unreadable, should name the variable in both languages', () => {
    // given: a source whose font size is var(--text-sm)
    // when: the type audit runs
    // then: the human and technical lines both name the variable
    const inline: AuditSource = {
      file: 'vars.tsx',
      source: 'export const X = () => <p className="text-[var(--text-sm)]">x</p>;\n'
    };
    const findings = auditType({ tokenScale: custom.tokenScale, sources: [inline] });
    const unreadable = findings.find((finding) => finding.techText.includes('--text-sm'));
    expect(unreadable?.humanText).toContain('--text-sm');
    expect(unreadable?.techText).toContain('variable --text-sm');
  });
});
