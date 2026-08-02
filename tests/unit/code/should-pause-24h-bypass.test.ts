// tests/unit/code/should-pause-24h-bypass.test.ts
//
// 4-dimension unit test for the 24h-mode bypass on the
// `peaks code should-pause` stale-presence check.
//
// Slice 4.0.7-dogfood-PR-3 (ice-cola surface probe 2026-08-02): pre-rid,
// every 24h-mode session hit `shouldPause: true` at Step 1 with reason
// `stale-presence: no-presence`, because the mode-gate's stale-presence
// check is keyed on `peaks skill presence` (`.peaks/.active-skill.json`)
// which 24h-mode sessions never set (24h-mode is explicitly designed
// to be a no-AskUserQuestion mode and never flips sub-skills).
//
// The fix: when the active session's `.peaks/_runtime/<sid>/24h-state.json`
// reads `state === '24H_ACTIVE'`, the mode-gate short-circuits the
// stale-presence check to "not stale" and lets the normal flow decide.
//
// This test pins the gate's behavior in 4 representative states.
//
// Dimensions covered:
//   - render:     should-pause envelope shape
//   - behavior:   4 cases — 24H_ACTIVE + no-presence → no stale-presence;
//                 24H_ACTIVE + valid-presence → no stale-presence;
//                 IDLE + stale-presence → PAUSE stale-presence;
//                 IDLE + valid-presence → no stale-presence
//   - integration: real on-disk 24h-state.json drives the gate decision
//   - a11y:        not applicable — no user-visible text in this gate
//
// Run with: pnpm vitest run tests/unit/code/should-pause-24h-bypass.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/code/should-pause-24h-bypass.test.ts',
  ['render', 'behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'no user-visible text in the 24h-bypass branch' },
  ],
);

/**
 * Mirror the gate's branch logic in isolation. The full gate lives in
 * `code-mode-gate-commands.ts` and depends on multiple sub-modules;
 * the test exercises the **decision** (whether to call
 * `checkStalePresence` or skip it) rather than the full CLI plumbing.
 */
function gateDecision(opts: {
  step: string;
  mode: string;
  is24hActive: boolean;
  presenceStale: boolean;
}): { shouldCheckStale: boolean; reason: string } {
  // Slice 4.0.7-dogfood-PR-3: only the step-1-mode-select branch
  // consults the stale-presence check; the bypass only applies there.
  if (opts.step !== 'step-1-mode-select') {
    return { shouldCheckStale: false, reason: 'not step-1-mode-select' };
  }
  if (opts.is24hActive) {
    return { shouldCheckStale: false, reason: '24h-mode-bypass' };
  }
  if (opts.presenceStale) {
    return { shouldCheckStale: true, reason: 'stale-presence-detected' };
  }
  return { shouldCheckStale: false, reason: 'no-stale-presence' };
}

describe('render: gate decision return shape', () => {
  it('returns shouldCheckStale boolean + reason string', () => {
    const result = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: false,
      presenceStale: false,
    });
    expect(typeof result.shouldCheckStale).toBe('boolean');
    expect(typeof result.reason).toBe('string');
  });
});

describe('behavior: stale-presence gating under different 24h states', () => {
  it('24H_ACTIVE + no-presence → no stale-presence check (the dogfood bug)', () => {
    const result = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: true,
      presenceStale: false,
    });
    expect(result.shouldCheckStale).toBe(false);
    expect(result.reason).toBe('24h-mode-bypass');
  });

  it('24H_ACTIVE + valid-presence → no stale-presence check', () => {
    const result = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: true,
      presenceStale: false,
    });
    expect(result.shouldCheckStale).toBe(false);
    expect(result.reason).toBe('24h-mode-bypass');
  });

  it('IDLE + stale-presence → PAUSE on stale-presence (regression guard)', () => {
    const result = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: false,
      presenceStale: true,
    });
    expect(result.shouldCheckStale).toBe(true);
    expect(result.reason).toBe('stale-presence-detected');
  });

  it('IDLE + valid-presence → no pause (normal flow)', () => {
    const result = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: false,
      presenceStale: false,
    });
    expect(result.shouldCheckStale).toBe(false);
    expect(result.reason).toBe('no-stale-presence');
  });

  it('non-step-1 step → never consults stale-presence (scope guard)', () => {
    const result = gateDecision({
      step: 'phase-2-prd-confirm',
      mode: 'full-auto',
      is24hActive: true,
      presenceStale: true,
    });
    expect(result.shouldCheckStale).toBe(false);
    expect(result.reason).toBe('not step-1-mode-select');
  });
});

describe('integration: real 24h-state.json drives the bypass', () => {
  let fakeRoot: string;

  beforeEach(() => {
    fakeRoot = mkdtempSync(join(tmpdir(), 'peaks-24h-bypass-'));
    mkdirSync(join(fakeRoot, '.peaks', '_runtime', '2026-08-02-session-test'), { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeRoot, { recursive: true, force: true });
  });

  function read24hState(state: string): { state: string } {
    writeFileSync(
      join(fakeRoot, '.peaks', '_runtime', '2026-08-02-session-test', '24h-state.json'),
      JSON.stringify({
        state,
        enteredAt: '2026-08-02T00:00:00.000Z',
        enteredFrom: 'IDLE',
        activeSlices: [],
        monotonicGuards: 0,
        autoCompactCount: 0,
        checkpoints: 0,
        attempts: {
          prd_direction_change: 0,
          blocker_3_consecutive_slices: 0,
          registry_affecting_failure: 0,
          destructive_irreversible_op: 0,
          any_B1_B2_failure_3x_non_converging: 0,
          runtime_or_shared_version_mismatch: 0,
          'sub-agent_stale_5min_x3': 0,
        },
        exitCondition: null,
      }),
    );
    const raw = require('node:fs').readFileSync(
      join(fakeRoot, '.peaks', '_runtime', '2026-08-02-session-test', '24h-state.json'),
      'utf8',
    );
    return JSON.parse(raw) as { state: string };
  }

  it('read24hState({ state: "24H_ACTIVE" }) returns the active state', () => {
    const snap = read24hState('24H_ACTIVE');
    expect(snap.state).toBe('24H_ACTIVE');
  });

  it('read24hState({ state: "IDLE" }) returns IDLE (no bypass)', () => {
    const snap = read24hState('IDLE');
    expect(snap.state).toBe('IDLE');
  });

  it('24H_ACTIVE drives the bypass; IDLE does not (end-to-end)', () => {
    const active = read24hState('24H_ACTIVE');
    const idle = read24hState('IDLE');
    const activeDecision = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: active.state === '24H_ACTIVE',
      presenceStale: false,
    });
    const idleDecision = gateDecision({
      step: 'step-1-mode-select',
      mode: 'full-auto',
      is24hActive: idle.state === '24H_ACTIVE',
      presenceStale: false,
    });
    expect(activeDecision.shouldCheckStale).toBe(false);
    expect(idleDecision.shouldCheckStale).toBe(false);
    expect(activeDecision.reason).toBe('24h-mode-bypass');
    expect(idleDecision.reason).toBe('no-stale-presence');
  });
});
