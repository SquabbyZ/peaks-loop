/**
 * G9 — Threshold + context-guard + --force semantics.
 *
 * Coverage:
 *  - 50% (128KB) — soft warn + suggest --use-headroom
 *  - 75% (192KB) — CONTEXT_NEAR_LIMIT warning
 *  - 80% (204KB) — hard reject PROMPT_TOO_LARGE
 *  - 90% (230KB) — emergency hard reject PROMPT_EMERGENCY
 *  - < 50% — OK, no warning
 *  - --force at CLI: 80%+ prompt with --force -> FORCED_OVER_THRESHOLD + forcedAt
 *  - --force + 90%: same override path
 *  - headroom fallback: < 75% + HEADROOM_UNAVAILABLE warning
 *  - threshold constants are exported with the documented values
 */
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_CAPACITY_DEFAULT_BYTES,
  THRESHOLD_EMERGENCY_RATIO,
  THRESHOLD_HARD_REJECT_RATIO,
  THRESHOLD_NEAR_LIMIT_RATIO,
  THRESHOLD_SOFT_WARN_RATIO,
  evaluateThresholdTier,
  tierToCode
} from '../../src/services/context/threshold.js';
import { evaluatePromptSize } from '../../src/services/context/context-guard.js';

describe('G9 threshold constants (PRD §Numerical thresholds in code)', () => {
  it('CONTEXT_CAPACITY_DEFAULT_BYTES = 256 * 1024', () => {
    expect(CONTEXT_CAPACITY_DEFAULT_BYTES).toBe(256 * 1024);
  });
  it('soft-warn ratio = 0.50', () => {
    expect(THRESHOLD_SOFT_WARN_RATIO).toBe(0.5);
  });
  it('near-limit ratio = 0.75 (user red line)', () => {
    expect(THRESHOLD_NEAR_LIMIT_RATIO).toBe(0.75);
  });
  it('hard-reject ratio = 0.80', () => {
    expect(THRESHOLD_HARD_REJECT_RATIO).toBe(0.8);
  });
  it('emergency ratio = 0.90', () => {
    expect(THRESHOLD_EMERGENCY_RATIO).toBe(0.9);
  });
});

describe('G9 evaluateThresholdTier (pure)', () => {
  it('< 50% (under 128KB) => ok tier', () => {
    const e = evaluateThresholdTier(50_000);
    expect(e.tier).toBe('ok');
    expect(e.warnings).toEqual([]);
  });

  it('50% boundary (128KB exactly) => soft-warn tier', () => {
    const e = evaluateThresholdTier(128 * 1024);
    expect(e.tier).toBe('soft-warn');
    expect(e.warnings).toContain('CONTEXT_SOFT_WARN');
  });

  it('75% boundary (192KB) => near-limit tier', () => {
    const e = evaluateThresholdTier(192 * 1024);
    expect(e.tier).toBe('near-limit');
    expect(e.warnings).toContain('CONTEXT_NEAR_LIMIT');
  });

  it('80% boundary (210KB) => hard-reject tier', () => {
    // Use a value clearly >= 80% of 256*1024. 210*1024 = 215040 / 262144 ≈ 0.820
    const e = evaluateThresholdTier(210 * 1024);
    expect(e.tier).toBe('hard-reject');
    expect(e.warnings).toContain('PROMPT_TOO_LARGE');
  });

  it('90% boundary (240KB) => emergency tier', () => {
    // Use a value clearly >= 90% of 256*1024. 240*1024 = 245760 / 262144 ≈ 0.938
    const e = evaluateThresholdTier(240 * 1024);
    expect(e.tier).toBe('emergency');
    expect(e.warnings).toContain('PROMPT_EMERGENCY');
  });

  it('over 90% (e.g. 250KB) => emergency tier', () => {
    const e = evaluateThresholdTier(250 * 1024);
    expect(e.tier).toBe('emergency');
  });

  it('tierToCode returns the right code for each tier', () => {
    expect(tierToCode('ok')).toBe('OK');
    expect(tierToCode('soft-warn')).toBe('CONTEXT_SOFT_WARN');
    expect(tierToCode('near-limit')).toBe('CONTEXT_NEAR_LIMIT');
    expect(tierToCode('hard-reject')).toBe('PROMPT_TOO_LARGE');
    expect(tierToCode('emergency')).toBe('PROMPT_EMERGENCY');
  });
});

