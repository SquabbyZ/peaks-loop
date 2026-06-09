import { describe, expect, test } from 'vitest';
import { applyStalePolicy, ageInDays, DAY_MS, DEFAULT_STALE_DAYS, isStale } from '../../../src/shared/stale-policy.js';

const NOW = 1_700_000_000_000;

describe('isStale', () => {
  test('fresh: updatedAt 1 day ago is not stale (TC-UNIT-STALE-1)', () => {
    const updatedAt = new Date(NOW - 1 * DAY_MS).toISOString();
    expect(isStale(updatedAt, { now: NOW, thresholdDays: 30 })).toBe(false);
  });

  test('stale: updatedAt 31 days ago is stale (TC-UNIT-STALE-2)', () => {
    const updatedAt = new Date(NOW - 31 * DAY_MS).toISOString();
    expect(isStale(updatedAt, { now: NOW, thresholdDays: 30 })).toBe(true);
  });

  test('boundary: exactly 30 days is NOT stale (strict >, TC-UNIT-STALE-3)', () => {
    const updatedAt = new Date(NOW - 30 * DAY_MS).toISOString();
    expect(isStale(updatedAt, { now: NOW, thresholdDays: 30 })).toBe(false);
  });

  test('injectable clock produces deterministic result', () => {
    const updatedAt = new Date(0).toISOString();
    expect(isStale(updatedAt, { now: 1_700_000_000_000, thresholdDays: 30 })).toBe(true);
  });

  test('missing updatedAt is treated as fresh (no throw)', () => {
    expect(isStale(undefined, { now: NOW, thresholdDays: 30 })).toBe(false);
    expect(isStale(null, { now: NOW, thresholdDays: 30 })).toBe(false);
    expect(isStale('', { now: NOW, thresholdDays: 30 })).toBe(false);
  });

  test('unparseable updatedAt is treated as fresh', () => {
    expect(isStale('not-a-date', { now: NOW, thresholdDays: 30 })).toBe(false);
  });
});

describe('ageInDays', () => {
  test('returns 0 for missing updatedAt', () => {
    expect(ageInDays(undefined, NOW)).toBe(0);
    expect(ageInDays(null, NOW)).toBe(0);
    expect(ageInDays('', NOW)).toBe(0);
  });

  test('returns integer day count for valid updatedAt', () => {
    const updatedAt = new Date(NOW - 7 * DAY_MS).toISOString();
    expect(ageInDays(updatedAt, NOW)).toBe(7);
  });
});

describe('applyStalePolicy', () => {
  test('--include-stale override keeps stale entries in the result (TC-UNIT-STALE-4)', () => {
    const updatedAt = new Date(NOW - 40 * DAY_MS).toISOString();
    const entries = [{ id: 'a', updatedAt }];

    const excluded = applyStalePolicy(entries, { now: NOW, thresholdDays: 30, includeStale: false });
    expect(excluded.entries).toHaveLength(0);
    expect(excluded.droppedCount).toBe(1);
    expect(excluded.totalCount).toBe(1);

    const included = applyStalePolicy(entries, { now: NOW, thresholdDays: 30, includeStale: true });
    expect(included.entries).toHaveLength(1);
    expect(included.entries[0]?.stale).toBe(true);
    expect(included.entries[0]?.ageDays).toBe(40);
  });

  test('--stale-days override: 7-day policy marks a 10-day-old entry stale (TC-UNIT-STALE-5)', () => {
    const updatedAt = new Date(NOW - 10 * DAY_MS).toISOString();
    const entries = [{ id: 'x', updatedAt }];

    const defaultPolicy = applyStalePolicy(entries, { now: NOW, thresholdDays: 30, includeStale: false });
    expect(defaultPolicy.entries).toHaveLength(1);
    expect(defaultPolicy.entries[0]?.stale).toBe(false);

    const sevenDayPolicy = applyStalePolicy(entries, { now: NOW, thresholdDays: 7, includeStale: false });
    expect(sevenDayPolicy.entries).toHaveLength(0);
    expect(sevenDayPolicy.droppedCount).toBe(1);
  });

  test('stale: true is computed, not persisted to source entry (TC-UNIT-STALE-6 immutability)', () => {
    const updatedAt = new Date(NOW - 40 * DAY_MS).toISOString();
    const input = { id: 'y', updatedAt };
    applyStalePolicy([input], { now: NOW, thresholdDays: 30, includeStale: true });
    // The input object must NOT have a `stale` field set on it.
    expect((input as { stale?: boolean }).stale).toBeUndefined();
  });

  test('default threshold is 30 days (DEFAULT_STALE_DAYS)', () => {
    expect(DEFAULT_STALE_DAYS).toBe(30);
  });

  test('multiple entries: mixed fresh/stale handled correctly', () => {
    const entries = [
      { id: 'fresh', updatedAt: new Date(NOW - 1 * DAY_MS).toISOString() },
      { id: 'stale', updatedAt: new Date(NOW - 60 * DAY_MS).toISOString() },
      { id: 'edge', updatedAt: new Date(NOW - 30 * DAY_MS).toISOString() }
    ];

    const result = applyStalePolicy(entries, { now: NOW, thresholdDays: 30, includeStale: false });
    expect(result.entries.map((e) => e.id)).toEqual(['fresh', 'edge']);
    expect(result.droppedCount).toBe(1);
    expect(result.totalCount).toBe(3);

    const withStale = applyStalePolicy(entries, { now: NOW, thresholdDays: 30, includeStale: true });
    expect(withStale.entries.map((e) => e.id)).toEqual(['fresh', 'stale', 'edge']);
    expect(withStale.entries.find((e) => e.id === 'stale')?.stale).toBe(true);
    expect(withStale.entries.find((e) => e.id === 'stale')?.ageDays).toBe(60);
  });

  test('missing updatedAt is treated as fresh with ageDays 0 (defensive)', () => {
    const entries = [{ id: 'old-no-fm' }, { id: 'with-fm', updatedAt: new Date(NOW - 60 * DAY_MS).toISOString() }];
    const result = applyStalePolicy(entries, { now: NOW, thresholdDays: 30, includeStale: false });
    expect(result.entries.map((e) => e.id)).toEqual(['old-no-fm']);
    expect(result.entries[0]?.stale).toBe(false);
    expect(result.entries[0]?.ageDays).toBe(0);
  });
});
