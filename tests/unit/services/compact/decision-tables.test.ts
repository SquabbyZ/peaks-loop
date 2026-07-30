// tests/unit/services/compact/decision-tables.test.ts
//
// 4-dimension unit test for the strategic-compact decision tables in
// src/services/compact/decision-tables.ts. The module is a pure
// data + lookup helper (no I/O) that backs `peaks compact
// recommend` / `peaks compact survival` / `peaks compact dry-run`.
//
// Why pin it: the byte-for-byte text mirrors the upstream ECC
// strategic-compact SKILL.md table. A drift in either direction
// (production drifts from skill, or this test drifts from
// production) silently breaks the LLM's compact recommendations.
// The test re-asserts the documented table shape so any future
// refactor has to be deliberate.
//
// Dimensions covered:
//   - render:    the 4 PHASE_TRANSITIONS rows + the 2 NO rows +
//                the 5+5 SURVIVAL_TABLE entries
//   - behavior:  lookupPhaseTransition direct / no-row / unknown
//                returns; buildSuggestedCompactMessage 3-severity
//                phrasing
//   - a11y:      buildSuggestedCompactMessage text is human-readable
//                imperative English, never a stack trace
//   - integration: not applicable (pure module)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/compact/decision-tables.test.ts',
  ['render', 'behavior', 'a11y'],
  [{ dim: 'integration', reason: 'pure data + lookup, no fs/clock/env' }],
);

import {
  PHASES,
  PHASE_TRANSITIONS,
  PHASE_NO_TRANSITIONS,
  SURVIVAL_TABLE,
  buildSuggestedCompactMessage,
  isPhase,
  lookupPhaseTransition,
  type Phase,
  type Severity,
} from '~/src/services/compact/decision-tables';

describe('render — PHASES + isPhase', () => {
  it('PHASES lists the 5 documented phases in order', () => {
    expect(PHASES).toEqual([
      'research',
      'planning',
      'implementation',
      'testing',
      'debugging',
    ]);
  });

  it('isPhase accepts each documented phase and rejects anything else', () => {
    for (const p of PHASES) {
      expect(isPhase(p)).toBe(true);
    }
    expect(isPhase('not-a-phase')).toBe(false);
    expect(isPhase('')).toBe(false);
    expect(isPhase('Research')).toBe(false); // case-sensitive
  });
});

describe('render — PHASE_TRANSITIONS table shape', () => {
  it('has exactly 4 documented yes/maybe rows', () => {
    expect(PHASE_TRANSITIONS).toHaveLength(4);
  });

  it('each row carries from/to/severity/rationale as strings', () => {
    for (const row of PHASE_TRANSITIONS) {
      expect(typeof row.from).toBe('string');
      expect(typeof row.to).toBe('string');
      expect(['yes', 'maybe', 'no']).toContain(row.severity);
      expect(row.rationale.length).toBeGreaterThan(0);
    }
  });

  it('research→planning, planning→implementation, debugging→implementation are severity=yes', () => {
    const r2p = PHASE_TRANSITIONS.find((r) => r.from === 'research' && r.to === 'planning');
    const p2i = PHASE_TRANSITIONS.find((r) => r.from === 'planning' && r.to === 'implementation');
    const d2i = PHASE_TRANSITIONS.find((r) => r.from === 'debugging' && r.to === 'implementation');
    expect(r2p?.severity).toBe<Severity>('yes');
    expect(p2i?.severity).toBe<Severity>('yes');
    expect(d2i?.severity).toBe<Severity>('yes');
  });

  it('implementation→testing is severity=maybe', () => {
    const i2t = PHASE_TRANSITIONS.find((r) => r.from === 'implementation' && r.to === 'testing');
    expect(i2t?.severity).toBe<Severity>('maybe');
  });
});

