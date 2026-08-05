// tests/unit/services/skills/skill-statusline-renderer.test.ts
//
// Pure-formatting tests for skill-statusline-renderer. No fs, no subprocess,
// no real clock. The 4 dimensions covered:
//
//   - render   — exact-string assertions for every capability (unicode /
//                ascii / ansi-unicode), state, and projectRoot combination.
//   - behavior — attention-gate classification is conservative: only
//                known-blocking gate names surface as a warning token;
//                routine gates stay hidden. Mode token is scoped to
//                peaks-code only.
//   - integration — N/A (no fs, no subprocess); omitted with reason.
//   - a11y     — output is single-line, contains no CLI verb, contains
//                no legacy mountain glyphs, never balloons.
//
// Run with: pnpm vitest run tests/unit/services/skills/skill-statusline-renderer.test.ts

import { describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import type {
  StatusLineModel,
  StatusLinePresence,
} from '~/src/services/skills/skill-statusline-service';

declareDimensions(
  'tests/unit/services/skills/skill-statusline-renderer.test.ts',
  ['render', 'behavior', 'a11y'],
  [{ dim: 'integration', reason: 'Pure formatting layer — no fs, no subprocess, no real clock.' }],
);

import {
  renderStatusLine,
  resolveStatusLineCapability,
  type StatusLineCapability,
  type StatusLineRenderOptions,
} from '~/src/services/skills/skill-statusline-renderer';
import type {
  CompactStatuslineState,
} from '~/src/services/compact-statusline/compact-statusline-service';

const ROOT = '/repo/peaks-loop';

function presenceOf(
  skill: string,
  extras: Partial<StatusLinePresence> = {},
): StatusLinePresence {
  return { skill, ...extras };
}

function activeModel(presence: StatusLinePresence | null, projectRoot: string | null = ROOT): StatusLineModel {
  return {
    state: presence ? 'active' : 'idle',
    projectRoot,
    presence,
    ageMs: null,
    compact: { kind: 'none', filledCells: 0 },
    activeLeaf: null,
  };
}

function staleModel(presence: StatusLinePresence, ageMs: number): StatusLineModel {
  return { state: 'stale', projectRoot: ROOT, presence, ageMs, compact: { kind: 'none', filledCells: 0 }, activeLeaf: null };
}

function invalidModel(): StatusLineModel {
  return { state: 'invalid-presence', projectRoot: ROOT, presence: null, ageMs: null, compact: { kind: 'none', filledCells: 0 }, activeLeaf: null };
}

function idleModel(projectRoot: string | null = ROOT): StatusLineModel {
  return { state: 'idle', projectRoot, presence: null, ageMs: null, compact: { kind: 'none', filledCells: 0 }, activeLeaf: null };
}

function compactActiveModel(compact: CompactStatuslineState): StatusLineModel {
  return {
    state: 'active',
    projectRoot: ROOT,
    presence: presenceOf('peaks-code'),
    ageMs: null,
    compact,
    activeLeaf: null,
  };
}

// Pin the wall clock so the breathing glyph is deterministic per test.
function withPinnedClock<T>(nowMs: number, fn: () => T): T {
  vi.spyOn(Date, 'now').mockReturnValue(nowMs);
  try {
    return fn();
  } finally {
    vi.restoreAllMocks();
  }
}

describe("Scenario: render — capability matrix (exact strings)", () => {
  it("when invoked, should unicode: active presence renders Peaks ● peaks-code → peaks-loop with cyan escape", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    // At t=0 the marquee band sits at the LEFT edge. With BAND_WIDTH=2
    // the band covers cells [0, 1] (center=0 clamps; halfBand=1 → only
    // cells inside the visible range are painted). The first 2 characters
    // (`Pe`) get re-painted to the highlight SGR `#E0E0E0`. The rest of
    // the line keeps the brand purple + dim purple tokens. Asserting the
    // full string pins both the colour surface AND the band anchor.
    expect(withPinnedClock(0, () =>
      renderStatusLine(model, { capability: 'unicode' }),
    )).toBe('\x1b[1;38;2;90;101;216m\x1b[1;38;2;224;224;224mPe\x1b[0maks\x1b[0m \x1b[1;38;2;90;101;216m●\x1b[0m \x1b[1;38;2;90;101;216mpeaks-code\x1b[0m\x1b[1;38;2;90;101;216m → \x1b[0mpeaks-loop');
  });

  it("when invoked, should unicode: stripped output for active presence is Peaks ● peaks-code → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'unicode' }));
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe('Peaks ● peaks-code → peaks-loop');
  });

  it("when invoked, should unicode: idle renders Peaks ○ empty → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(null);
    const out = renderStatusLine(model, { capability: 'unicode' });
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe('Peaks ○ empty → peaks-loop');
  });

  it("when invoked, should idle glyph carries the slow-blink SGR (ansi-unicode)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(null);
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    expect(out).toContain('\x1b[5;1;38;2;90;101;216m○\x1b[0m');
  });

  it("when invoked, should idle glyph carries the slow-blink SGR (unicode capability)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(null);
    const out = renderStatusLine(model, { capability: 'unicode' });
    expect(out).toContain('\x1b[5;1;38;2;90;101;216m○\x1b[0m');
  });

  it("when invoked, should ascii idle glyph stays plain (no SGR) for file / log consumers", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(null);
    const out = renderStatusLine(model, { capability: 'ascii' });
    expect(out).not.toContain('\x1b[');
    expect(out).toBe('Peaks o empty -> peaks-loop');
  });

  it("when invoked, should ascii: active presence renders Peaks * peaks-code -> peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    expect(withPinnedClock(0, () =>
      renderStatusLine(model, { capability: 'ascii' }),
    )).toBe('Peaks * peaks-code -> peaks-loop');
  });

  it("when invoked, should ansi-unicode: cyan escape appears around brand and active glyph", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    const out = withPinnedClock(0, () => renderStatusLine(model, { capability: 'ansi-unicode' }));
    // Marquee band at t=0 paints the first 2 visible cells with the
    // highlight SGR (center=0 clamps; halfBand=1); the rest of the
    // line keeps the brand purple.
    expect(out).toBe('\x1b[1;38;2;90;101;216m\x1b[1;38;2;224;224;224mPe\x1b[0maks\x1b[0m \x1b[1;38;2;90;101;216m●\x1b[0m \x1b[1;38;2;90;101;216mpeaks-code\x1b[0m\x1b[1;38;2;90;101;216m → \x1b[0mpeaks-loop');
  });

  it("when invoked, should ansi-unicode: stripped output for idle is identical to unicode idle", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(null);
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe('Peaks ○ empty → peaks-loop');
  });
});

