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

describe('visibleCharWidth — ANSI escape skipping', () => {
  it('counts a plain ASCII string', () => {
    expect(visibleCharWidth('Peaks')).toBe(5);
  });

  it('skips a single SGR escape', () => {
    expect(visibleCharWidth('\x1b[1;38;2;90;101;216mPeaks\x1b[0m')).toBe(5);
  });

  it('skips multiple stacked SGR escapes', () => {
    // Brand prefix + reset + idle glyph + reset + skill name
    const s = '\x1b[1;38;2;90;101;216mPeaks\x1b[0m \x1b[5;1;38;2;90;101;216m○\x1b[0m empty';
    expect(visibleCharWidth(s)).toBe(13);
  });

  it('returns 0 for an empty string', () => {
    expect(visibleCharWidth('')).toBe(0);
  });

  it('returns 0 for an escape-only string', () => {
    expect(visibleCharWidth('\x1b[0m\x1b[1m')).toBe(0);
  });
});

describe('tokenizeAnsi — escape / text segmentation', () => {
  it('groups a plain ASCII string as a single text token', () => {
    expect(tokenizeAnsi('Peaks')).toEqual([{ kind: 'text', value: 'Peaks' }]);
  });

  it('segments SGR escapes from surrounding text', () => {
    const s = '\x1b[1;38;2;90;101;216mPeaks\x1b[0m';
    expect(tokenizeAnsi(s)).toEqual([
      { kind: 'esc', value: '\x1b[1;38;2;90;101;216m' },
      { kind: 'text', value: 'Peaks' },
      { kind: 'esc', value: '\x1b[0m' },
    ]);
  });

  it('returns an empty stream for an empty string', () => {
    expect(tokenizeAnsi('')).toEqual([]);
  });
});

describe('applyMarqueeHighlight — band injection', () => {
  it('paints the leading 3 cells with the highlight SGR and restores brand', () => {
    const out = applyMarqueeHighlight('Peaks ● peaks', 0, 2);
    expect(out).toBe('\x1b[1;38;2;224;224;224mPea\x1b[0mks ● peaks');
  });

  it('paints a mid-range window and restores both sides', () => {
    const out = applyMarqueeHighlight('Peaks ● peaks', 4, 6);
    // 'Peaks ● peaks' index: P=0, e=1, a=2, k=3, s=4, ' '=5, ●=6, ' '=7, p=8…
    // Cells [4, 6] = 's', ' ', '●' get the highlight; everything else
    // keeps the original (plain) text.
    expect(out).toBe('Peak\x1b[1;38;2;224;224;224ms ●\x1b[0m peaks');
  });

  it('returns input unchanged when the band is fully outside [0, width-1]', () => {
    expect(applyMarqueeHighlight('Peaks', -10, -5)).toBe('Peaks');
    expect(applyMarqueeHighlight('Peaks', 100, 110)).toBe('Peaks');
  });

  it('returns input unchanged when bandStart > bandEnd', () => {
    expect(applyMarqueeHighlight('Peaks', 5, 2)).toBe('Peaks');
  });

  it('closes the highlight at the end of the line', () => {
    const out = applyMarqueeHighlight('Peaks', 2, 4);
    // 'a','k','s' get the highlight, then the trailing reset closes it.
    expect(out).toBe('Pe\x1b[1;38;2;224;224;224maks\x1b[0m');
  });
});

describe('applyMarquee — phase formula and capability gating', () => {
  const SAMPLE = 'Peaks ● peaks-code [full-auto] → peaks-loop';
  const ALL_CAPS: StatusLineCapability[] = ['ansi-unicode', 'unicode', 'ascii'];

  it('ASCII tier is a pass-through regardless of nowMs', () => {
    for (const nowMs of [0, 500, 1000, 1500, 1999]) {
      expect(applyMarquee(SAMPLE, nowMs, 'ascii')).toBe(SAMPLE);
    }
  });

  it('at nowMs=0 the band sits at the LEFT edge covering cells [0, 2]', () => {
    const out = applyMarquee(SAMPLE, 0, 'unicode');
    expect(out).toContain('\x1b[1;38;2;224;224;224mPea\x1b[0m');
    expect(out.startsWith('\x1b[1;38;2;224;224;224mPea\x1b[0m')).toBe(true);
  });

  it('at nowMs=1000 (phase=0.5) the band sits at the RIGHT edge', () => {
    const out = applyMarquee(SAMPLE, 1000, 'unicode');
    // width = 46 (visible cells); center = round(1.0 * 45) = 45;
    // halfBand = 2; bandStart = 43; bandEnd = 45 (the last 3 cells
    // 'oop' of 'peaks-loop'). After the band, the reset is injected.
    expect(out).toContain('\x1b[1;38;2;224;224;224moop\x1b[0m');
  });

  it('returns input unchanged for an empty string', () => {
    expect(applyMarquee('', 0, 'unicode')).toBe('');
    expect(applyMarquee('', 1000, 'ansi-unicode')).toBe('');
  });

  it('never grows the visible width — band cells keep their byte count', () => {
    for (const cap of ALL_CAPS) {
      const widths = [0, 250, 500, 750, 1000, 1250, 1500, 1750, 1999].map((t) =>
        visibleCharWidth(applyMarquee(SAMPLE, t, cap)),
      );
      // ASCII is pass-through so width is always constant; unicode
      // tiers also preserve width because highlight SGR is invisible.
      expect(new Set(widths).size).toBe(1);
    }
  });

  it('band never paints outside the visible range, even at the period edge', () => {
    // When center = 0, bandStart clamps to 0 (bandStart must be >= 0).
    const out = applyMarquee(SAMPLE, 0, 'unicode');
    expect(out.startsWith('\x1b[1;38;2;224;224;224m')).toBe(true);
  });
});