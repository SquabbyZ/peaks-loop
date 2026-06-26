/**
 * v2.11.0 Group F (Tier 9) — D6 main-session context monitor unit tests.
 *
 * Covers:
 *   - `evaluateMainSessionThreshold` × 4 tiers (ok / soft-warn / near-limit / emergency)
 *   - `pickMainSessionTrigger` × 4 IDE kinds × 4 tiers + defer paths
 *   - `detectIdeFromEnv` with each env var
 *   - `formatMainSessionTriggerLogLine` shape per kind
 */

import { describe, expect, test } from 'vitest';

import {
  detectIdeFromEnv,
  evaluateMainSessionThreshold,
  formatMainSessionTriggerLogLine,
  pickMainSessionTrigger,
  type IdeKind
} from '../../../../src/services/context/main-session-monitor.js';
import { CONTEXT_CAPACITY_DEFAULT_BYTES } from '../../../../src/services/context/threshold.js';

const PROMPT_50_PERCENT = Math.floor(CONTEXT_CAPACITY_DEFAULT_BYTES * 0.5);
const PROMPT_75_PERCENT = Math.floor(CONTEXT_CAPACITY_DEFAULT_BYTES * 0.75);
const PROMPT_80_PERCENT = Math.floor(CONTEXT_CAPACITY_DEFAULT_BYTES * 0.8);
const PROMPT_95_PERCENT = Math.floor(CONTEXT_CAPACITY_DEFAULT_BYTES * 0.95);
const PROMPT_30_PERCENT = Math.floor(CONTEXT_CAPACITY_DEFAULT_BYTES * 0.3);

describe('evaluateMainSessionThreshold — 4 tiers', () => {
  test('30% → ok', () => {
    const e = evaluateMainSessionThreshold(PROMPT_30_PERCENT);
    expect(e.tier).toBe('ok');
    expect(e.warnings).toEqual([]);
  });

  test('50% → soft-warn', () => {
    const e = evaluateMainSessionThreshold(PROMPT_50_PERCENT);
    expect(e.tier).toBe('soft-warn');
    expect(e.warnings).toContain('CONTEXT_SOFT_WARN');
  });

  test('75% → near-limit', () => {
    const e = evaluateMainSessionThreshold(PROMPT_75_PERCENT);
    expect(e.tier).toBe('near-limit');
    expect(e.warnings).toContain('CONTEXT_NEAR_LIMIT');
  });

  test('80% → still near-limit (G9 hard-reject collapses to near-limit for main-session)', () => {
    const e = evaluateMainSessionThreshold(PROMPT_80_PERCENT);
    expect(e.tier).toBe('near-limit');
  });

  test('95% → emergency', () => {
    const e = evaluateMainSessionThreshold(PROMPT_95_PERCENT);
    expect(e.tier).toBe('emergency');
    expect(e.warnings).toContain('PROMPT_EMERGENCY');
  });

  test('rejects negative promptSize', () => {
    expect(() => evaluateMainSessionThreshold(-1)).toThrow();
  });

  test('rejects non-positive capacityBytes', () => {
    expect(() => evaluateMainSessionThreshold(1000, 0)).toThrow();
  });
});