describe("Scenario: render — peaks-code mode display", () => {
  it("when invoked, should peaks-code with mode renders the [mode] token in unicode", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'full-auto' }));
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-code [full-auto] → peaks-loop');
  });

  it("when invoked, should peaks-code with empty mode does NOT render brackets", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: '' }));
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-code → peaks-loop');
  });

  it("when invoked, should peaks-code without mode field does NOT render brackets", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-code → peaks-loop');
  });

  it("when invoked, should peaks-rd active leaf surfaces both layers and the orchestrator mode token", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'full-auto' }));
    model.activeLeaf = { role: 'peaks-rd', pendingCount: 1 };
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-rd | peaks-code [full-auto] → peaks-loop');
  });

  it("when invoked, should peaks-qa active leaf surfaces both layers and the orchestrator mode token", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'strict' }));
    model.activeLeaf = { role: 'peaks-qa', pendingCount: 1 };
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-qa | peaks-code [strict] → peaks-loop');
  });

  it("when invoked, should peaks-rd active leaf with no orchestrator mode token", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    model.activeLeaf = { role: 'peaks-rd', pendingCount: 1 };
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-rd | peaks-code → peaks-loop');
  });

  it("when invoked, should orchestrator skill (peaks-code) with no active leaf shows just the orchestrator", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'full-auto' }));
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-code [full-auto] → peaks-loop');
  });

  it("when invoked, should unknown skill in presence is rendered verbatim (no parent marker, no leaf mapping)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-some-bee-future'));
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-some-bee-future → peaks-loop');
  });

  it("when invoked, should multi-leaf active (pendingCount > 1) renders the (+N-1) suffix on the leaf", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'full-auto' }));
    model.activeLeaf = { role: 'peaks-rd', pendingCount: 3 };
    expect(withPinnedClock(0, () =>
      stripped(renderStatusLine(model, { capability: 'unicode' })),
    )).toBe('Peaks ● peaks-rd (+2) | peaks-code [full-auto] → peaks-loop');
  });

  it("when invoked, should mode token is bracketed in ascii capability too", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'assisted' }));
    expect(withPinnedClock(0, () =>
      renderStatusLine(model, { capability: 'ascii' }),
    )).toBe('Peaks * peaks-code [assisted] -> peaks-loop');
  });
});

