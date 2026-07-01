/**
 * Strategic-compact decision tables — unit tests.
 *
 * Pins the byte-for-byte SKILL.md table content so the
 * `peaks compact recommend` and `peaks compact survival` primitives
 * don't drift from the upstream ECC reference.
 */
import { describe, expect, it } from 'vitest';
import {
  PHASE_TRANSITIONS,
  PHASES,
  SURVIVAL_TABLE,
  buildSuggestedCompactMessage,
  isPhase,
  lookupPhaseTransition
} from '../../../../src/services/compact/decision-tables.js';

describe('PHASES', () => {
  it('lists the 5 documented phases', () => {
    expect([...PHASES]).toEqual([
      'research',
      'planning',
      'implementation',
      'testing',
      'debugging'
    ]);
  });
});

describe('isPhase', () => {
  it('accepts each documented phase', () => {
    for (const p of PHASES) {
      expect(isPhase(p)).toBe(true);
    }
  });
  it('rejects unknown strings', () => {
    expect(isPhase('unknown')).toBe(false);
    expect(isPhase('')).toBe(false);
  });
});

describe('PHASE_TRANSITIONS table', () => {
  it('contains the 4 documented yes/maybe rows', () => {
    expect([...PHASE_TRANSITIONS]).toEqual([
      {
        from: 'research',
        to: 'planning',
        severity: 'yes',
        rationale: 'Research context is bulky; plan is the distilled output'
      },
      {
        from: 'planning',
        to: 'implementation',
        severity: 'yes',
        rationale: 'Plan is in TodoWrite or a file; free up context for code'
      },
      {
        from: 'implementation',
        to: 'testing',
        severity: 'maybe',
        rationale: 'Keep if tests reference recent code; compact if switching focus'
      },
      {
        from: 'debugging',
        to: 'implementation',
        severity: 'yes',
        rationale: 'Debug traces pollute context for unrelated work'
      }
    ]);
  });
});

describe('SURVIVAL_TABLE', () => {
  it('persists list matches SKILL.md byte-for-byte', () => {
    expect([...SURVIVAL_TABLE.persists]).toEqual([
      'CLAUDE.md instructions',
      'TodoWrite task list',
      'Memory files (~/.claude/memory/)',
      'Git state (commits, branches)',
      'Files on disk'
    ]);
  });
  it('lost list matches SKILL.md byte-for-byte', () => {
    expect([...SURVIVAL_TABLE.lost]).toEqual([
      'Intermediate reasoning and analysis',
      'File contents you previously read',
      'Multi-step conversation context',
      'Tool call history and counts',
      'Nuanced user preferences stated verbally'
    ]);
  });
});

describe('lookupPhaseTransition', () => {
  it('returns yes for research->planning', () => {
    const out = lookupPhaseTransition('research', 'planning');
    expect(out.severity).toBe('yes');
    expect(out.notInTable).toBe(false);
  });
  it('returns maybe for implementation->testing', () => {
    const out = lookupPhaseTransition('implementation', 'testing');
    expect(out.severity).toBe('maybe');
  });
  it('returns no with notInTable=true for unknown pairs', () => {
    const out = lookupPhaseTransition('research', 'testing');
    expect(out.severity).toBe('no');
    expect(out.notInTable).toBe(true);
  });
});

describe('buildSuggestedCompactMessage', () => {
  it('emits /compact Focus on <to> for severity=yes', () => {
    expect(buildSuggestedCompactMessage('research', 'planning', 'yes')).toMatch(
      /^\/compact Focus on planning:/
    );
  });
  it('emits /compact Focus on completing <to> for severity=maybe', () => {
    expect(buildSuggestedCompactMessage('implementation', 'testing', 'maybe')).toMatch(
      /^\/compact Focus on completing testing/
    );
  });
  it('emits /compact Preserve context for severity=no', () => {
    expect(buildSuggestedCompactMessage('research', 'research', 'no')).toMatch(
      /^\/compact Preserve context/
    );
  });
});