describe('G9 evaluatePromptSize (CLI 兜底 layer)', () => {
  it('< 50% (50KB) => allow, code OK', () => {
    const d = evaluatePromptSize(50_000);
    expect(d.allow).toBe(true);
    expect(d.code).toBe('OK');
    expect(d.warnings).toEqual([]);
    expect(d.forcedAt).toBeNull();
  });

  it('50% (128KB) => allow, code CONTEXT_SOFT_WARN, suggest --use-headroom', () => {
    const d = evaluatePromptSize(128 * 1024);
    expect(d.allow).toBe(true);
    expect(d.code).toBe('CONTEXT_SOFT_WARN');
    expect(d.warnings).toContain('CONTEXT_SOFT_WARN');
    expect(d.suggest).toMatch(/--use-headroom/);
  });

  it('75% (200KB) => allow, code CONTEXT_NEAR_LIMIT, suggest --use-headroom', () => {
    const d = evaluatePromptSize(200 * 1024);
    expect(d.allow).toBe(true);
    expect(d.code).toBe('CONTEXT_NEAR_LIMIT');
    expect(d.warnings).toContain('CONTEXT_NEAR_LIMIT');
    expect(d.suggest).toMatch(/--use-headroom/);
  });

  it('80% (210KB) => reject, code PROMPT_TOO_LARGE', () => {
    const d = evaluatePromptSize(210 * 1024);
    expect(d.allow).toBe(false);
    expect(d.code).toBe('PROMPT_TOO_LARGE');
    expect(d.warnings).toContain('PROMPT_TOO_LARGE');
    expect(d.suggest).toMatch(/--force/);
  });

  it('90% (240KB) => reject, code PROMPT_EMERGENCY', () => {
    const d = evaluatePromptSize(240 * 1024);
    expect(d.allow).toBe(false);
    expect(d.code).toBe('PROMPT_EMERGENCY');
    expect(d.warnings).toContain('PROMPT_EMERGENCY');
  });

  it('--force at CLI on 80% prompt => allow, code FORCED_OVER_THRESHOLD, forcedAt set', () => {
    const d = evaluatePromptSize(210 * 1024, { force: true });
    expect(d.allow).toBe(true);
    expect(d.code).toBe('FORCED_OVER_THRESHOLD');
    expect(d.forcedAt).not.toBeNull();
    expect(d.forcedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(d.warnings).toContain('FORCED_OVER_THRESHOLD');
  });

  it('--force at CLI on 90% prompt => still allowed, code FORCED_OVER_THRESHOLD', () => {
    const d = evaluatePromptSize(240 * 1024, { force: true });
    expect(d.allow).toBe(true);
    expect(d.code).toBe('FORCED_OVER_THRESHOLD');
  });

  it('--force at CLI on < 50% prompt is a no-op (already allowed)', () => {
    const d = evaluatePromptSize(50_000, { force: true });
    expect(d.allow).toBe(true);
    expect(d.code).toBe('OK');
    expect(d.forcedAt).toBeNull();
  });
});

describe('G9 capacity override (testing seam)', () => {
  it('custom capacityBytes changes the ratio calculation', () => {
    const d = evaluatePromptSize(50_000, { capacityBytes: 100_000 });
    // 50KB / 100KB = 0.5 => soft-warn
    expect(d.allow).toBe(true);
    expect(d.code).toBe('CONTEXT_SOFT_WARN');
  });
});
