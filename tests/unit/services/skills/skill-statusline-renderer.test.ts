// tests/unit/services/skills/skill-statusline-renderer.test.ts
//
// Pure-formatting tests for skill-statusline-renderer. No fs, no subprocess,
// no real clock. The 4 dimensions covered:
//
//   - render   — exact-string assertions for every capability (unicode /
//                ascii / ansi-unicode), state, and projectRoot combination.
//   - behavior — attention-gate classification is conservative: only
//                known-blocking gate names surface as a warning token;
//                routine gates stay hidden. The defaults (no options,
//                ascii fallback) and stale / invalid-presence rendering
//                are covered here.
//   - integration — N/A (no fs, no subprocess); omitted with reason.
//   - a11y     — output is single-line, contains no CLI verb, contains
//                no legacy mountain glyphs, never balloons.
//
// Run with: pnpm vitest run tests/unit/services/skills/skill-statusline-renderer.test.ts

import { describe, expect, it } from 'vitest';
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
  type StatusLineCapability,
  type StatusLineRenderOptions,
} from '~/src/services/skills/skill-statusline-renderer';

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
  };
}

function staleModel(presence: StatusLinePresence, ageMs: number): StatusLineModel {
  return { state: 'stale', projectRoot: ROOT, presence, ageMs };
}

function invalidModel(): StatusLineModel {
  return { state: 'invalid-presence', projectRoot: ROOT, presence: null, ageMs: null };
}

function idleModel(projectRoot: string | null = ROOT): StatusLineModel {
  return { state: 'idle', projectRoot, presence: null, ageMs: null };
}

