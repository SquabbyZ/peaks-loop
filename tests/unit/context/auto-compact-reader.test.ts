// tests/unit/context/auto-compact-reader.test.ts
//
// 4-dimension unit test for src/services/context/auto-compact-reader.ts.
//
// Slice 2026-09-02-vendor-neutral-context-probe: the generic reader no longer
// hard-codes Claude Code's statusline / transcript paths. It reads the
// adapter-declared env-var first, then delegates any vendor-specific fallback
// to `IdeCompactProfile.readContextPercentFallback`. This file pins the generic
// resolution order (user-overridden → env-var → adapter fallback →
// conservative-fallback) using controllable fake adapters via the registry test
// seam (`_setAdapterForTesting` / `_resetAdaptersForTesting`).
//
// The Claude-specific statusline + transcript cases moved to
// tests/unit/ide/claude-code-adapter-compact.test.ts.
//
// Dimensions covered:
//   - render:      ContextPercentProbe shape + source string per branch
//   - behavior:    promptSizeBytes P0, env-var primary, adapter-fallback
//                  delegation, conservative-fallback when adapter has no fallback
//   - integration: registry test seam (real `getAdapter` lookup path)
//   - a11y:        not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/context/auto-compact-reader.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting
} from '~/src/services/ide/ide-registry';
import { CLAUDE_CODE_ADAPTER } from '~/src/services/ide/adapters/claude-code-adapter';
import type { IdeAdapter } from '~/src/services/ide/ide-types';
import { readContextPercent } from '~/src/services/context/auto-compact-reader';

declareDimensions(
  'tests/unit/context/auto-compact-reader.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'pure env/adapter probe; no user-visible text emitted' }],
);

const SID = '2026-07-31-mac-rid-001';

/** A claude-code-shaped adapter with an env-var but NO fallback hook. */
function noFallbackAdapter(): IdeAdapter {
  return {
    ...CLAUDE_CODE_ADAPTER,
    compact: {
      envVarForContextPercent: 'PEAKS_TEST_CONTEXT_PCT',
      compactCommand: 'claude --compact',
      compactPathway: 'ide-native'
    }
  };
}

beforeEach(() => {
  _resetAdaptersForTesting();
});

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('Scenario: render — readContextPercent conservative-fallback shape', () => {
  it('when adapter has no fallback, should return ratio:0 + source:conservative-fallback', () => {
    _setAdapterForTesting('claude-code', noFallbackAdapter());
    const out = readContextPercent({ projectRoot: '/tmp/peaks-test', sessionId: SID, env: {} });
    expect(typeof out.capturedAt).toBe('string');
    expect(out.capturedAt.length).toBeGreaterThan(0);
    expect(out.source).toBe('conservative-fallback');
    expect(out.ratio).toBe(0);
    expect(out.ide).toBe('claude-code');
  });
});

describe('Scenario: behavior — env-var primary (adapter-declared)', () => {
  it('when env carries the adapter env-var, should return source <ide>-env', () => {
    const out = readContextPercent({
      projectRoot: '/tmp/peaks-test',
      sessionId: SID,
      env: { CLAUDE_CONTEXT_USAGE_PERCENT: '0.62' }
    });
    expect(out.source).toBe('claude-code-env');
    expect(out.ratio).toBeCloseTo(0.62);
    expect(out.ide).toBe('claude-code');
  });
});

describe('Scenario: behavior — adapter fallback delegation (vendor-neutral)', () => {
  it('when adapter.compact.readContextPercentFallback returns a probe, should return it (not hardcoded)', () => {
    _setAdapterForTesting('claude-code', {
      ...CLAUDE_CODE_ADAPTER,
      compact: {
        envVarForContextPercent: 'PEAKS_TEST_CONTEXT_PCT',
        compactCommand: 'claude --compact',
        compactPathway: 'ide-native',
        readContextPercentFallback: () => ({
          ratio: 0.5,
          source: 'adapter-fallback-probe',
          ide: 'claude-code',
          capturedAt: '2026-01-01T00:00:00.000Z'
        })
      }
    });
    const out = readContextPercent({ projectRoot: '/tmp/peaks-test', sessionId: SID, env: {} });
    expect(out.source).toBe('adapter-fallback-probe');
    expect(out.ratio).toBe(0.5);
  });

  it('when adapter has no readContextPercentFallback, should fall through to conservative-fallback', () => {
    _setAdapterForTesting('claude-code', noFallbackAdapter());
    const out = readContextPercent({ projectRoot: '/tmp/peaks-test', sessionId: SID, env: {} });
    expect(out.source).toBe('conservative-fallback');
    expect(out.ratio).toBe(0);
  });
});

// Slice 2026-07-31-rid-002-prompt-size-context-now-override — `promptSizeBytes`
// P0 short-circuit. Mac users (and any IDE wrapper) inject context bytes
// explicitly via `peaks code context-now --prompt-size <bytes>` to bypass the
// silent `CLAUDE_CONTEXT_USAGE_PERCENT` failure mode. The reader must honor
// `--prompt-size` ABOVE every other source: env / fallback / conservative.
describe('Scenario: behavior — readContextPercent promptSizeBytes P0 short-circuit', () => {
  it('when promptSizeBytes=200000, should short-circuit to user-overridden ratio ~0.762', () => {
    const out = readContextPercent({
      projectRoot: '/tmp/peaks-test',
      sessionId: SID,
      env: {},
      promptSizeBytes: 200_000
    });
    expect(out.source).toBe('user-overridden');
    expect(out.ratio).toBeCloseTo(200_000 / (256 * 1024), 5);
    expect(out.rawBytes).toBe(200_000);
    expect(out.capacityBytes).toBe(256 * 1024);
  });

  it('when promptSizeBytes=0, should return ratio 0 with source user-overridden', () => {
    const out = readContextPercent({
      projectRoot: '/tmp/peaks-test',
      sessionId: SID,
      env: {},
      promptSizeBytes: 0
    });
    expect(out.source).toBe('user-overridden');
    expect(out.ratio).toBe(0);
    expect(out.rawBytes).toBe(0);
  });

  it('when promptSizeBytes=-1, should be rejected and fall through to conservative-fallback', () => {
    _setAdapterForTesting('claude-code', noFallbackAdapter());
    const out = readContextPercent({
      projectRoot: '/tmp/peaks-test',
      sessionId: SID,
      env: {},
      promptSizeBytes: -1
    });
    expect(out.source).not.toBe('user-overridden');
    expect(out.source).toBe('conservative-fallback');
  });

  it('when promptSizeBytes=undefined, should preserve backward-compat (no implicit override)', () => {
    _setAdapterForTesting('claude-code', noFallbackAdapter());
    const out = readContextPercent({
      projectRoot: '/tmp/peaks-test',
      sessionId: SID,
      env: {}
    });
    expect(out.source).not.toBe('user-overridden');
    expect(out.source).toBe('conservative-fallback');
  });
});
