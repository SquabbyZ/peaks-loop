import { describe, expect, it } from 'vitest';
import { buildContextVerdict } from '../../../src/cli/commands/core/skill-command.js';

/**
 * The zero-pause contract must reach the model on EVERY turn, in EVERY
 * mode, from EVERY skill. It is carried in the `skill.presence` envelope
 * rather than only in a SKILL.md body, because a SKILL.md body is loaded
 * once and then compacted away — which is precisely how the contract was
 * violated with the rule sitting in context.
 *
 * These cases pin the two things that make the carrier work:
 *   1. in-zone ratios must tell the model to compact ITSELF, never to
 *      hand the step to the user;
 *   2. the mode moves the THRESHOLD, not the OBLIGATION — an obligation
 *      that only fires in 24h mode is not the contract.
 */
describe('skill.presence loop-hygiene verdict', () => {
  it('stays silent below the auto-fire line, so every turn is not noisy', () => {
    const v = buildContextVerdict(0.1, 'standard');
    expect(v.context.action).toBe('none');
    expect(v.nextActions).toEqual([]);
  });

  it('tells the model to run auto-compact ITSELF when in the pre-compact zone', () => {
    const v = buildContextVerdict(0.9, 'standard');
    expect(v.context.action).toBe('pre-compact');
    expect(v.nextActions.join('\n')).toContain('peaks code auto-compact --project .');
  });

  it('never routes the step to the user — the regression phrase is banned', () => {
    for (const ratio of [0.82, 0.9, 0.96]) {
      const text = buildContextVerdict(ratio, 'standard').nextActions.join('\n').toLowerCase();
      expect(text).not.toContain('ask the user to compact');
      expect(text).not.toContain('prompt the user to run');
      expect(text).not.toContain('user should run');
    }
  });

  it('fires at the partial-mode threshold when 24h mode is active', () => {
    // partial.autoFire = 0.65
    expect(buildContextVerdict(0.7, 'partial').context.action).not.toBe('none');
    expect(buildContextVerdict(0.7, 'partial').nextActions.length).toBeGreaterThan(0);
  });

  it('holds the SAME obligation in standard mode, just at a later threshold', () => {
    // The complaint this encodes: "don't limit it to 24h — all modes."
    // 0.70 is below standard's 0.80 auto-fire, so standard issues no
    // self-invoke instruction at that ratio (it may still soft-warn)...
    expect(buildContextVerdict(0.7, 'standard').nextActions).toEqual([]);
    // ...while the SAME ratio is in-zone under partial/24h...
    expect(buildContextVerdict(0.7, 'partial').nextActions.length).toBeGreaterThan(0);
    // ...and standard is not allowed to be a silent no-op either: it
    // fires too, one threshold later.
    expect(buildContextVerdict(0.9, 'standard').nextActions.length).toBeGreaterThan(0);
  });

  it('reports the red-line zone as red-line, not as a softer tier', () => {
    expect(buildContextVerdict(0.96, 'standard').context.action).toBe('red-line');
    expect(buildContextVerdict(0.96, 'partial').context.action).toBe('red-line');
  });

  it('carries the mode in the envelope so the threshold shown is the one applied', () => {
    expect(buildContextVerdict(0.9, 'partial').context.mode).toBe('partial');
    expect(buildContextVerdict(0.9, 'standard').context.mode).toBe('standard');
  });
});