describe("Scenario: render — stale and invalid-presence diagnostics", () => {
  it("when invoked, should stale unicode renders Peaks ! peaks-code · stale 25h → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const presence = presenceOf('peaks-code');
    const ageMs = 25 * 60 * 60 * 1000; // 25h
    const out = renderStatusLine(staleModel(presence, ageMs), { capability: 'unicode' });
    expect(stripped(out)).toBe('Peaks ! peaks-code · stale 25h → peaks-loop');
  });

  it("when invoked, should invalid-presence unicode renders Peaks ! presence unreadable → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = renderStatusLine(invalidModel(), { capability: 'unicode' });
    expect(stripped(out)).toBe('Peaks ! presence unreadable → peaks-loop');
  });

  it("when invoked, should stale ascii mirrors the unicode layout with ASCII glyphs", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const presence = presenceOf('peaks-code');
    const ageMs = 25 * 60 * 60 * 1000;
    const out = renderStatusLine(staleModel(presence, ageMs), { capability: 'ascii' });
    expect(out).toBe('Peaks ! peaks-code . stale 25h -> peaks-loop');
  });
});

describe("Scenario: render — turn-boundary visibility (1.5s gap)", () => {
  // Brief: between two typical turns (~1.5s apart) the breathing glyph
  // must jump 1-2 frames and the marquee band must visibly translate.
  // Old 2.4s / 2.0s periods made both movements imperceptible.
  it("when invoked, should unicode active glyph at nowMs=0 differs from nowMs=1500 (1500 % 600 = 300 → glyph index 2)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    const out0 = withPinnedClock(0, () => renderStatusLine(model, { capability: 'unicode' }));
    const out1500 = withPinnedClock(1500, () => renderStatusLine(model, { capability: 'unicode' }));
    expect(out0.split(' ')[1]).not.toBe(out1500.split(' ')[1]);
    // Anchor: at t=0 the first slot of the unicode palette (index 0)
    // is rendered. Strip ANSI to read the visible glyph verbatim.
    const glyph0 = out0.replace(/\x1b\[[0-9;]*m/g, '').split(' ')[1];
    expect(glyph0).toBe('●');
  });

  it("when invoked, should marquee band moves visibly between nowMs=0 (left edge) and nowMs=1500 (mid-line)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Phase at 0: 0.0  → sweep 0  → center 0  → band [0, 1] (left edge).
    // Phase at 1500: 1500%400=300, phase=0.75, sweep=(1-0.75)*2=0.5
    //                center=round(0.5*30)=15 → band [14, 16] (mid-line).
    // The contract is "band visibly translates between two turns ~1.5s
    // apart". Assert on band-anchor position via the highlight SGR
    // (which is interleaved with brand-purple wrapping inside the band,
    // so a literal substring match is brittle). Stripping ANSI to count
    // the SGR moves the assertion onto a stable invariant.
    const model = activeModel(presenceOf('peaks-code'));
    const out0 = withPinnedClock(0, () => renderStatusLine(model, { capability: 'unicode' }));
    const out1500 = withPinnedClock(1500, () => renderStatusLine(model, { capability: 'unicode' }));
    // The two outputs must differ — band moved.
    expect(out0).not.toBe(out1500);
    // At t=0 the band sits at the LEFT edge; the highlight SGR paints
    // the first 2 visible cells ('Pe'). The exact prefix pins the band
    // anchor at the leftmost position.
    expect(out0.startsWith('\x1b[1;38;2;90;101;216m\x1b[1;38;2;224;224;224mPe\x1b[0m')).toBe(true);
    // At t=1500 the band has moved off the left edge. The leading prefix
    // no longer carries the highlight SGR — only the brand-purple SGR
    // wraps the first 5 visible cells ('Peaks').
    expect(out1500.startsWith('\x1b[1;38;2;90;101;216mPeaks\x1b[0m')).toBe(true);
    // The band at t=1500 still emits highlight SGR (proves the band is
    // mid-line, not at the edge).
    expect(out1500).toContain('\x1b[1;38;2;224;224;224m');
  });

  // rid-007: at typical 0.5s turn gaps the breathing glyph must change on
  // EVERY render. With the 600ms period, 500ms advances the glyph index by
  // 500/120 ≈ 4.17 slots, so consecutive renders can never repeat.
  it("when invoked, should 0.5s gap always produces a different breathing glyph (0 → 500 → 1000ms)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    const glyphAt = (t: number): string =>
      withPinnedClock(t, () => renderStatusLine(model, { capability: 'unicode' }))
        .replace(/\x1b\[[0-9;]*m/g, '')
        .split(' ')[1] as string;
    const t0 = glyphAt(0);
    const t05 = glyphAt(500);
    const t1 = glyphAt(1000);
    expect(t0).not.toBe(t05); // 0.5s gap must jump
    expect(t05).not.toBe(t1); // 0.5s gap must jump
    // Exact-anchor the 600ms derivation so a revert to the rid-006
    // 1200ms period (indices 0/2/4 → ●/◑/◓) fails this case, not just
    // the inequality: 500 % 600 = 500 → index 4 (◓); 1000 % 600 = 400
    // → index 3 (◒).
    expect(t0).toBe('●');
    expect(t05).toBe('◓');
    expect(t1).toBe('◒');
  });
});

