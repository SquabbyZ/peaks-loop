import { describe, expect, it } from 'vitest';
import {
  initialState,
  selectByMode,
  selectHash,
  selectRandom,
  selectRoundRobin,
  type SelectionState
} from '../../../src/services/reviewer/selection-strategies.js';
import type { ReviewerProviderConfig } from '../../../src/services/reviewer/reviewer-config.js';

const PROVIDERS: ReadonlyArray<ReviewerProviderConfig> = [
  { name: 'ollama', model: 'llama3.2:8b' },
  { name: 'anthropic', model: 'claude-haiku-4-5' },
  { name: 'openai', model: 'gpt-4o-mini' }
];

describe('selection-strategies.ts', () => {
  describe('selectRoundRobin', () => {
    it('cycles through providers across calls and wraps to 0', () => {
      let state: SelectionState = initialState();
      const picks: string[] = [];
      for (let i = 0; i < 7; i += 1) {
        const { result, nextState } = selectRoundRobin(PROVIDERS, state, 'rid-' + i);
        picks.push(result.provider.model);
        state = nextState;
      }
      expect(picks).toEqual([
        'llama3.2:8b',
        'claude-haiku-4-5',
        'gpt-4o-mini',
        'llama3.2:8b',
        'claude-haiku-4-5',
        'gpt-4o-mini',
        'llama3.2:8b'
      ]);
    });

    it('throws on empty provider list (rid does not change semantics)', () => {
      expect(() => selectRoundRobin([], initialState(), 'rid-1')).toThrow(/non-empty/);
    });

    it('callNumber increments monotonically (1-based)', () => {
      let state: SelectionState = initialState();
      const { result: r1, nextState: s1 } = selectRoundRobin(PROVIDERS, state, 'rid-x');
      const { result: r2, nextState: s2 } = selectRoundRobin(PROVIDERS, s1, 'rid-x');
      expect(r1.callNumber).toBe(1);
      expect(r2.callNumber).toBe(2);
      void s2;
    });
  });

  describe('selectHash', () => {
    it('is stable per rid (deterministic replay)', () => {
      const a = selectHash(PROVIDERS, 'slice-2026-06-28-abc');
      const b = selectHash(PROVIDERS, 'slice-2026-06-28-abc');
      expect(a.provider.model).toBe(b.provider.model);
      expect(a.index).toBe(b.index);
    });

    it('different rids MAY map to different providers (no monotonic guarantee)', () => {
      const seen = new Set<string>();
      for (let i = 0; i < 50; i += 1) {
        seen.add(selectHash(PROVIDERS, 'rid-' + i).provider.model);
      }
      // With 3 providers and 50 rids, we expect >= 2 distinct picks.
      expect(seen.size).toBeGreaterThanOrEqual(2);
    });

    it('throws on empty provider list', () => {
      expect(() => selectHash([], 'rid-1')).toThrow(/non-empty/);
    });
  });

  describe('selectRandom', () => {
    it('respects an injected deterministic rng', () => {
      const seq = [0.0, 0.34, 0.67, 0.99];
      let i = 0;
      const rng = () => seq[i++ % seq.length] ?? 0;
      const a = selectRandom(PROVIDERS, 'rid-1', rng);
      const b = selectRandom(PROVIDERS, 'rid-1', rng);
      const c = selectRandom(PROVIDERS, 'rid-1', rng);
      expect(a.index).toBe(0);
      expect(b.index).toBe(1);
      expect(c.index).toBe(2);
    });

    it('throws on empty provider list', () => {
      expect(() => selectRandom([], 'rid-1', () => 0)).toThrow(/non-empty/);
    });
  });

  describe('selectByMode dispatch', () => {
    it('round-robin mode returns a SelectionResult + nextState', () => {
      const { result, nextState } = selectByMode('round-robin', PROVIDERS, 'rid', initialState());
      expect(result.provider.model).toBe('llama3.2:8b');
      expect(nextState.mode).toBe('round-robin');
      expect(nextState.cursor).toBe(1);
    });

    it('hash mode does not mutate the round-robin cursor', () => {
      const start: SelectionState = { mode: 'round-robin', cursor: 5 };
      const { result, nextState } = selectByMode('hash', PROVIDERS, 'rid-xyz', start);
      expect(typeof result.provider.model).toBe('string');
      expect(nextState.cursor).toBe(5);
    });

    it('random mode does not mutate the round-robin cursor', () => {
      const start: SelectionState = { mode: 'round-robin', cursor: 3 };
      const { nextState } = selectByMode('random', PROVIDERS, 'rid-xyz', start, () => 0.1);
      expect(nextState.cursor).toBe(3);
    });
  });

  describe('reset behavior (round-robin only)', () => {
    it('initialState() resets the cursor to 0', () => {
      const advanced: SelectionState = { mode: 'round-robin', cursor: 12 };
      const reset = initialState();
      expect(reset.cursor).toBe(0);
      expect(reset.mode).toBe('round-robin');
      // After reset, the next round-robin pick returns the FIRST provider again.
      const { result } = selectRoundRobin(PROVIDERS, reset, 'rid');
      expect(result.provider.model).toBe('llama3.2:8b');
      void advanced;
    });
  });
});
