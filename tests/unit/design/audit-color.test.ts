import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type {
  AuditFinding,
  AuditSource
} from '../../../src/services/design/audit/audit-finding.js';
import {
  auditColor,
  chromaticFamilies,
  chromaticSpellings,
  declaredColourIndex,
  measureColor,
  type ColorAuditInput
} from '../../../src/services/design/audit/audit-color.js';
import { buildPavedRoad, type DesignTokenScale } from '../../../src/services/design/paved-road.js';

declareDimensions('tests/unit/design/audit-color.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const MAX_CHROMATIC_FAMILIES = 5;

const scale: DesignTokenScale = buildPavedRoad({
  pageRoots: [],
  componentEntrypoints: []
}).tokenScale;

type Tokens = { color?: Record<string, { $value: string }> };

function tokensOf(name: string): Tokens {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as Tokens;
}

const tokens = tokensOf('tokens-color.json');

function source(name: string): AuditSource {
  return { file: name, source: readFileSync(join(FIXTURES, name), 'utf8') };
}

function run(name: string, oracle: Tokens = tokens): AuditFinding[] {
  return auditColor({ tokenScale: scale, sources: [source(name)], tokens: oracle });
}

/**
 * The injection control: the family rule inverted.
 *
 * `auditColor` reports MORE than five chromatic families. This wrapper reports
 * five or fewer, so a flip in the real rule makes both detectors fire on the
 * same fixture and the calibration below fails instead of passing vacuously.
 */
function invertedFamilyRule(input: ColorAuditInput): AuditFinding[] {
  const families = chromaticFamilies(measureColor(input.sources), input.tokens);
  if (families.length > MAX_CHROMATIC_FAMILIES) return [];
  const file = input.sources[0]?.file ?? '';
  return [
    {
      dimension: 'color',
      severity: 'soft',
      file,
      line: 1,
      value: families.map((family) => family.label).join('、'),
      expected: `>${MAX_CHROMATIC_FAMILIES}`,
      humanText: `反向检测器把 ${families.length} 个色系报成了问题。`,
      techText: `${file}:1 colour-families:${families.length} <= ${MAX_CHROMATIC_FAMILIES} (inverted)`
    }
  ];
}

/**
 * The injection control: the raw-literal rule inverted.
 *
 * The real detector reports literals that have NO declared token. This wrapper
 * reports the ones that DO, so an inverted rule would light up the clean page.
 */
function invertedRawRule(input: ColorAuditInput): AuditFinding[] {
  const index = declaredColourIndex(input.tokens);
  return measureColor(input.sources).flatMap((sample): AuditFinding[] => {
    if (sample.hex === null || !index.has(sample.hex)) return [];
    const literal = sample.literal ?? sample.raw;
    return [
      {
        dimension: 'color',
        severity: 'hard',
        file: sample.file,
        line: sample.line,
        value: literal,
        expected: 'raw',
        humanText: `反向检测器把已声明的 ${literal} 报成了原始色值。`,
        techText: `${sample.file}:${sample.line} ${sample.property}:${literal} IN tokens.color (inverted)`
      }
    ];
  });
}

describe('Scenario: render — a finding carries the documented shape', () => {
  it('when a raw literal has no token, should render a hard finding with all fields', () => {
    // given: the raw-hex fixture and the declared colour token group
    // when: the colour audit runs
    // then: one hard finding carries exactly the documented fields
    const findings = run('color-raw-hex-page.tsx');
    expect(findings).toHaveLength(1);
    expect(Object.keys(findings[0] ?? {}).sort()).toEqual([
      'dimension',
      'expected',
      'file',
      'humanText',
      'line',
      'severity',
      'techText',
      'value'
    ]);
    expect(findings[0]?.dimension).toBe('color');
    expect(findings[0]?.severity).toBe('hard');
    expect(findings[0]?.file).toBe('color-raw-hex-page.tsx');
  });

  it('when seven families are used, should render one soft finding with the family list', () => {
    // given: the seven-family fixture
    // when: the colour audit runs
    // then: the only finding is soft and its technical line lists seven buckets
    const findings = run('color-seven-family-page.tsx');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.dimension).toBe('color');
    expect(findings[0]?.severity).toBe('soft');
    expect(findings[0]?.techText).toContain('colour-families:7 > 5');
  });
});