describe('pickMainSessionTrigger — soft-warn / compact / defer paths', () => {
  test('30% → none (no trigger)', () => {
    const t = pickMainSessionTrigger({ promptSize: PROMPT_30_PERCENT, ide: 'claude-code' });
    expect(t.kind).toBe('none');
  });

  test('50% → soft-warn', () => {
    const t = pickMainSessionTrigger({ promptSize: PROMPT_50_PERCENT, ide: 'claude-code' });
    expect(t.kind).toBe('soft-warn');
    if (t.kind === 'soft-warn') {
      expect(t.promptSize).toBe(PROMPT_50_PERCENT);
    }
  });

  test('75% on claude-code → compact via ide-native', () => {
    const t = pickMainSessionTrigger({ promptSize: PROMPT_75_PERCENT, ide: 'claude-code' });
    expect(t.kind).toBe('compact');
    if (t.kind === 'compact') {
      expect(t.ide).toBe('claude-code');
      expect(t.path).toBe('ide-native');
      expect(t.code).toBe('CONTEXT_NEAR_LIMIT');
    }
  });

  test('75% on trae/opencode → compact via llm-self-compress', () => {
    for (const ide of ['trae', 'opencode'] as IdeKind[]) {
      const t = pickMainSessionTrigger({ promptSize: PROMPT_75_PERCENT, ide });
      expect(t.kind).toBe('compact');
      if (t.kind === 'compact') {
        expect(t.ide).toBe(ide);
        expect(t.path).toBe('llm-self-compress');
      }
    }
  });

  test('95% → emergency code PROMPT_EMERGENCY', () => {
    const t = pickMainSessionTrigger({ promptSize: PROMPT_95_PERCENT, ide: 'claude-code' });
    expect(t.kind).toBe('compact');
    if (t.kind === 'compact') {
      expect(t.code).toBe('PROMPT_EMERGENCY');
    }
  });

  test('75% with in-flight batch → defer (D6.e)', () => {
    const t = pickMainSessionTrigger({
      promptSize: PROMPT_75_PERCENT,
      ide: 'claude-code',
      inFlightBatch: { hasInFlightBatch: true, sharedChannelEntries: 3 }
    });
    expect(t.kind).toBe('defer');
    if (t.kind === 'defer') {
      expect(t.reason).toBe('in-flight-batch');
    }
  });

  test('75% on unknown IDE → defer (unsupported-ide)', () => {
    const t = pickMainSessionTrigger({ promptSize: PROMPT_75_PERCENT, ide: 'unknown' });
    expect(t.kind).toBe('defer');
    if (t.kind === 'defer') {
      expect(t.reason).toBe('unsupported-ide');
    }
  });
});

describe('detectIdeFromEnv — env var matrix', () => {
  test('CLAUDE_CODE_ENTRYPOINT set → claude-code', () => {
    expect(detectIdeFromEnv({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('claude-code');
  });

  test('CLAUDE_SESSION_ID set → claude-code', () => {
    expect(detectIdeFromEnv({ CLAUDE_SESSION_ID: 'abc' })).toBe('claude-code');
  });

  test('TRAE_CLI set → trae', () => {
    expect(detectIdeFromEnv({ TRAE_CLI: '1' })).toBe('trae');
  });

  test('OPENCODE set → opencode', () => {
    expect(detectIdeFromEnv({ OPENCODE: '1' })).toBe('opencode');
  });

  test('no recognized env → unknown', () => {
    expect(detectIdeFromEnv({})).toBe('unknown');
    expect(detectIdeFromEnv({ PATH: '/usr/bin' })).toBe('unknown');
  });
});

describe('formatMainSessionTriggerLogLine — one per kind', () => {
  test('none kind', () => {
    const line = formatMainSessionTriggerLogLine({ kind: 'none' }, 'main');
    expect(line).toContain('ok');
  });

  test('soft-warn kind', () => {
    const line = formatMainSessionTriggerLogLine(
      { kind: 'soft-warn', promptSize: 100, ratio: 0.5 },
      'main'
    );
    expect(line).toContain('50%');
  });

  test('defer kind', () => {
    const line = formatMainSessionTriggerLogLine(
      { kind: 'defer', reason: 'in-flight-batch' },
      'main'
    );
    expect(line).toContain('deferred');
    expect(line).toContain('in-flight-batch');
  });

  test('compact kind', () => {
    const line = formatMainSessionTriggerLogLine(
      {
        kind: 'compact',
        ide: 'claude-code',
        path: 'ide-native',
        promptSize: 200000,
        ratio: 0.78,
        code: 'CONTEXT_NEAR_LIMIT'
      },
      'main'
    );
    expect(line).toContain('78%');
    expect(line).toContain('ide-native');
    expect(line).toContain('claude-code');
    expect(line).toContain('CONTEXT_NEAR_LIMIT');
  });
});
