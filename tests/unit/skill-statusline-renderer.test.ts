import { describe, expect, test } from 'vitest';
import { renderStatusLine } from '../../src/services/skills/skill-statusline-renderer.js';
import type { StatusLineModel } from '../../src/services/skills/skill-statusline-service.js';

const BRAND = '⛰ Peaks';

function model(overrides: Partial<StatusLineModel>): StatusLineModel {
  return {
    state: 'idle',
    projectRoot: '/home/dev/myapp',
    presence: null,
    ageMs: null,
    ...overrides
  };
}

describe('renderStatusLine', () => {
  test('active: shows brand, filled glyph, skill, mode, gate and repo basename', () => {
    const line = renderStatusLine(model({
      state: 'active',
      presence: { skill: 'peaks-solo', mode: 'full-auto', gate: 'rd-dry-run' }
    }));

    expect(line).toBe(`${BRAND} ● peaks-solo · full-auto · gate:rd-dry-run · myapp`);
  });

  test('active: omits mode and gate when absent', () => {
    const line = renderStatusLine(model({
      state: 'active',
      presence: { skill: 'peaks-rd' }
    }));

    expect(line).toBe(`${BRAND} ● peaks-rd · myapp`);
  });

  test('idle: shows hollow glyph and no skill', () => {
    const line = renderStatusLine(model({ state: 'idle', presence: null }));

    expect(line).toBe(`${BRAND} ○ idle · myapp`);
  });

  test('stale: shows warning glyph, skill and age', () => {
    const line = renderStatusLine(model({
      state: 'stale',
      presence: { skill: 'peaks-qa', mode: 'strict' },
      ageMs: 3 * 60 * 60 * 1000
    }));

    expect(line).toBe(`${BRAND} ⚠ peaks-qa · stale 3h · myapp`);
  });

  test('stale: falls back to "unknown" skill when presence missing', () => {
    const line = renderStatusLine(model({ state: 'stale', presence: null, ageMs: null }));

    expect(line).toBe(`${BRAND} ⚠ unknown · myapp`);
  });

  test('invalid-presence: shows an explicit unreadable warning', () => {
    const line = renderStatusLine(model({ state: 'invalid-presence', presence: null }));

    expect(line).toBe(`${BRAND} ⚠ presence file unreadable · myapp`);
  });

  test('omits the repo suffix when there is no project root', () => {
    const line = renderStatusLine(model({ state: 'idle', projectRoot: null, presence: null }));

    expect(line).toBe(`${BRAND} ○ idle`);
  });

  test('stale rounds sub-hour ages to minutes with a floor of 1m', () => {
    const line = renderStatusLine(model({
      state: 'stale',
      presence: { skill: 'peaks-ui' },
      ageMs: 30 * 1000
    }));

    expect(line).toBe(`${BRAND} ⚠ peaks-ui · stale 1m · myapp`);
  });
});