describe('Scenario: behavior — families, raw literals and unreadable values', () => {
  it('when a page uses five families with a dark duplicate, should stay clean', () => {
    // given: seven token-mapped literals across five 30° hue buckets, two of them a light/dark pair
    // when: the colour audit runs against the declared colour group
    // then: no finding is emitted and the family count is five
    expect(run('color-five-family-page.tsx')).toEqual([]);
    const samples = measureColor([source('color-five-family-page.tsx')]);
    expect(chromaticFamilies(samples, tokens)).toHaveLength(5);
  });

  it('when the dark duplicate is not subtracted, should count six spellings', () => {
    // given: the same five-family page, whose dark pair names two distinct tokens
    // when: the chromatic spellings are counted without the dark-theme subtraction
    // then: six spellings exceed five, which is what the subtraction exists to prevent
    const samples = measureColor([source('color-five-family-page.tsx')]);
    const spellings = chromaticSpellings(samples, tokens);
    const dark = samples.find((sample) => sample.dark);
    expect(spellings).toHaveLength(6);
    expect(spellings).toContain('--danger-500');
    expect(spellings).toContain('--danger-400');
    expect(dark?.literal).toBe('#f87171');
    expect(chromaticFamilies(samples, tokens)).toHaveLength(5);
  });

  it('when seven palette families are used, should list each with its witness', () => {
    // given: the seven-family fixture built from Tailwind palette classes
    // when: the colour audit runs
    // then: one soft finding names every family and cites each first file:line witness
    const findings = run('color-seven-family-page.tsx');
    const technical = findings[0]?.techText ?? '';
    expect(technical).toContain('bg-red-500@color-seven-family-page.tsx:3');
    expect(technical).toContain('text-blue-500@color-seven-family-page.tsx:9');
    expect(findings[0]?.value).toBe('红、橙、琥珀、黄绿、绿、天蓝、蓝');
    expect(findings.every((finding) => finding.severity === 'soft')).toBe(true);
  });

  it('when one literal is declared and another is not, should flag only the undeclared one', () => {
    // given: the raw-hex page whose #c81e1e is declared and whose #ff00aa is not
    // when: the colour audit runs
    // then: the declared literal is silent and the undeclared one is the single hard finding
    expect(declaredColourIndex(tokens).get('#c81e1e')).toBe('--danger-500');
    const findings = run('color-raw-hex-page.tsx');
    expect(findings.map((finding) => finding.value)).toEqual(['#ff00aa']);
    expect(findings[0]?.line).toBe(4);
  });

  it('when oklch uses underscores and rgba follows an identifier, should measure both', () => {
    // given: a page with `oklch(0.82_0.04_155)` and `shadow-[…_rgba(…)]`
    // when: the colour audit measures and judges it
    // then: both notations are read, and the old word-boundary rule is shown to miss the rgba
    const samples = measureColor([source('color-underscore-page.tsx')]);
    const oklch = samples.find((sample) => sample.literal?.startsWith('oklch'));
    const rgba = samples.find((sample) => sample.literal?.startsWith('rgba'));
    expect(oklch?.hue).toBeCloseTo(154.78, 1);
    expect(oklch?.chroma ?? 0).toBeGreaterThan(0.035);
    expect(rgba?.hex).toBe('#000000');
    expect(rgba?.hue).toBeNull();
    expect(/\brgba\(/.test('shadow-[0_2px_16px_rgba(0,0,0,0.1)]')).toBe(false);
    expect(/(?:rgba?)\(/.test('shadow-[0_2px_16px_rgba(0,0,0,0.1)]')).toBe(true);
    expect(run('color-underscore-page.tsx').map((finding) => finding.value)).toEqual([
      'oklch(0.82_0.04_155)',
      'rgba(0,0,0,0.1)'
    ]);
  });

  it('when a value is a variable or a color-mix chain, should report unmeasured and name it', () => {
    // given: a class backed by var(--brand) and a style backed by color-mix of two variables
    // when: the colour audit runs
    // then: both findings are unmeasured and neither is a violation
    const findings = run('color-unmeasured-page.tsx');
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === 'unmeasured')).toBe(true);
    expect(findings[0]?.techText).toContain('variable --brand');
    expect(findings[1]?.techText).toContain('color-mix(); variable --ink, --surface');
  });

  it('when the contract declares no colour token, should report one page-level gap', () => {
    // given: the raw-hex page and an empty colour group
    // when: the colour audit runs
    // then: one unmeasured finding replaces every hard literal, because there is no oracle
    const findings = run('color-raw-hex-page.tsx', { color: {} });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toContain('colour-literals:2');
    expect(findings[0]?.techText).toContain('tokens.color declares no colour token');
  });

  it('when a text utility resolves through a variable, should leave it to the type detector', () => {
    // given: text-[var(--text-sm)] (ambiguous size/colour) and text-[color:var(--ink)] (explicit)
    // when: the colour audit runs on each
    // then: the ambiguous one is silent and the explicit one names its variable
    const ambiguous: AuditSource = {
      file: 'text-var.tsx',
      source: 'export const X = () => <p className="text-[var(--text-sm)]">x</p>;\n'
    };
    const explicit: AuditSource = {
      file: 'text-colour.tsx',
      source: 'export const X = () => <p className="text-[color:var(--ink)]">x</p>;\n'
    };
    expect(auditColor({ tokenScale: scale, sources: [ambiguous], tokens })).toEqual([]);
    const findings = auditColor({ tokenScale: scale, sources: [explicit], tokens });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.techText).toContain('variable --ink');
  });

  it('when the family rule is inverted, should disagree on clean and crowded pages', () => {
    // given: the five-family and seven-family pages, and an inverted family rule
    // when: both rules run on both pages
    // then: the real rule fires only on the crowded page and the inverted one only on the clean page
    const clean: ColorAuditInput = {
      tokenScale: scale,
      sources: [source('color-five-family-page.tsx')],
      tokens
    };
    const crowded: ColorAuditInput = {
      tokenScale: scale,
      sources: [source('color-seven-family-page.tsx')],
      tokens
    };
    expect(invertedFamilyRule(clean)).toHaveLength(1);
    expect(invertedFamilyRule(crowded)).toEqual([]);
    expect(run('color-five-family-page.tsx')).toEqual([]);
    expect(run('color-seven-family-page.tsx')).toHaveLength(1);
  });

  it('when the raw-literal rule is inverted, should disagree on clean and raw pages', () => {
    // given: the declared-literal page and the undeclared-literal page
    // when: the real and inverted raw-literal rules run on both
    // then: the real rule reports #ff00aa and the inverted one reports the declared colours
    const clean: ColorAuditInput = {
      tokenScale: scale,
      sources: [source('color-five-family-page.tsx')],
      tokens
    };
    const raw: ColorAuditInput = {
      tokenScale: scale,
      sources: [source('color-raw-hex-page.tsx')],
      tokens
    };
    expect(invertedRawRule(clean)).toHaveLength(6);
    expect(invertedRawRule(raw).map((finding) => finding.value)).toEqual(['#c81e1e']);
    expect(run('color-five-family-page.tsx')).toEqual([]);
    expect(run('color-raw-hex-page.tsx').map((finding) => finding.value)).toEqual(['#ff00aa']);
  });
});

