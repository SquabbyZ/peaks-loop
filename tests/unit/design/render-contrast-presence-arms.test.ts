import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  auditRenderedContrast,
  familyNearIn,
  PRESENCE_DELTA_E,
  thresholdViolated
} from '../../../src/services/design/audit/render/contrast-presence.js';
import type { ContrastContract } from '../../../src/services/design/audit/audit-contrast.js';
import { RENDER_TEST_TIMEOUT_MS } from './_render-fixtures.js';
import { paletteFamily, paletteMeasurement, renderFrameOf } from './_render-frames.js';

declareDimensions('tests/unit/design/render-contrast-presence-arms.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

// Stryker's dry run defaults to 5 s; these CPU-only tests get the repo's budget.
vi.setConfig({ testTimeout: RENDER_TEST_TIMEOUT_MS });

const FILE = 'design/tokens.json';

function contractOf(
  pairs: unknown,
  color: Record<string, unknown> = { ink: { $value: '#111111' }, paper: { $value: '#ffffff' } }
): ContrastContract {
  return { color, pairs } as unknown as ContrastContract;
}

/** A solid frame painting #111111 (20 %) and #ffffff (80 %). */
function passFrame(capture = 'probe/frame/full-page.png') {
  const families = [paletteFamily('#ffffff', 80), paletteFamily('#111111', 20)];
  return renderFrameOf(paletteMeasurement({ families }), 'solid', capture);
}

const INK_PAIR = [{ fg: 'ink', bg: 'paper' }];

describe('Scenario: render — the WCAG threshold is strict at equality', () => {
  it('when the ratio equals the minimum, should not report a violation', () => {
    // given: ratio and minimum both 4.5
    // when: the real threshold rule runs
    // then: equality is not below, so no violation
    expect(thresholdViolated(4.5, 4.5)).toBe(false);
  });

  it('when the ratio is below or above the minimum, should report exactly one side', () => {
    // given: 4.49 and 4.51 against 4.5
    // when: the rule runs with both operators
    // then: only the below case fires in the real arm
    expect(thresholdViolated(4.49, 4.5)).toBe(true);
    expect(thresholdViolated(4.51, 4.5)).toBe(false);
  });

  it('when the invert arm runs, should report only the passing side', () => {
    // given: the same three ratios
    // when: the calibration arm is used
    // then: equality and above fire, below does not
    expect(thresholdViolated(4.5, 4.5, true)).toBe(true);
    expect(thresholdViolated(4.51, 4.5, true)).toBe(true);
    expect(thresholdViolated(4.49, 4.5, true)).toBe(false);
  });
});

describe('Scenario: behavior — presence is the closest family inside the window', () => {
  it('when several families are present, should pick the closest one', () => {
    // given: families near, far and very far from #767676
    // when: the presence matcher runs
    // then: the nearest family wins, not the last one scanned
    const measurement = paletteMeasurement({
      families: [
        paletteFamily('#767676', 5),
        paletteFamily('#7a7a7a', 50),
        paletteFamily('#ffffff', 45)
      ]
    });
    expect(familyNearIn(measurement, '#767676')?.colour).toBe('#767676');
  });

  it('when no family is inside the window, should return null', () => {
    // given: a target #000000 and only light families
    // when: the real matcher runs
    // then: nothing is within the presence window
    const measurement = paletteMeasurement({ families: [paletteFamily('#ffffff', 100)] });
    expect(familyNearIn(measurement, '#000000')).toBeNull();
    expect(PRESENCE_DELTA_E).toBe(0.03);
  });

  it('when the invert arm runs, should return the closest family outside the window', () => {
    // given: the same light family and a black target
    // when: the flipped arm runs
    // then: the neighbour outside the window is returned
    const measurement = paletteMeasurement({ families: [paletteFamily('#ffffff', 100)] });
    expect(familyNearIn(measurement, '#000000', true)?.colour).toBe('#ffffff');
  });

  it('when the declared colour is not a hex, should return null', () => {
    // given: a non-hex target
    // when: the matcher runs
    // then: there is no OKLab target and no match
    expect(familyNearIn(paletteMeasurement({ families: [] }), 'not-a-colour')).toBeNull();
  });

  it('when a family colour is unreadable, should skip it rather than throw', () => {
    // given: one unreadable family and one real family
    // when: the matcher runs
    // then: the unreadable family is skipped and the real one wins
    const measurement = paletteMeasurement({
      families: [
        { colour: '#zzzzzz', areaShare: 90, chroma: 0, rank: 0 },
        paletteFamily('#767676', 10)
      ]
    });
    expect(familyNearIn(measurement, '#767676')?.colour).toBe('#767676');
  });

  it('when two families sit at the same distance, should break the tie by area', () => {
    // given: the same colour twice, 10 % and 20 %
    // when: the matcher runs
    // then: the larger family is chosen
    const measurement = paletteMeasurement({
      families: [
        { colour: '#767676', areaShare: 10, chroma: 0, rank: 0 },
        { colour: '#767676', areaShare: 20, chroma: 0, rank: 0 }
      ]
    });
    expect(familyNearIn(measurement, '#767676')?.areaShare).toBe(20);
  });
});

describe('Scenario: integration — malformed pairs are filtered, never trusted', () => {
  it('when the pair list holds null and partial entries, should only judge the valid pair', () => {
    // given: null, a number, an fg-only and a bg-only entry beside one complete pair
    // when: the rendered audit runs
    // then: only the complete pair is measured
    const result = auditRenderedContrast(
      contractOf([null, 42, { fg: 'ink' }, { bg: 'paper' }, INK_PAIR[0]]),
      [passFrame()],
      FILE
    );
    expect(result.judged).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('when the pairs field is not an array, should judge nothing', () => {
    // given: pairs declared as a string
    // when: the rendered audit runs
    // then: no pair is invented
    expect(auditRenderedContrast(contractOf('nope'), [passFrame()], FILE)).toEqual({
      findings: [],
      judged: false
    });
  });

  it('when a declared token is missing, should record the pair unmeasured', () => {
    // given: a pair naming a token the contract does not declare
    // when: the rendered audit runs
    // then: the finding names the unconvertible declaration
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ghost', bg: 'paper' }]),
      [passFrame()],
      FILE
    );
    expect(result.judged).toBe(false);
    expect(result.findings[0]?.techText).toBe(
      'design/tokens.json:1 contrast:--ghost/--paper unmeasured (declared token is missing or unconvertible)'
    );
  });

  it('when a token value is not a string, should treat it as missing', () => {
    // given: ink declared as a number
    // when: the rendered audit runs
    // then: the token cannot resolve and the pair is unmeasured
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper' }], {
        ink: { $value: 42 },
        paper: { $value: '#ffffff' }
      }),
      [passFrame()],
      FILE
    );
    expect(result.findings[0]?.techText).toContain('declared token is missing or unconvertible');
  });

  it('when a token value cannot be converted, should record the same unmeasured reason', () => {
    // given: ink declared as a non-colour string
    // when: the rendered audit runs
    // then: the pair stops at resolution
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper' }], {
        ink: { $value: 'not-a-colour' },
        paper: { $value: '#ffffff' }
      }),
      [passFrame()],
      FILE
    );
    expect(result.findings[0]?.techText).toBe(
      'design/tokens.json:1 contrast:--ink/--paper unmeasured (declared token is missing or unconvertible)'
    );
  });
});