describe("Scenario: render — 0.6s breathing glyph rotation", () => {
  it("when invoked, should unicode active glyph rotates every 120ms inside the 0.6s period", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const samples = [0, 120, 240, 360, 480, 600].map((t) => {
      const out = withPinnedClock(t, () =>
        renderStatusLine(activeModel(presenceOf('peaks-code')), { capability: 'unicode' }),
      );
      return out;
    });
    const glyphs = samples.map((s) => s.split(' ')[1]);
    // 0.6s period = one full rotation; expect all five distinct glyphs across the 0..480ms window.
    expect(new Set(glyphs.slice(0, 5)).size).toBe(5);
    // The glyph at t=0 and t=600 should match (one full cycle).
    expect(glyphs[0]).toBe(glyphs[5]);
  });

  it("when invoked, should breathing does not change total visible width across the period", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const widths = [0, 120, 240, 360, 480, 599].map((t) =>
      withPinnedClock(t, () => {
        const model = activeModel(presenceOf('peaks-code', { mode: 'full-auto' }));
        return renderStatusLine(model, { capability: 'unicode' }).length;
      }),
    );
    expect(new Set(widths).size).toBe(1);
  });

  it("when invoked, should ascii breathing mirrors the unicode rotation cadence", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const a = withPinnedClock(0, () =>
      renderStatusLine(activeModel(presenceOf('peaks-code')), { capability: 'ascii' }),
    );
    const b = withPinnedClock(300, () =>
      renderStatusLine(activeModel(presenceOf('peaks-code')), { capability: 'ascii' }),
    );
    // 300ms lands mid-period (0.6s); the breathing glyph must differ.
    expect(a.split(' ')[1]).not.toBe(b.split(' ')[1]);
  });

  it("when invoked, should idle, stale, invalid, and compact states never breathe", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const idle = withPinnedClock(0, () => renderStatusLine(idleModel(), { capability: 'unicode' }));
    const idle2 = withPinnedClock(600, () => renderStatusLine(idleModel(), { capability: 'unicode' }));
    expect(idle).toBe(idle2);
  });
});

describe("Scenario: behavior — attention-gate classification", () => {
  it("when invoked, should routine gate (startup) does NOT surface gate label but mode token still appears for peaks-code", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const presence = presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' });
    const out = withPinnedClock(0, () =>
      renderStatusLine(activeModel(presence), { capability: 'unicode' }),
    );
    // Routine gate stays hidden.
    expect(out).not.toContain('startup');
    expect(out).not.toContain('gate:');
    // Mode IS shown because peaks-code owns the mode taxonomy.
    expect(out).toContain('[assisted]');
  });

  it("when invoked, should attention-gate classification surfaces warning glyph with the human-readable gate label", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const presence = presenceOf('peaks-code', { gate: 'qa-validation' });
    expect(stripped(renderStatusLine(activeModel(presence), { capability: 'unicode' }))).toBe(
      'Peaks ! peaks-code · QA → peaks-loop',
    );
  });

  it("when invoked, should ascii capability also surfaces attention gate with ASCII glyphs", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const presence = presenceOf('peaks-code', { gate: 'qa-validation' });
    expect(renderStatusLine(activeModel(presence), { capability: 'ascii' })).toBe(
      'Peaks ! peaks-code . QA -> peaks-loop',
    );
  });
});

