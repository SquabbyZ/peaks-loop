// tests/unit/skills/presence-gate.test.ts
//
// Slice 2026-10-24 — rid-t3-presence-cross-session-test-split.
//
// This file holds the GATE CONTRACT, and the gate contract is pure:
// `normalizePresenceGate` (write side) and `readPresenceGate` (read side)
// take a value and return a value. Nothing here touches the disk, the clock,
// the environment or the process exit code.
//
// So this file deliberately carries NO fixture: no scratch directory is
// created, no file is written, no environment variable is read or changed.
// The 6 tests below used to share one scratch workspace per test with 11
// disk-backed tests that they have nothing to do with.
//
// WHAT IT GUARDS. The `Peaks-Loop Gate: <gate>` cell of the status header is
// a machine fact, not model-invented prose. The gate is trimmed and accepted
// verbatim, dropped when absent or blank, refused when it carries a control
// character or exceeds the length bound, and every gate value this
// repository uses survives normalisation. The read side tolerates a
// hand-edited or older lease and reports "no gate" instead of throwing.
//
// SIBLINGS. The pure lease-selection rules live in
// `tests/unit/skills/presence-lease-selection.test.ts`; the disk-backed
// integration / render / a11y scenarios live in
// `tests/unit/skills/presence-cross-session.test.ts`.
//
// Dimensions: behavior only — render, integration and a11y are omitted with
// a one-line reason each in the `declareDimensions` call below.
//
// Run with: pnpm vitest run tests/unit/skills/presence-gate.test.ts

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  KNOWN_PRESENCE_GATES,
  MAX_PRESENCE_GATE_LENGTH,
  normalizePresenceGate,
  readPresenceGate
} from '../../../src/services/skills/presence-gate.js';

declareDimensions(
  'tests/unit/skills/presence-gate.test.ts',
  ['behavior'],
  [
    {
      dim: 'render',
      reason:
        'the gate contract returns values, not output text; the `--json` envelope is covered by the cross-session file.'
    },
    {
      dim: 'integration',
      reason:
        'no filesystem, process or clock boundary is exercised here; the disk-backed scenarios live in the cross-session file.'
    },
    {
      dim: 'a11y',
      reason:
        'the contract throws typed errors instead of producing human-facing text; the plain-language refusal lives in the cross-session file.'
    }
  ]
);

/* ---------- behavior: the gate contract ---------- */
describe('Scenario: behavior — the gate contract', () => {
  it('when a gate value is well formed, should accept it verbatim (trimmed)', () => {
    // given: a well-formed gate value
    // when: the gate is normalised
    // then: the gate is accepted verbatim, trimmed
    expect(normalizePresenceGate('startup')).toBe('startup');
    expect(normalizePresenceGate('  swarm-fan-out  ')).toBe('swarm-fan-out');
  });

  it('when a gate value is absent or empty, should drop it rather than persist an empty string', () => {
    // given: an absent, null or blank gate value
    // when: the gate is normalised
    // then: no gate value is produced
    expect(normalizePresenceGate(undefined)).toBeUndefined();
    expect(normalizePresenceGate(null)).toBeUndefined();
    expect(normalizePresenceGate('   ')).toBeUndefined();
  });

  it('when a gate value is unknown, should accept it — the vocabulary is open', () => {
    // given: a gate value this repository has never seen
    // when: the gate is normalised
    // then: the unknown gate is accepted, because the vocabulary is open
    expect(normalizePresenceGate('a-gate-nobody-predicted')).toBe('a-gate-nobody-predicted');
  });

  it('when a gate value carries a control character or is too long, should reject it', () => {
    // given: a gate value carrying a control character or longer than the maximum
    // when: the gate is normalised
    // then: the gate value is rejected
    expect(() => normalizePresenceGate('bad\u0001gate')).toThrow();
    expect(() => normalizePresenceGate('x'.repeat(MAX_PRESENCE_GATE_LENGTH + 1))).toThrow();
  });

  it('when every gate value this repository uses is checked, should accept all of them', () => {
    // given: every gate value this repository uses
    // when: each one is normalised
    // then: every gate is accepted unchanged
    for (const gate of KNOWN_PRESENCE_GATES) {
      expect(normalizePresenceGate(gate)).toBe(gate);
    }
  });

  it('when a stored gate is read back, should tolerate a missing or non-string value', () => {
    // given: a stored gate that is missing, not a string or empty
    // when: the stored gate is read back
    // then: no gate value is produced for the bad entries
    expect(readPresenceGate('startup')).toBe('startup');
    expect(readPresenceGate(undefined)).toBeUndefined();
    expect(readPresenceGate(42)).toBeUndefined();
    expect(readPresenceGate('')).toBeUndefined();
  });
});