describe('render — PHASE_NO_TRANSITIONS + SURVIVAL_TABLE shape', () => {
  it('PHASE_NO_TRANSITIONS has 2 documented no rows', () => {
    expect(PHASE_NO_TRANSITIONS).toHaveLength(2);
  });

  it('implementation→implementation and debugging→debugging are the only no-rows', () => {
    const pairs = PHASE_NO_TRANSITIONS.map((r) => `${r.from}->${r.to}`);
    expect(pairs.sort()).toEqual(['debugging->debugging', 'implementation->implementation']);
  });

  it('SURVIVAL_TABLE.persists has 5 documented items', () => {
    expect(SURVIVAL_TABLE.persists).toHaveLength(5);
    expect(SURVIVAL_TABLE.persists).toContain('CLAUDE.md instructions');
    expect(SURVIVAL_TABLE.persists).toContain('TodoWrite task list');
    expect(SURVIVAL_TABLE.persists).toContain('Files on disk');
  });

  it('SURVIVAL_TABLE.lost has 5 documented items', () => {
    expect(SURVIVAL_TABLE.lost).toHaveLength(5);
    expect(SURVIVAL_TABLE.lost).toContain('Intermediate reasoning and analysis');
    expect(SURVIVAL_TABLE.lost).toContain('Tool call history and counts');
  });
});

describe('behavior — lookupPhaseTransition', () => {
  it('direct hit on a yes-row returns severity + rationale + notInTable=false', () => {
    const out = lookupPhaseTransition('research', 'planning');
    expect(out.severity).toBe<Severity>('yes');
    expect(out.rationale).toMatch(/Research context is bulky/);
    expect(out.notInTable).toBe(false);
  });

  it('direct hit on a no-row returns severity=no + the no-row rationale + notInTable=false', () => {
    const out = lookupPhaseTransition('implementation', 'implementation');
    expect(out.severity).toBe<Severity>('no');
    expect(out.rationale).toMatch(/Mid-implementation/);
    expect(out.notInTable).toBe(false);
  });

  it('unknown pair returns severity=no + default rationale + notInTable=true', () => {
    const out = lookupPhaseTransition('testing', 'implementation');
    expect(out.severity).toBe<Severity>('no');
    expect(out.notInTable).toBe(true);
    expect(out.rationale).toMatch(/No documented transition/);
  });

  it('the default-rationale branch is taken when neither PHASE_TRANSITIONS nor PHASE_NO_TRANSITIONS match', () => {
    // Pick a from/to pair that is not in either table.
    const out = lookupPhaseTransition('research', 'testing');
    expect(out.notInTable).toBe(true);
  });
});

describe('behavior — buildSuggestedCompactMessage', () => {
  it('severity=yes: imperative /compact Focus on <to>', () => {
    const msg = buildSuggestedCompactMessage('research', 'planning', 'yes');
    expect(msg).toMatch(/^\/compact Focus on planning:/);
    expect(msg).toMatch(/research context has been distilled/);
  });

  it('severity=maybe: imperative /compact Focus on completing <to>', () => {
    const msg = buildSuggestedCompactMessage('implementation', 'testing', 'maybe');
    expect(msg).toMatch(/^\/compact Focus on completing testing/);
    expect(msg).toMatch(/preserve recent code references/);
  });

  it('severity=no: imperative /compact Preserve context for ongoing <from>', () => {
    const msg = buildSuggestedCompactMessage('implementation', 'implementation', 'no');
    expect(msg).toMatch(/^\/compact Preserve context for ongoing implementation/);
    expect(msg).toMatch(/do not abandon in-flight state/);
  });
});

describe('a11y — message surface', () => {
  it('every severity produces a single-line, English, imperative message', () => {
    const sevs: Severity[] = ['yes', 'maybe', 'no'];
    for (const s of sevs) {
      const msg = buildSuggestedCompactMessage('research', 'planning', s);
      expect(msg).toMatch(/^\/compact /);
      expect(msg).not.toMatch(/\n/); // single line
      expect(msg).not.toMatch(/at .+:\d+/);
      // The body after '/compact ' starts with a capital letter.
      expect(msg).toMatch(/^\/compact [A-Z]/);
    }
  });

  it('rationale text in PHASE_TRANSITIONS is human-readable prose (no code-style placeholders)', () => {
    for (const row of PHASE_TRANSITIONS) {
      // Pin that no row has an unfilled <placeholder> or {{mustache}}.
      expect(row.rationale).not.toMatch(/<[a-z]+>/i);
      expect(row.rationale).not.toMatch(/\{\{.*\}\}/);
    }
  });
});