describe('Scenario: integration — the audit reads the token contract on disk', () => {
  it('when tokens.json is read from disk, should audit literals against that group', () => {
    // given: the fixture tokens file and the same page judged with and without it
    // when: the colour audit runs against each oracle
    // then: the declared group yields the hard literal and the empty group yields only the gap
    const declared = run('color-raw-hex-page.tsx', tokens);
    const absent = run('color-raw-hex-page.tsx', { color: {} });
    expect(declared.map((finding) => finding.severity)).toEqual(['hard']);
    expect(absent.map((finding) => finding.severity)).toEqual(['unmeasured']);
    expect(declaredColourIndex(tokens).size).toBe(6);
  });
});

describe('Scenario: a11y — the bilingual pair is actionable', () => {
  it('when a raw literal is reported, should name the colour and cite file:line', () => {
    // given: the raw-hex fixture
    // when: the colour audit runs
    // then: the human sentence names the literal and line, and the technical line is grep-able
    const finding = run('color-raw-hex-page.tsx')[0];
    expect(finding?.humanText).toContain('第 4 行');
    expect(finding?.humanText).toContain('原始色值 #ff00aa');
    expect(finding?.techText).toBe(
      'color-raw-hex-page.tsx:4 color:#ff00aa raw colour not a declared token'
    );
  });

  it('when seven families are reported, should explain the crowd in plain Chinese', () => {
    // given: the seven-family fixture
    // when: the colour audit runs
    // then: the sentence names the count, the colours and the threshold
    const finding = run('color-seven-family-page.tsx')[0];
    expect(finding?.humanText).toContain('7 个色系');
    expect(finding?.humanText).toContain('超过 5 个');
    expect(finding?.humanText).toContain('红');
    expect(finding?.humanText).toContain('蓝');
  });

  it('when a color-mix chain is unmeasured, should name its variables in both languages', () => {
    // given: the unmeasured fixture's color-mix style
    // when: the colour audit runs
    // then: the human and technical lines both name --ink and --surface
    const finding = run('color-unmeasured-page.tsx').find((entry) =>
      entry.techText.includes('color-mix()')
    );
    expect(finding?.humanText).toContain('--ink, --surface');
    expect(finding?.techText).toContain('variable --ink, --surface');
  });
});