describe('render — capability matrix (exact strings)', () => {
  it('unicode: active presence renders Peaks ● peaks-code › peaks-loop', () => {
    const model = activeModel(presenceOf('peaks-code'));
    expect(renderStatusLine(model, { capability: 'unicode' })).toBe(
      'Peaks ● peaks-code › peaks-loop',
    );
  });

  it('unicode: idle renders Peaks ○ idle › peaks-loop', () => {
    const model = activeModel(null);
    expect(renderStatusLine(model, { capability: 'unicode' })).toBe(
      'Peaks ○ idle › peaks-loop',
    );
  });

  it('ascii: active presence renders Peaks * peaks-code > peaks-loop', () => {
    const model = activeModel(presenceOf('peaks-code'));
    expect(renderStatusLine(model, { capability: 'ascii' })).toBe(
      'Peaks * peaks-code > peaks-loop',
    );
  });

  it('ansi-unicode: renders with escape codes around the active glyph', () => {
    const model = activeModel(presenceOf('peaks-code'));
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    expect(out).toContain('\x1b[');
    expect(out).toContain('●');
    // Stripping ANSI yields the exact unicode text.
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe('Peaks ● peaks-code › peaks-loop');
  });

  it('ansi-unicode: stripped output for idle is identical to unicode idle', () => {
    const model = activeModel(null);
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    const stripped = out.replace(/\x1b\[[0-9;]*m/g, '');
    expect(stripped).toBe('Peaks ○ idle › peaks-loop');
  });
});

describe('render — stale and invalid-presence diagnostics', () => {
  it('stale unicode renders Peaks ! peaks-code stale 25h > peaks-loop', () => {
    const presence = presenceOf('peaks-code');
    const ageMs = 25 * 60 * 60 * 1000; // 25h
    const out = renderStatusLine(staleModel(presence, ageMs), { capability: 'unicode' });
    // Brief: stale and invalid-presence are diagnostic states. They keep
    // the warning glyph and the technical suffix; they do NOT collapse to
    // the active rendering.
    expect(out).toBe('Peaks ! peaks-code · stale 25h › peaks-loop');
  });

  it('invalid-presence unicode renders Peaks ! presence unreadable › peaks-loop', () => {
    const out = renderStatusLine(invalidModel(), { capability: 'unicode' });
    expect(out).toBe('Peaks ! presence unreadable › peaks-loop');
  });

  it('stale ascii mirrors the unicode layout with ASCII glyphs', () => {
    const presence = presenceOf('peaks-code');
    const ageMs = 25 * 60 * 60 * 1000;
    const out = renderStatusLine(staleModel(presence, ageMs), { capability: 'ascii' });
    expect(out).toBe('Peaks ! peaks-code . stale 25h > peaks-loop');
  });
});

describe('behavior — attention-gate classification', () => {
  it('routine gate (startup) does NOT appear in the rendered output', () => {
    const presence = presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' });
    const out = renderStatusLine(activeModel(presence), { capability: 'unicode' });
    // Brief: "prove neither appears" — neither `mode:assisted` nor `gate:startup`.
    expect(out).not.toContain('assisted');
    expect(out).not.toContain('startup');
    expect(out).not.toContain('mode:');
    expect(out).not.toContain('gate:');
    expect(out).toBe('Peaks ● peaks-code › peaks-loop');
  });

  it('attention-gate classification surfaces warning glyph with the human-readable gate label', () => {
    const presence = presenceOf('peaks-code', { gate: 'qa-validation' });
    const out = renderStatusLine(activeModel(presence), { capability: 'unicode' });
    expect(out).toBe('Peaks ! peaks-code · QA › peaks-loop');
  });

  it('ascii capability also surfaces attention gate with ASCII glyphs', () => {
    const presence = presenceOf('peaks-code', { gate: 'qa-validation' });
    const out = renderStatusLine(activeModel(presence), { capability: 'ascii' });
    expect(out).toBe('Peaks ! peaks-code . QA > peaks-loop');
  });
});

describe('behavior — defaults and capability boundaries', () => {
  it('default capability is unicode (no ANSI emitted when options omitted)', () => {
    const model = activeModel(presenceOf('peaks-code'));
    const out = renderStatusLine(model);
    expect(out).not.toContain('\x1b[');
    expect(out).toBe('Peaks ● peaks-code › peaks-loop');
  });

  it('covers every capability literal at runtime', () => {
    const allCaps: StatusLineCapability[] = ['ansi-unicode', 'unicode', 'ascii'];
    for (const cap of allCaps) {
      const model = activeModel(presenceOf('peaks-code'));
      const out = renderStatusLine(model, { capability: cap });
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('idle without projectRoot renders without the › suffix', () => {
    const model = idleModel(null);
    expect(renderStatusLine(model, { capability: 'unicode' })).toBe('Peaks ○ idle');
    expect(renderStatusLine(model, { capability: 'ascii' })).toBe('Peaks o idle');
  });

  it('options object is structurally accepted for every capability', () => {
    const opts: StatusLineRenderOptions = { capability: 'unicode' };
    const optsAscii: StatusLineRenderOptions = { capability: 'ascii' };
    const optsAnsi: StatusLineRenderOptions = { capability: 'ansi-unicode' };
    expect(opts.capability).toBe('unicode');
    expect(optsAscii.capability).toBe('ascii');
    expect(optsAnsi.capability).toBe('ansi-unicode');
  });
});

describe('a11y — output hygiene and forbidden glyphs', () => {
  it('unicode output is single-line', () => {
    const model = activeModel(presenceOf('peaks-code'));
    const out = renderStatusLine(model, { capability: 'unicode' });
    expect(out).not.toMatch(/\n/);
  });

  it('output never contains the legacy mountain glyphs', () => {
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

  it('output never contains a CLI verb (peaks <verb>) or mode/gate colon labels', () => {
    const model = activeModel(presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' }));
    const out = renderStatusLine(model, { capability: 'unicode' });
    // Brief: forbid `peaks <verb>` (with verb shape) and colon-gated tokens.
    // `peaks-loop` is the project basename; we explicitly allow that.
    expect(out).not.toMatch(/\bpeaks\s+[a-z][a-z0-9-]*\b/);
    expect(out).not.toContain('mode:');
    expect(out).not.toContain('gate:');
  });

  it('rendered string never balloons beyond the small model surface', () => {
    const model = activeModel(presenceOf('peaks-code', { mode: 'assisted', gate: 'startup' }));
    const out = renderStatusLine(model, { capability: 'unicode' });
    // 64 chars is a generous upper bound for the documented render.
    expect(out.length).toBeLessThanOrEqual(64);
  });
});