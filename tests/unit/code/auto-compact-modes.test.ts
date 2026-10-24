/**
 * `tests/unit/code/auto-compact-modes.test.ts`
 *
 * The auto-compact profiles are PUBLIC, and the published alias still works.
 *
 * What this pins down:
 *   - the canonical profile names are `standard` and `eager`;
 *   - `partial` is still ACCEPTED and means `eager` — it is a published CLI
 *     surface (`--mode partial`), so dropping it would break existing
 *     callers harder than a no-op;
 *   - `normalizeAutoCompactMode` is the ONE place the alias is mapped;
 *   - `describeMode` says what the profile DOES (it fires earlier) and says
 *     nothing about any mode.
 *
 * Dimensions covered:
 *   - behavior: the profile table, the alias, the normalizer
 *   - render:   `describeMode` output
 *   - a11y:     the description names the real behaviour, not a mode
 *   - integration: omitted — every function here is pure; the filesystem
 *     boundary is covered by `tests/unit/code/auto-compact-profile.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  AUTO_COMPACT_PROFILES,
  AUTO_COMPACT_THRESHOLDS,
  describeMode,
  isEagerModeEligible,
  isPartialModeEligible,
  isValidMode,
  normalizeAutoCompactMode,
  thresholdFor
} from '~/src/services/code/auto-compact-modes';

declareDimensions(
  'tests/unit/code/auto-compact-modes.test.ts',
  ['behavior', 'render', 'a11y'],
  [{ dim: 'integration', reason: 'every function under test is pure' }]
);

describe('behavior — the profile table and the alias', () => {
  it('when the profile catalogue is read, should list standard and eager and nothing else', () => {
    // given: the published profile catalogue
    // when: the catalogue is read
    // then: it names the two public profiles and nothing else
    expect(AUTO_COMPACT_PROFILES).toEqual(['standard', 'eager']);
  });

  it('when the threshold table is read, should give eager the earlier thresholds', () => {
    // given: the published threshold table of both profiles
    // when: the table is read
    // then: the eager profile fires at the lower numbers
    expect(AUTO_COMPACT_THRESHOLDS.standard).toEqual({
      autoFire: 0.8,
      preCompact: 0.85,
      redLine: 0.95
    });
    expect(AUTO_COMPACT_THRESHOLDS.eager).toEqual({
      autoFire: 0.65,
      preCompact: 0.7,
      redLine: 0.85
    });
  });

  it('when the legacy alias partial is asked for thresholds, should name the eager ones', () => {
    // given: the legacy alias `partial`
    // when: its thresholds are read
    // then: they are the eager profile's thresholds
    expect(AUTO_COMPACT_THRESHOLDS.partial).toEqual(AUTO_COMPACT_THRESHOLDS.eager);
    expect(thresholdFor('partial', 'autoFire')).toBe(thresholdFor('eager', 'autoFire'));
    expect(thresholdFor('partial', 'preCompact')).toBe(0.7);
    expect(thresholdFor('partial', 'redLine')).toBe(0.85);
  });

  it('when a mode name this build does not know is normalized, should be refused', () => {
    // given: a mode name the build does not know
    // when: it is normalized
    // then: it is refused instead of guessed
    expect(normalizeAutoCompactMode('bogus')).toBeNull();
    expect(normalizeAutoCompactMode('')).toBeNull();
    expect(isValidMode('bogus')).toBe(false);
  });

  it('when the published names are normalized, should be accepted and partial mean eager', () => {
    // given: the published profile names
    // when: each of them is normalized
    // then: all are accepted and the legacy alias still means eager
    expect(normalizeAutoCompactMode('standard')).toBe('standard');
    expect(normalizeAutoCompactMode('eager')).toBe('eager');
    expect(normalizeAutoCompactMode('partial')).toBe('eager');
    expect(isValidMode('standard')).toBe(true);
    expect(isValidMode('eager')).toBe(true);
    expect(isValidMode('partial')).toBe(true);
  });

  it('when the ratio reaches the eager pre-compact line, should become eligible', () => {
    // given: the eager profile's own pre-compact line
    // when: the ratio is tested against it
    // then: the profile becomes eligible exactly at that line
    expect(isEagerModeEligible(0.69)).toBe(false);
    expect(isEagerModeEligible(0.7)).toBe(true);
    // The deprecated alias still answers the same question.
    expect(isPartialModeEligible(0.7)).toBe(isEagerModeEligible(0.7));
  });
});

describe('render — the profile description', () => {
  it('when a mode is described, should name the profile and its threshold row', () => {
    // given: the rendered description of a profile
    // when: it is read
    // then: it names the profile and the threshold row behind it
    expect(describeMode('eager')).toContain('eager');
    expect(describeMode('eager')).toContain('auto-fire 65%');
    expect(describeMode('standard')).toContain('standard');
    expect(describeMode('standard')).toContain('auto-fire 80%');
  });

  it('when the legacy alias is described, should read as the profile it means', () => {
    // given: the legacy alias `partial`
    // when: it is described
    // then: the description is the eager profile's own
    expect(describeMode('partial')).toBe(describeMode('eager'));
  });
});

describe('a11y — the description says what the profile does', () => {
  it('when a mode is described, should not attribute the profile to a mode', () => {
    // given: the rendered description of a profile
    // when: it is read
    // then: it names no mode at all
    expect(describeMode('eager')).not.toMatch(/24h/i);
    expect(describeMode('standard')).not.toMatch(/24h/i);
  });

  it('when a mode is described, should say it fires earlier and not promise compaction', () => {
    // given: the rendered description of the eager profile
    // when: it is read
    // then: it says the profile fires earlier and promises no compaction
    expect(describeMode('eager')).toContain('fires earlier');
    expect(describeMode('eager')).not.toMatch(/partial/i);
  });
});