describe('Scenario: render — absent and non-solid pairs read differently', () => {
  it('when a declared colour never renders, should name the count and both colours', () => {
    // given: a pair #000000 on #ffffff and a frame painting #111111/#ffffff
    // when: the rendered audit runs
    // then: the exact unmeasured sentence names the absence
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper' }], {
        ink: { $value: '#000000' },
        paper: { $value: '#ffffff' }
      }),
      [passFrame()],
      FILE
    );
    expect(result.findings[0]).toEqual({
      dimension: 'contrast',
      severity: 'unmeasured',
      file: FILE,
      line: 1,
      value: '--ink/--paper',
      expected: 'both colours in the rendered frame',
      humanText:
        '契约的配对 --ink/--paper 无法从渲染结果确认（声明过但没有渲染出来（1 张截图里没有同时找到这两个颜色）），这个配对的对比度是未知的。',
      techText:
        'design/tokens.json:1 contrast:--ink/--paper unmeasured (declared but not rendered (no family within ΔE 0.03 of #000000 and #ffffff in 1 capture(s)))'
    });
  });

  it('when two captures are checked, should report the capture count', () => {
    // given: the same absent pair over two frames
    // when: the rendered audit runs
    // then: both captures are counted in the reason
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper' }], {
        ink: { $value: '#000000' },
        paper: { $value: '#ffffff' }
      }),
      [passFrame('a/full-page.png'), passFrame('b/full-page.png')],
      FILE
    );
    expect(result.findings[0]?.techText).toContain('in 2 capture(s)');
  });

  it('when only the foreground renders, should treat the pair as absent', () => {
    // given: #111111 rendered and #000000 absent
    // when: the rendered audit runs
    // then: presence needs both colours and the pair is unmeasured
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper' }], {
        ink: { $value: '#111111' },
        paper: { $value: '#000000' }
      }),
      [passFrame()],
      FILE
    );
    expect(result.judged).toBe(false);
    expect(result.findings[0]?.techText).toContain('declared but not rendered');
  });

  it('when a frame was refused, should not read the absent palette', () => {
    // given: a frame whose palette read failed
    // when: the rendered audit runs
    // then: the pair is unmeasured, never a crash
    const refused = {
      capture: 'probe/frame/full-page.png',
      route: '/',
      slug: null,
      background: 'unknown' as const,
      palette: { ok: false as const, reason: 'not a png' }
    };
    const result = auditRenderedContrast(contractOf(INK_PAIR), [refused], FILE);
    expect(result.judged).toBe(false);
  });
});

