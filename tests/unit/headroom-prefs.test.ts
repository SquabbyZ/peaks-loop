import { describe, expect, it } from 'vitest';
import { resolveHeadroomOptions, shouldCompressResults } from '../../src/services/context/headroom-prefs.js';
import { DEFAULT_PREFERENCES } from '../../src/services/preferences/preferences-types.js';

const ENABLED_PREFS = DEFAULT_PREFERENCES.headroom;

describe('headroom-prefs', () => {
  describe('resolveHeadroomOptions', () => {
    it('returns null mode when --use-headroom is not set', () => {
      const result = resolveHeadroomOptions(ENABLED_PREFS, { useHeadroom: false });
      expect(result.mode).toBeNull();
      expect(result.blocked).toBeNull();
    });

    it('uses CLI --headroom-mode when provided (CLI override wins)', () => {
      const result = resolveHeadroomOptions(ENABLED_PREFS, {
        useHeadroom: true,
        headroomMode: 'conservative'
      });
      expect(result.mode).toBe('conservative');
      expect(result.blocked).toBeNull();
    });

    it('uses perTouchpoint.subAgentDispatch when --use-headroom set without --headroom-mode', () => {
      const prefs = {
        ...ENABLED_PREFS,
        defaultMode: 'aggressive' as const,
        perTouchpoint: { ...ENABLED_PREFS.perTouchpoint, subAgentDispatch: 'conservative' as const }
      };
      const result = resolveHeadroomOptions(prefs, { useHeadroom: true });
      expect(result.mode).toBe('conservative');
    });

    it('falls back to defaultMode when perTouchpoint.subAgentDispatch is not set', () => {
      // Synthesize a prefs object with the subAgentDispatch key missing (type cast: legacy fixture).
      const prefs = {
        ...ENABLED_PREFS,
        defaultMode: 'aggressive' as const,
        perTouchpoint: { ...ENABLED_PREFS.perTouchpoint, subAgentDispatch: undefined as unknown as 'balanced' }
      };
      const result = resolveHeadroomOptions(prefs, { useHeadroom: true });
      expect(result.mode).toBe('aggressive');
    });

    it('hard-blocks when headroom.enabled=false and --use-headroom is set', () => {
      const result = resolveHeadroomOptions({ ...ENABLED_PREFS, enabled: false }, { useHeadroom: true });
      expect(result.blocked).toBe('HEADROOM_DISABLED_BY_PREFERENCE');
      expect(result.mode).toBeNull();
    });

    it('ignores headroom.enabled=false when --use-headroom is not set (no-op)', () => {
      const result = resolveHeadroomOptions({ ...ENABLED_PREFS, enabled: false }, { useHeadroom: false });
      expect(result.blocked).toBeNull();
      expect(result.mode).toBeNull();
    });

    it('ignores invalid CLI --headroom-mode and falls back to perTouchpoint', () => {
      const result = resolveHeadroomOptions(ENABLED_PREFS, {
        useHeadroom: true,
        headroomMode: 'invalid-mode'
      });
      expect(result.mode).toBe(ENABLED_PREFS.perTouchpoint.subAgentDispatch);
      expect(result.blocked).toBeNull();
    });
  });

  describe('shouldCompressResults', () => {
    it('does not compress when headroom.enabled=false', () => {
      const result = shouldCompressResults(
        { ...ENABLED_PREFS, enabled: false },
        999_999,
        'memorySearch'
      );
      expect(result.compress).toBe(false);
      expect(result.reason).toBe('DISABLED');
    });

    it('does not compress when joined bytes < compressMinBytes', () => {
      const result = shouldCompressResults(ENABLED_PREFS, 1024, 'memorySearch');
      expect(result.compress).toBe(false);
      expect(result.reason).toBe('BELOW_THRESHOLD');
    });

    it('compresses when enabled and bytes >= threshold', () => {
      const result = shouldCompressResults(ENABLED_PREFS, ENABLED_PREFS.compressMinBytes, 'memorySearch');
      expect(result.compress).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.mode).toBe('memorySearch' in ENABLED_PREFS.perTouchpoint ? ENABLED_PREFS.perTouchpoint.memorySearch : 'balanced');
    });

    it('uses the touchpoint-specific mode when compressing', () => {
      const prefs = {
        ...ENABLED_PREFS,
        perTouchpoint: { ...ENABLED_PREFS.perTouchpoint, retrospectiveSearch: 'aggressive' as const }
      };
      const result = shouldCompressResults(prefs, 999_999, 'retrospectiveSearch');
      expect(result.mode).toBe('aggressive');
      expect(result.compress).toBe(true);
    });
  });
});