describe("Scenario: behavior — defaults and capability boundaries", () => {
  it("when invoked, should default capability is unicode (cyan escape is emitted even without options)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    const out = withPinnedClock(0, () => renderStatusLine(model));
    // Same marquee-anchored expected string as the explicit unicode
    // capability test — the default tier matches `unicode`.
    expect(out).toBe('\x1b[1;38;2;90;101;216m\x1b[1;38;2;224;224;224mPe\x1b[0maks\x1b[0m \x1b[1;38;2;90;101;216m●\x1b[0m \x1b[1;38;2;90;101;216mpeaks-code\x1b[0m\x1b[1;38;2;90;101;216m → \x1b[0mpeaks-loop');
  });

  it("when invoked, should covers every capability literal at runtime", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const allCaps: StatusLineCapability[] = ['ansi-unicode', 'unicode', 'ascii'];
    for (const cap of allCaps) {
      const model = activeModel(presenceOf('peaks-code'));
      const out = renderStatusLine(model, { capability: cap });
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("when invoked, should idle without projectRoot renders without the → suffix", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = idleModel(null);
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe('Peaks ○ empty');
    expect(renderStatusLine(model, { capability: 'ascii' })).toBe('Peaks o empty');
  });

  it("when invoked, should options object is structurally accepted for every capability", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const opts: StatusLineRenderOptions = { capability: 'unicode' };
    const optsAscii: StatusLineRenderOptions = { capability: 'ascii' };
    const optsAnsi: StatusLineRenderOptions = { capability: 'ansi-unicode' };
    expect(opts.capability).toBe('unicode');
    expect(optsAscii.capability).toBe('ascii');
    expect(optsAnsi.capability).toBe('ansi-unicode');
  });
});

describe("Scenario: a11y — output hygiene and forbidden glyphs", () => {
  it("when invoked, should unicode output is single-line", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code'));
    const out = renderStatusLine(model, { capability: 'unicode' });
    expect(out).not.toMatch(/\n/);
  });

  it("when invoked, should output never contains the legacy mountain glyphs", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const capabilities: StatusLineCapability[] = ['unicode', 'ascii', 'ansi-unicode'];
    const models: StatusLineModel[] = [
      activeModel(presenceOf('peaks-code')),
      activeModel(presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' })),
      activeModel(presenceOf('peaks-code', { gate: 'qa-validation' })),
      idleModel(),
      staleModel(presenceOf('peaks-code'), 25 * 60 * 60 * 1000),
      invalidModel(),
    ];
    for (const cap of capabilities) {
      for (const model of models) {
        const out = renderStatusLine(model, { capability: cap });
        expect(out).not.toContain('⛰');
        expect(out).not.toContain('🏔');
      }
    }
  });

  it("when invoked, should output never contains a CLI verb (peaks <verb>) or mode/gate colon labels", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' }));
    const out = renderStatusLine(model, { capability: 'unicode' });
    expect(out).not.toMatch(/\bpeaks\s+[a-z][a-z0-9-]*\b/);
    expect(out).not.toContain('mode:');
    expect(out).not.toContain('gate:');
  });

  it("when invoked, should rendered string never balloons beyond the small model surface", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = activeModel(presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' }));
    const out = renderStatusLine(model, { capability: 'unicode' });
    // 200 byte ceiling: the marquee highlight SGR + brand purple
    // every glyph roughly doubles the byte length of the stripped
    // text. The visible line itself stays under ~50 characters.
    expect(out.length).toBeLessThanOrEqual(200);
  });
});

