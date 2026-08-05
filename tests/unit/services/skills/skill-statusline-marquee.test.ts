// tests/unit/services/skills/skill-statusline-marquee.test.ts
//
// Pure-formatting tests for the marquee scan band. No fs, no subprocess,
// no real clock — every time-sensitive value is parameterised.
//
//   1. visibleCharWidth  — counts display cells, not bytes
//   2. tokenizeAnsi      — round-trips escape sequences as 'esc' tokens
//   3. applyMarqueeHighlight — injects the highlight SGR into the band,
//                              restores the surrounding colour surface
//   4. applyMarquee      — phase formula + ASCII passthrough
//   5. renderStatusLine  — idle never marquees, compact always marquees
//
// Run with: pnpm vitest run tests/unit/services/skills/skill-statusline-marquee.test.ts

import { describe, expect, it } from 'vitest';
import {
  applyMarquee,
  applyMarqueeHighlight,
  tokenizeAnsi,
  visibleCharWidth,
  type StatusLineCapability,
} from '~/src/services/skills/skill-statusline-renderer';

describe("Scenario: visibleCharWidth — ANSI escape skipping", () => {
  it("when invoked, should counts a plain ASCII string", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(visibleCharWidth('Peaks')).toBe(5);
  });

  it("when invoked, should skips a single SGR escape", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(visibleCharWidth('\x1b[1;38;2;90;101;216mPeaks\x1b[0m')).toBe(5);
  });

  it("when invoked, should skips multiple stacked SGR escapes", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Brand prefix + reset + idle glyph + reset + skill name
    const s = '\x1b[1;38;2;90;101;216mPeaks\x1b[0m \x1b[5;1;38;2;90;101;216m○\x1b[0m empty';
    expect(visibleCharWidth(s)).toBe(13);
  });

  it("when invoked, should returns 0 for an empty string", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(visibleCharWidth('')).toBe(0);
  });

  it("when invoked, should returns 0 for an escape-only string", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(visibleCharWidth('\x1b[0m\x1b[1m')).toBe(0);
  });
});

describe("Scenario: tokenizeAnsi — escape / text segmentation", () => {
  it("when invoked, should groups a plain ASCII string as a single text token", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(tokenizeAnsi('Peaks')).toEqual([{ kind: 'text', value: 'Peaks' }]);
  });

  it("when invoked, should segments SGR escapes from surrounding text", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const s = '\x1b[1;38;2;90;101;216mPeaks\x1b[0m';
    expect(tokenizeAnsi(s)).toEqual([
      { kind: 'esc', value: '\x1b[1;38;2;90;101;216m' },
      { kind: 'text', value: 'Peaks' },
      { kind: 'esc', value: '\x1b[0m' },
    ]);
  });

  it("when invoked, should returns an empty stream for an empty string", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(tokenizeAnsi('')).toEqual([]);
  });
});

describe("Scenario: applyMarqueeHighlight — band injection", () => {
  it("when invoked, should paints the leading 3 cells with the highlight SGR and restores brand", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = applyMarqueeHighlight('Peaks ● peaks', 0, 2);
    expect(out).toBe('\x1b[1;38;2;224;224;224mPea\x1b[0mks ● peaks');
  });

  it("when invoked, should paints a mid-range window and restores both sides", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = applyMarqueeHighlight('Peaks ● peaks', 4, 6);
    // 'Peaks ● peaks' index: P=0, e=1, a=2, k=3, s=4, ' '=5, ●=6, ' '=7, p=8…
    // Cells [4, 6] = 's', ' ', '●' get the highlight; everything else
    // keeps the original (plain) text.
    expect(out).toBe('Peak\x1b[1;38;2;224;224;224ms ●\x1b[0m peaks');
  });

  it("when invoked, should returns input unchanged when the band is fully outside [0, width-1]", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(applyMarqueeHighlight('Peaks', -10, -5)).toBe('Peaks');
    expect(applyMarqueeHighlight('Peaks', 100, 110)).toBe('Peaks');
  });

  it("when invoked, should returns input unchanged when bandStart > bandEnd", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(applyMarqueeHighlight('Peaks', 5, 2)).toBe('Peaks');
  });

  it("when invoked, should closes the highlight at the end of the line", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = applyMarqueeHighlight('Peaks', 2, 4);
    // 'a','k','s' get the highlight, then the trailing reset closes it.
    expect(out).toBe('Pe\x1b[1;38;2;224;224;224maks\x1b[0m');
  });
});

describe("Scenario: applyMarquee — phase formula and capability gating", () => {
  const SAMPLE = 'Peaks ● peaks-code [full-auto] → peaks-loop';
  const ALL_CAPS: StatusLineCapability[] = ['ansi-unicode', 'unicode', 'ascii'];

  it("when invoked, should ASCII tier is a pass-through regardless of nowMs", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    for (const nowMs of [0, 500, 1000, 1500, 1999]) {
      expect(applyMarquee(SAMPLE, nowMs, 'ascii')).toBe(SAMPLE);
    }
  });

  it("when invoked, should at nowMs=0 the band sits at the LEFT edge covering cells [0, 1]", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = applyMarquee(SAMPLE, 0, 'unicode');
    // BAND_WIDTH=2 → halfBand=1; at nowMs=0 center=0, so band covers
    // visible cells [0, 1] = 'Pe'.
    expect(out).toContain('\x1b[1;38;2;224;224;224mPe\x1b[0m');
    expect(out.startsWith('\x1b[1;38;2;224;224;224mPe\x1b[0m')).toBe(true);
  });

  it("when invoked, should at nowMs=200 (phase=0.5) the band sits at the RIGHT edge covering cells [41, 42]", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = applyMarquee(SAMPLE, 200, 'unicode');
    // width = 43 (visible cells); period = 400ms → phase at 200 = 0.5,
    // sweep = 1.0; center = round(1.0 * 42) = 42; halfBand = 1;
    // bandStart = 41, bandEnd = 42 (the last 2 cells 'op' of
    // 'peaks-loop'). After the band, the reset is injected.
    expect(out).toContain('\x1b[1;38;2;224;224;224mop\x1b[0m');
  });

  it("when invoked, should returns input unchanged for an empty string", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(applyMarquee('', 0, 'unicode')).toBe('');
    expect(applyMarquee('', 1000, 'ansi-unicode')).toBe('');
  });

  it("when invoked, should never grows the visible width — band cells keep their byte count", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    for (const cap of ALL_CAPS) {
      const widths = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 1999].map((t) =>
        visibleCharWidth(applyMarquee(SAMPLE, t, cap)),
      );
      // ASCII is pass-through so width is always constant; unicode
      // tiers also preserve width because highlight SGR is invisible.
      expect(new Set(widths).size).toBe(1);
    }
  });

  it("when invoked, should band never paints outside the visible range, even at the period edge", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // When center = 0, bandStart clamps to 0 (bandStart must be >= 0).
    const out = applyMarquee(SAMPLE, 0, 'unicode');
    expect(out.startsWith('\x1b[1;38;2;224;224;224m')).toBe(true);
  });
});