describe('Scenario: behavior — a non-solid background is unmeasured with its label', () => {
  it.each([
    ['gradient', '渐变'],
    ['image', '图片'],
    ['unknown', '未知']
  ] as const)('when the background is %s, should say %s and not judge', (kind, label) => {
    // given: both declared colours present over a non-solid background
    // when: the rendered audit runs
    // then: the pair is unmeasured and the Chinese label names the background
    const result = auditRenderedContrast(contractOf(INK_PAIR), [passFrameWith(kind)], FILE);
    expect(result.judged).toBe(false);
    expect(result.findings[0]?.humanText).toContain(`配对的背景是${label}，不是纯色`);
    expect(result.findings[0]?.techText).toContain(
      `rendered over a ${kind} background, not a solid fill`
    );
  });

  it('when two non-solid frames differ, should list both labels and cite the first', () => {
    // given: a gradient frame and an unknown frame, both rendering the pair
    // when: the rendered audit runs
    // then: the kinds are de-duplicated, joined, and the first capture is cited
    const result = auditRenderedContrast(
      contractOf(INK_PAIR),
      [
        passFrameWith('gradient', 'first/full-page.png'),
        passFrameWith('unknown', 'second/full-page.png')
      ],
      FILE
    );
    expect(result.findings[0]?.humanText).toContain('配对的背景是渐变、未知，不是纯色');
    expect(result.findings[0]?.techText).toContain('first/full-page.png:1');
    expect(result.findings[0]?.techText).toContain('rendered over a gradient background');
  });

  it('when a solid frame and a gradient frame both render the pair, should use the solid one', () => {
    // given: a gradient frame first, then a solid frame
    // when: the rendered audit runs
    // then: the pair is judged from the solid frame
    const result = auditRenderedContrast(
      contractOf(INK_PAIR),
      [passFrameWith('gradient'), passFrameWith('solid')],
      FILE
    );
    expect(result.judged).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe('Scenario: render — a token key may or may not carry the CSS prefix', () => {
  it('when the pair names --ink and the token is ink, should resolve and display one prefix', () => {
    // given: pair keys with -- and a color group whose keys omit it
    // when: a passing pair is audited
    // then: the pair resolves and the finding value carries exactly one prefix
    const families = [paletteFamily('#ffffff', 92), paletteFamily('#7a7a7a', 8)];
    const result = auditRenderedContrast(
      contractOf([{ fg: '--ink', bg: '--paper' }], {
        ink: { $value: '#767676' },
        paper: { $value: '#ffffff' }
      }),
      [renderFrameOf(paletteMeasurement({ families }), 'solid', 'probe/frame/full-page.png')],
      FILE
    );
    expect(result.findings[0]?.value).toBe('4.29:1');
    expect(result.findings[0]?.techText).toContain('contrast:--ink/--paper=4.29');
  });
});

describe('Scenario: a11y — the failing pair names the rendered colours exactly', () => {
  it('when a body pair fails, should print the measured ratio and the body threshold', () => {
    // given: #767676 declared on #ffffff but rendered as #7a7a7a
    // when: the finding is read
    // then: the human sentence and greppable line are exact
    const families = [paletteFamily('#ffffff', 92), paletteFamily('#7a7a7a', 8)];
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper' }], {
        ink: { $value: '#767676' },
        paper: { $value: '#ffffff' }
      }),
      [renderFrameOf(paletteMeasurement({ families }), 'solid', 'probe/frame/full-page.png')],
      FILE
    );
    expect(result.findings[0]?.humanText).toBe(
      '渲染帧里同时出现了 #7a7a7a 和 #ffffff，两色对比度为 4.29:1，低于正文要求的 4.5:1；本规则只证明两个颜色都出现在同一帧，没有验证文字与背景是否相邻。'
    );
    expect(result.findings[0]?.techText).toBe(
      'probe/frame/full-page.png:1 contrast:--ink/--paper=4.29 < 4.5 (both rendered #7a7a7a and #ffffff present, solid; adjacency not measured)'
    );
  });

  it('when a pair is marked large by a truthy non-boolean, should still use the body threshold', () => {
    // given: large declared as the string "yes"
    // when: the pair fails 4.5 but passes 3.0
    // then: the strict large === true check keeps the body rule
    const families = [paletteFamily('#ffffff', 92), paletteFamily('#7a7a7a', 8)];
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper', large: 'yes' }], {
        ink: { $value: '#767676' },
        paper: { $value: '#ffffff' }
      }),
      [renderFrameOf(paletteMeasurement({ families }), 'solid', 'probe/frame/full-page.png')],
      FILE
    );
    expect(result.findings[0]?.expected).toBe('4.5:1');
    expect(result.findings[0]?.humanText).toContain('正文要求');
  });

  it('when a pair is truly large, should say large text and use the 3:1 threshold', () => {
    // given: large: true on the same 4.29:1 pair
    // when: the finding is read
    // then: it names the large-text threshold
    const families = [paletteFamily('#ffffff', 92), paletteFamily('#7a7a7a', 8)];
    const result = auditRenderedContrast(
      contractOf([{ fg: 'ink', bg: 'paper', large: true }], {
        ink: { $value: '#767676' },
        paper: { $value: '#ffffff' }
      }),
      [renderFrameOf(paletteMeasurement({ families }), 'solid', 'probe/frame/full-page.png')],
      FILE
    );
    expect(result.findings).toEqual([]);
    expect(result.judged).toBe(true);
  });
});

function passFrameWith(kind: 'solid' | 'gradient' | 'image' | 'unknown', capture?: string) {
  const families = [paletteFamily('#ffffff', 80), paletteFamily('#111111', 20)];
  return renderFrameOf(paletteMeasurement({ families }), kind, capture);
}