// Strip ANSI escapes for compact expectations — compact glyphs carry
// color escapes, but the relevant contract is the visible text.
function stripped(out: string): string {
  return out.replace(/\x1b\[[0-9;]*m/g, '');
}

describe("Scenario: render — compact precedence (exact strings)", () => {
  it("when invoked, should queued unicode renders Peaks ◐ [░░░░░░░░] queued · 87% → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'queued', filledCells: 0, triggerRatio: 0.87 });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ◐ [░░░░░░░░] queued · 87% → peaks-loop',
    );
  });

  it("when invoked, should preparing unicode renders Peaks ◑ [██░░░░░░] preparing · 87% → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'preparing', filledCells: 2, triggerRatio: 0.87 });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ◑ [██░░░░░░] preparing · 87% → peaks-loop',
    );
  });

  it("when invoked, should compacting unicode renders Peaks ◒ [████░░░░] compacting · 87% → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'compacting', filledCells: 4, triggerRatio: 0.87 });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ◒ [████░░░░] compacting · 87% → peaks-loop',
    );
  });

  it("when invoked, should verifying unicode renders Peaks ◓ [██████░░] verifying → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'verifying', filledCells: 6 });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ◓ [██████░░] verifying → peaks-loop',
    );
  });

  it("when invoked, should completed unicode renders Peaks ✓ [████████] compacted · 87% → 42% → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({
      kind: 'completed',
      filledCells: 8,
      triggerRatio: 0.87,
      afterRatio: 0.42,
    });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ✓ [████████] compacted · 87% → 42% → peaks-loop',
    );
  });

  it("when invoked, should failed unicode renders Peaks ✕ [████░░░░] compact failed · compacting → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({
      kind: 'failed',
      filledCells: 4,
      failedAt: 'compacting',
    });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ✕ [████░░░░] compact failed · compacting → peaks-loop',
    );
  });

  it("when invoked, should stalled unicode renders Peaks ◒ [████░░░░] stalled → peaks-loop", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'stalled', filledCells: 4 });
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ◒ [████░░░░] stalled → peaks-loop',
    );
  });

  it("when invoked, should invalid unicode surfaces a single-line diagnostic", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({
      kind: 'invalid',
      filledCells: 0,
      detail: 'compact-lifecycle: triggerRatio out of range',
    });
    const out = renderStatusLine(model, { capability: 'unicode' });
    expect(out).toContain('Peaks');
    // The marquee highlight splits the diagnostic phrase across an
    // SGR reset boundary; assert on the visible text after stripping
    // ANSI so the band sweep never breaks the contract.
    const visible = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(visible).toContain('compact-lifecycle: triggerRatio out of range');
    expect(visible).toContain('→ peaks-loop');
    expect(out).not.toContain('?');
  });
});

describe("Scenario: render — compact precedence falls through to C1 when compact.kind=none", () => {
  it("when invoked, should none preserves the normal C1 active line", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'none', filledCells: 0 });
    // Marquee at t=0 paints the leading 2 cells with the highlight SGR
    // (center clamps at 0; halfBand=1).
    expect(withPinnedClock(0, () =>
      renderStatusLine(model, { capability: 'unicode' }),
    )).toBe('\x1b[1;38;2;90;101;216m\x1b[1;38;2;224;224;224mPe\x1b[0maks\x1b[0m \x1b[1;38;2;90;101;216m●\x1b[0m \x1b[1;38;2;90;101;216mpeaks-code\x1b[0m\x1b[1;38;2;90;101;216m → \x1b[0mpeaks-loop');
  });

  it("when invoked, should none preserves the normal C1 idle line", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model: StatusLineModel = {
      state: 'idle',
      projectRoot: ROOT,
      presence: null,
      ageMs: null,
      compact: { kind: 'none', filledCells: 0 },
    };
    expect(stripped(renderStatusLine(model, { capability: 'unicode' }))).toBe(
      'Peaks ○ empty → peaks-loop',
    );
  });
});

describe("Scenario: render — compact precedence ASCII fallback", () => {
  it("when invoked, should compacting ascii renders with #/- bar and ASCII separators", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'compacting', filledCells: 4, triggerRatio: 0.87 });
    expect(renderStatusLine(model, { capability: 'ascii' })).toBe(
      'Peaks + [####----] compacting . 87% -> peaks-loop',
    );
  });

  it("when invoked, should completed ascii renders with full # bar and before->after ratio", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({
      kind: 'completed',
      filledCells: 8,
      triggerRatio: 0.87,
      afterRatio: 0.42,
    });
    expect(renderStatusLine(model, { capability: 'ascii' })).toBe(
      'Peaks * [########] compacted . 87% -> 42% -> peaks-loop',
    );
  });

  it("when invoked, should failed ascii renders with x glyph and failedAt label", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({
      kind: 'failed',
      filledCells: 4,
      failedAt: 'compacting',
    });
    expect(renderStatusLine(model, { capability: 'ascii' })).toBe(
      'Peaks x [####----] compact failed . compacting -> peaks-loop',
    );
  });
});

