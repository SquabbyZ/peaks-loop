import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { AuditFinding } from '../../../src/services/design/audit/audit-finding.js';
import {
  auditContrast,
  contrastRatio,
  PAIRS_CONTRACT_LINE,
  relativeLuminance,
  type ContrastContract
} from '../../../src/services/design/audit/audit-contrast.js';

declareDimensions('tests/unit/design/audit-contrast.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const BODY_MIN = 4.5;
const LARGE_MIN = 3;

function contractOf(name: string): ContrastContract {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as ContrastContract;
}

function run(name: string): AuditFinding[] {
  return auditContrast(contractOf(name), name);
}

/**
 * The injection control: the contrast rule inverted.
 *
 * The real detector reports a pair BELOW its threshold. This wrapper reports
 * one AT OR ABOVE it, so a flip in the real rule makes both detectors fire on
 * the same fixture and the calibration below fails instead of passing.
 */
function invertedContrast(contract: ContrastContract, file: string): AuditFinding[] {
  return (contract.pairs ?? []).flatMap((pair): AuditFinding[] => {
    const foreground = contract.color?.[pair.fg]?.$value ?? '';
    const background = contract.color?.[pair.bg]?.$value ?? '';
    const ratio = contrastRatio(foreground, background);
    if (ratio === null) return [];
    const minimum = pair.large === true ? LARGE_MIN : BODY_MIN;
    if (ratio < minimum) return [];
    return [
      {
        dimension: 'contrast',
        severity: 'hard',
        file,
        line: 1,
        value: `${ratio.toFixed(2)}:1`,
        expected: `<${minimum}:1`,
        humanText: `反向检测器把通过对比度的 ${pair.fg}/${pair.bg} 报成了问题。`,
        techText: `${file}:1 contrast:--${pair.fg}/--${pair.bg}=${ratio.toFixed(2)} >= ${minimum} (inverted)`
      }
    ];
  });
}

describe('Scenario: render — a finding carries the documented shape', () => {
  it('when one declared pair fails, should render a hard finding with all fields', () => {
    // given: the failing-pairs fixture, whose muted pair sits just below 4.5:1
    // when: the contrast audit runs
    // then: one hard finding carries exactly the documented fields and the contrast dimension
    const findings = run('tokens-pairs-failing.json');
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
    expect(findings[0]?.dimension).toBe('contrast');
    expect(findings[0]?.severity).toBe('hard');
    expect(findings[0]?.file).toBe('tokens-pairs-failing.json');
  });
});

describe('Scenario: behavior — WCAG maths, thresholds and honest gaps', () => {
  it('when the known boundary pairs are measured, should land on opposite sides of 4.5', () => {
    // given: #000 on #fff, #767676 on #fff and #777 on #fff — the WCAG boundary pair
    // when: the ratio is computed
    // then: 21 for black on white, and the two greys straddle 4.5
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#767676', '#fff')).toBeCloseTo(4.5422, 4);
    expect(contrastRatio('#777', '#fff')).toBeCloseTo(4.4781, 4);
    expect(contrastRatio('#767676', '#fff') ?? 0).toBeGreaterThan(BODY_MIN);
    expect(contrastRatio('#777', '#fff') ?? Infinity).toBeLessThan(BODY_MIN);
  });

  it('when a colour cannot be read, should return a null luminance rather than a guess', () => {
    // given: a var() reference and a color-mix chain, neither a concrete colour
    // when: luminance is requested
    // then: both are null, which becomes unmeasured rather than a ratio
    expect(relativeLuminance('var(--x)')).toBeNull();
    expect(relativeLuminance('color-mix(in oklch, #000, #fff)')).toBeNull();
  });

  it('when one pair fails and two pass, should report only the failing pair', () => {
    // given: the failing-pairs fixture (4.54 passing, 4.48 failing, 3.03 large passing)
    // when: the contrast audit runs
    // then: only the muted pair is reported, with its measured ratio
    const findings = run('tokens-pairs-failing.json');
    expect(findings.map((finding) => finding.value)).toEqual(['4.48:1']);
    expect(findings[0]?.expected).toBe('4.5:1');
    expect(findings[0]?.techText).toContain('--muted/--background=4.48 < 4.5');
  });

  it('when every declared pair passes, should report nothing', () => {
    // given: the passing-pairs fixture (4.54:1 and 21:1)
    // when: the contrast audit runs
    // then: no finding is emitted
    expect(run('tokens-pairs-passing.json')).toEqual([]);
  });

  it('when a 3.03:1 pair is declared large, should apply the 3:1 threshold', () => {
    // given: #949494 on #fff (3.03:1) declared once as large and once as body text
    // when: the contrast audit runs on each
    // then: the large pair passes and the same pair as body text is hard
    const color = {
      background: { $value: '#ffffff' },
      subtle: { $value: '#949494' }
    };
    const large = auditContrast({
      color,
      pairs: [{ fg: 'subtle', bg: 'background', large: true }]
    });
    const body = auditContrast({ color, pairs: [{ fg: 'subtle', bg: 'background' }] });
    expect(large).toEqual([]);
    expect(body).toHaveLength(1);
    expect(body[0]?.expected).toBe('4.5:1');
  });

  it('when the contract declares no pairs, should recommend declaring them', () => {
    // given: a tokens file with a colour group but no pairs array
    // when: the contrast audit runs
    // then: exactly one unmeasured finding recommends pairs and no pairing is inferred
    const findings = run('tokens-color.json');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toContain('pairs:missing');
    expect(findings[0]?.humanText).toContain('建议');
    expect(findings.some((finding) => finding.severity === 'hard')).toBe(false);
  });

  it('when a pair names an undeclared token, should report the pair as unmeasured', () => {
    // given: a pair whose foreground token is absent from the colour group
    // when: the contrast audit runs
    // then: the finding is unmeasured and names the missing token
    const findings = auditContrast(
      { color: { background: { $value: '#ffffff' } }, pairs: [{ fg: 'ghost', bg: 'background' }] },
      'inline.json'
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toContain('token --ghost not declared');
  });

  it('when a token value cannot be converted, should report the pair as unmeasured', () => {
    // given: a foreground token declared as a color-mix chain
    // when: the contrast audit runs
    // then: the finding is unmeasured and says the value cannot be converted
    const findings = auditContrast({
      color: {
        background: { $value: '#ffffff' },
        foreground: { $value: 'color-mix(in oklch, #000, #333)' }
      },
      pairs: [{ fg: 'foreground', bg: 'background' }]
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('unmeasured');
    expect(findings[0]?.techText).toContain('--foreground value cannot be converted');
  });

  it('when the rule is inverted, should disagree on passing and failing contracts', () => {
    // given: the passing and failing fixtures and an inverted contrast rule
    // when: both rules run on both contracts
    // then: the real rule fires only on the failing file and the inverted one only on the passing file
    const failing = contractOf('tokens-pairs-failing.json');
    const passing = contractOf('tokens-pairs-passing.json');
    expect(invertedContrast(passing, 'tokens-pairs-passing.json')).toHaveLength(2);
    expect(invertedContrast(failing, 'tokens-pairs-failing.json')).toHaveLength(2);
    expect(auditContrast(passing, 'tokens-pairs-passing.json')).toEqual([]);
    expect(auditContrast(failing, 'tokens-pairs-failing.json')).toHaveLength(1);
  });
});

describe('Scenario: integration — the audit reads the contract on disk', () => {
  it('when tokens.json declares pairs on disk, should cite the file in the finding', () => {
    // given: the failing-pairs fixture read from disk
    // when: the contrast audit runs with that file as the cited contract
    // then: the technical line starts with the contract file and its first line
    const findings = run('tokens-pairs-failing.json');
    expect(findings[0]?.techText.startsWith('tokens-pairs-failing.json:1 contrast:')).toBe(true);
  });
});

describe('Scenario: a11y — the bilingual pair is actionable', () => {
  it('when a pair fails, should name both tokens and the measured ratio in Chinese', () => {
    // given: the failing-pairs fixture
    // when: the contrast audit runs
    // then: the sentence names --muted, --background and 4.48:1, and cites the minimum
    const finding = run('tokens-pairs-failing.json')[0];
    expect(finding?.humanText).toContain('--muted');
    expect(finding?.humanText).toContain('--background');
    expect(finding?.humanText).toContain('4.48:1');
    expect(finding?.humanText).toContain('4.5:1');
    expect(finding?.techText).toBe(
      'tokens-pairs-failing.json:1 contrast:--muted/--background=4.48 < 4.5'
    );
  });

  it('when no pairs are declared, should quote the shape to declare', () => {
    // given: a tokens file with no pairs
    // when: the contrast audit runs
    // then: the exported contract line names every field the pairs array accepts
    expect(PAIRS_CONTRACT_LINE).toContain('pairs[]');
    expect(PAIRS_CONTRACT_LINE).toContain('"fg"');
    expect(PAIRS_CONTRACT_LINE).toContain('"bg"');
    expect(PAIRS_CONTRACT_LINE).toContain('"large"');
    expect(run('tokens-color.json')[0]?.humanText).toContain('tokens.json');
  });
});
