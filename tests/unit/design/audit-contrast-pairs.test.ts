import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  auditContrast,
  contrastRatio,
  relativeLuminance,
  type DeclaredColorPair
} from '../../../src/services/design/audit/audit-contrast.js';

declareDimensions('tests/unit/design/audit-contrast-pairs.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WHITE = '#ffffff';

describe('Scenario: behavior — WCAG luminance reads dark and light channels', () => {
  it('when a channel is on the linear branch, should divide it instead of scaling it', () => {
    // given: #0a0a0a, whose channel is at the linear branch of the sRGB curve
    // when: its relative luminance is computed
    // then: the value is the WCAG linear result, not a wildly larger number
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(0.003035, 6);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('not-a-colour')).toBeNull();
  });
});

describe('Scenario: behavior — an unreadable side makes the ratio unmeasurable', () => {
  it('when either colour cannot be read, should return null instead of a ratio', () => {
    // given: one unreadable foreground, one unreadable background, and one valid pair
    // when: the ratios are computed
    // then: each unreadable side yields null and the valid pair still measures 21:1
    expect(contrastRatio('not-a-colour', WHITE)).toBeNull();
    expect(contrastRatio(WHITE, 'not-a-colour')).toBeNull();
    expect(contrastRatio('#000000', WHITE)).toBeCloseTo(21, 10);
  });
});

describe('Scenario: integration — declared pairs are filtered and resolved', () => {
  const ink = { ink: { $value: '#000000' }, paper: { $value: WHITE } };

  it('when invalid pair entries are declared, should judge only the well-formed pairs', () => {
    // given: null, string, and half-shaped entries beside one valid pair
    // when: the contrast audit runs
    // then: the valid black-on-white pair passes and no malformed entry is read
    const pairs = [
      null,
      'oops',
      { fg: 'ink' },
      { fg: 1, bg: 'paper' },
      { fg: 'ink', bg: 2 },
      { fg: 'ink', bg: 'paper' }
    ] as unknown as DeclaredColorPair[];
    expect(auditContrast({ color: ink, pairs }, 'inline.json')).toEqual([]);
  });

  it('when a declared token key carries the CSS prefix, should resolve it by name', () => {
    // given: pairs naming --ink and --paper while the colour group keys are bare
    // when: the contrast audit runs
    // then: the prefixed keys resolve and the pair measures normally
    const prefixed = {
      color: { ink: ink.ink, paper: ink.paper },
      pairs: [{ fg: '--ink', bg: '--paper' }]
    };
    expect(auditContrast(prefixed, 'inline.json')).toEqual([]);
  });

  it('when the colour group is absent, should report the pair unmeasured instead of throwing', () => {
    // given: a pairs array but no colour group at all
    // when: the contrast audit runs
    // then: each pair is a named unmeasured finding
    const findings = auditContrast({ pairs: [{ fg: 'ink', bg: 'paper' }] }, 'inline.json');
    expect(findings).toEqual([
      {
        dimension: 'contrast',
        severity: 'unmeasured',
        file: 'inline.json',
        line: 1,
        value: '--ink/--paper',
        expected: 'declared pair',
        humanText:
          '契约的配对 --ink/--paper 无法计算对比度（token --ink not declared），这个配对的对比度是未知的。',
        techText: 'inline.json:1 contrast:--ink/--paper unmeasured (token --ink not declared)'
      }
    ]);
  });

  it('when no pairs are declared, should render the exact recommendation finding', () => {
    // given: a contract with colours and no pairs array
    // when: the contrast audit runs
    // then: the unmeasured finding quotes the pairs[] shape
    expect(auditContrast({ color: ink }, 'inline.json')).toEqual([
      {
        dimension: 'contrast',
        severity: 'unmeasured',
        file: 'inline.json',
        line: 1,
        value: 'pairs',
        expected: 'pairs[]',
        humanText:
          '契约没有声明前景/背景配对，无法判断文字对比度；建议在 tokens.json 里增加 pairs 数组，声明正文和大字各自的配对。',
        techText: 'inline.json:1 pairs:missing unmeasured (declare pairs[] { fg, bg, large? })'
      }
    ]);
  });

  it('when a token name ends in dashes, should prefix it exactly once for display', () => {
    // given: a colour key `muted--` whose key already ends with dashes
    // when: a pair using it is unmeasured
    // then: the display keeps the name as `--muted--`, not a prefix-stripped form
    const findings = auditContrast(
      { color: { 'muted--': { $value: '#777777' } }, pairs: [{ fg: 'muted--', bg: 'ghost' }] },
      'inline.json'
    );
    expect(findings[0]?.value).toBe('--muted--/--ghost');
    expect(findings[0]?.techText).toContain('token --ghost not declared');
  });
});

describe('Scenario: a11y — the sentence names the text size and threshold', () => {
  it('when body and large pairs both fail, should name 正文 and 大字 with their thresholds', () => {
    // given: the same failing grey declared once as body text and once as large text
    // when: the contrast audit runs
    // then: each sentence names its size class and the matching minimum
    const color = { ink: { $value: '#999999' }, paper: { $value: WHITE } };
    const findings = auditContrast(
      {
        color,
        pairs: [
          { fg: 'ink', bg: 'paper' },
          { fg: 'ink', bg: 'paper', large: true }
        ]
      },
      'inline.json'
    );
    expect(findings).toHaveLength(2);
    expect(findings[0]?.humanText).toContain('正文要求的 4.5:1');
    expect(findings[1]?.humanText).toContain('大字要求的 3:1');
    expect(findings[0]?.expected).toBe('4.5:1');
    expect(findings[1]?.expected).toBe('3:1');
    expect(findings[0]?.techText).toMatch(/contrast:--ink\/--paper=\d\.\d\d < 4\.5/);
  });
});
