/**
 * Slice 2026-07-29-context-evaluation-accuracy Part 22: the
 * auto-compact trigger tiers (autoFire / preCompact / redLine).
 *
 * The orchestrator previously used a 0.85 preCompact zone where
 * the LLM had to decide. LLM misjudged 0.85-0.95 and only fired
 * at 0.95, which let the ratio drift up the LLM-time zone
 * before peaks-loop took over. Part 22 lowers the auto-fire
 * threshold to 0.80 in standard mode (0.65 in partial mode)
 * so peaks-loop preempts without LLM involvement.
 *
 * 5 cases cover the three tiers in standard mode + one partial
 * mode case + one boundary case.
 */

import { describe, expect, test } from 'vitest';
import {
  AUTO_COMPACT_THRESHOLDS,
  thresholdFor
} from '../../../../src/services/code/auto-compact-modes.js';
import { evaluateCompactTrigger } from '../../../../src/services/code/auto-compact-orchestrator.js';

describe('auto-compact threshold (Part 22)', () => {
  test('autoFire threshold is 0.80 in standard mode', () => {
    expect(AUTO_COMPACT_THRESHOLDS.standard.autoFire).toBe(0.80);
  });

  test('preCompact threshold unchanged at 0.85 in standard mode (backward compat)', () => {
    expect(AUTO_COMPACT_THRESHOLDS.standard.preCompact).toBe(0.85);
  });

  test('redLine threshold unchanged at 0.95 in standard mode', () => {
    expect(AUTO_COMPACT_THRESHOLDS.standard.redLine).toBe(0.95);
  });

  test('partial mode lowers all three thresholds proportionally', () => {
    expect(AUTO_COMPACT_THRESHOLDS.partial.autoFire).toBe(0.65);
    expect(AUTO_COMPACT_THRESHOLDS.partial.preCompact).toBe(0.70);
    expect(AUTO_COMPACT_THRESHOLDS.partial.redLine).toBe(0.85);
  });

  test('thresholdFor returns the right number for each kind', () => {
    expect(thresholdFor('standard', 'autoFire')).toBe(0.80);
    expect(thresholdFor('standard', 'preCompact')).toBe(0.85);
    expect(thresholdFor('standard', 'redLine')).toBe(0.95);
    expect(thresholdFor('partial', 'autoFire')).toBe(0.65);
  });
});

describe('evaluateCompactTrigger tiers (Part 22)', () => {
  test('ratio 0.4 (well under soft-warn) → none', () => {
    const t = evaluateCompactTrigger(0.4);
    expect(t.kind).toBe('none');
  });

  test('ratio 0.6 (soft-warn zone) → soft-warn', () => {
    const t = evaluateCompactTrigger(0.6);
    expect(t.kind).toBe('soft-warn');
  });

  test('ratio 0.82 (autoFire zone, 0.80–0.85) → auto-fire (NEW behavior)', () => {
    const t = evaluateCompactTrigger(0.82);
    expect(t.kind).toBe('auto-fire');
    if (t.kind === 'auto-fire') {
      expect(t.ratio).toBe(0.82);
    }
  });

  test('ratio 0.87 (preCompact zone, 0.85–0.95) → pre-compact (kept for backward compat)', () => {
    const t = evaluateCompactTrigger(0.87);
    expect(t.kind).toBe('pre-compact');
  });

  test('ratio 0.97 (red line ≥ 0.95) → red-line', () => {
    const t = evaluateCompactTrigger(0.97);
    expect(t.kind).toBe('red-line');
  });
});