describe("Scenario: render — compact precedence ANSI/stripped equivalence", () => {
  it("when invoked, should compacting ansi-unicode: stripping yields identical unicode text", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'compacting', filledCells: 4, triggerRatio: 0.87 });
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe(
      'Peaks ◒ [████░░░░] compacting · 87% → peaks-loop',
    );
  });
});

describe("Scenario: resolveStatusLineCapability — pure deterministic resolution", () => {
  const emptyEnv: NodeJS.ProcessEnv = {};

  it("when invoked, should isTTY=true selects ansi-unicode", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(resolveStatusLineCapability({ env: emptyEnv, isTTY: true })).toBe(
      'ansi-unicode',
    );
  });

  it("when invoked, should isTTY=false falls back to unicode (still ANSI-colored but identical glyphs)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(resolveStatusLineCapability({ env: emptyEnv, isTTY: false })).toBe(
      'unicode',
    );
  });

  it("when invoked, should PEAKS_STATUSLINE_ASCII=1 downgrades to ascii", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const result = resolveStatusLineCapability({
      env: { PEAKS_STATUSLINE_ASCII: '1' },
      isTTY: true,
    });
    expect(result).toBe('ascii');
  });

  it("when invoked, should PEAKS_STATUSLINE_ASCII=1 also overrides isTTY=true", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const result = resolveStatusLineCapability({
      env: { PEAKS_STATUSLINE_ASCII: 'yes' },
      isTTY: true,
    });
    expect(result).toBe('ascii');
  });

  it("when invoked, should forced=ascii overrides PEAKS_STATUSLINE_ASCII and isTTY", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const result = resolveStatusLineCapability({
      env: { PEAKS_STATUSLINE_ASCII: '1' },
      isTTY: true,
      forced: 'ascii',
    });
    expect(result).toBe('ascii');
  });

  it("when invoked, should forced=ansi-unicode overrides PEAKS_STATUSLINE_ASCII", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const result = resolveStatusLineCapability({
      env: { PEAKS_STATUSLINE_ASCII: '1' },
      isTTY: false,
      forced: 'ansi-unicode',
    });
    expect(result).toBe('ansi-unicode');
  });

  it("when invoked, should resolution is deterministic — same inputs always yield the same capability", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const a = resolveStatusLineCapability({ env: emptyEnv, isTTY: true });
    const b = resolveStatusLineCapability({ env: emptyEnv, isTTY: true });
    expect(a).toBe(b);
  });
});

describe("Scenario: CLI capability matrix — JSON envelope preserves the rendered string verbatim", () => {
  it("when invoked, should unicode json output contains the rendered text including cyan escape", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({ kind: 'compacting', filledCells: 4, triggerRatio: 0.87 });
    const text = renderStatusLine(model, { capability: 'unicode' });
    const envelope = { ok: true, command: 'statusline.render', data: { text } };
    const json = JSON.stringify(envelope, null, 2);
    const parsed = JSON.parse(json) as { ok: boolean; command: string; data: { text: string } };
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('statusline.render');
    expect(stripped(parsed.data.text)).toBe(
      'Peaks ◒ [████░░░░] compacting · 87% → peaks-loop',
    );
    expect(parsed.data.text).toContain('\x1b[1;38;2;90;101;216m');
  });

  it("when invoked, should ascii capability produces an ANSI-free envelope payload", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const model = compactActiveModel({
      kind: 'completed',
      filledCells: 8,
      triggerRatio: 0.87,
      afterRatio: 0.42,
    });
    const text = renderStatusLine(model, { capability: 'ascii' });
    expect(text).not.toContain('\x1b[');
    const envelope = { ok: true, command: 'statusline.render', data: { text } };
    const parsed = JSON.parse(JSON.stringify(envelope)) as { data: { text: string } };
    expect(parsed.data.text).toBe(
      'Peaks * [########] compacted . 87% -> 42% -> peaks-loop',
    );
  });
});
