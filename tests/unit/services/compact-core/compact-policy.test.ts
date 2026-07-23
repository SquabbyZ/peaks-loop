/**
 * Task 1.1 — strong-guarantee admission policy (`decideCompactPath`).
 *
 * Pins the exact decision-matrix cases from the task brief and the
 * capability-first admission rules in design §5 / §12.3. The policy is a
 * pure function over a CapabilityProfile plus a certification level; it
 * has no I/O and no vendor knowledge.
 */
import { describe, expect, it } from 'vitest';
import type { CapabilityProfile } from '../../../../src/services/compact-core/index.js';
import { decideCompactPath } from '../../../../src/services/compact-core/index.js';

const baseProfile: CapabilityProfile = {
  schemaVersion: 1,
  contextMeasurement: 'exact',
  nativeCompact: 'invoke-and-observe',
  contextReplacement: 'in-place',
  progressSurface: 'native',
  continuation: 'same-ui',
  completionSignal: 'event-with-measurement',
  rollbackSupport: 'transactional',
  capabilityEpoch: 'epoch-1'
};

// Native-admissible: invoke-and-observe + progress + same-ui + completion signal.
const nativeProfile: CapabilityProfile = { ...baseProfile };

// Fallback-admissible but NOT native-admissible: no observable native compact,
// but in-place replacement + progress + same-ui + rollback are present.
const fallbackProfile: CapabilityProfile = {
  ...baseProfile,
  nativeCompact: 'none',
  completionSignal: 'remeasure'
};

// new-ui continuation can never pass strong-guarantee admission.
const newUiProfile: CapabilityProfile = {
  ...baseProfile,
  continuation: 'new-ui'
};

// invoke-only is insufficient: successful invocation does not prove completion.
const invokeOnlyProfile: CapabilityProfile = {
  ...baseProfile,
  nativeCompact: 'invoke-only'
};

describe('decideCompactPath — exact brief cases', () => {
  it('native-only certification with a native-admissible profile → native', () => {
    expect(decideCompactPath({ profile: nativeProfile, certification: 'native-only' })).toEqual({
      kind: 'native'
    });
  });

  it('certified-strong with a fallback-only profile → fallback', () => {
    expect(decideCompactPath({ profile: fallbackProfile, certification: 'certified-strong' })).toEqual({
      kind: 'fallback'
    });
  });

  it('safe-handoff certification → consent required', () => {
    expect(decideCompactPath({ profile: newUiProfile, certification: 'safe-handoff' })).toEqual({
      kind: 'safe-handoff-consent-required'
    });
  });

  it('invoke-only under native-only → blocked', () => {
    expect(decideCompactPath({ profile: invokeOnlyProfile, certification: 'native-only' }).kind).toBe(
      'blocked'
    );
  });
});

describe('decideCompactPath — additional invariants', () => {
  it('blocked result carries the strong-guarantee code', () => {
    const decision = decideCompactPath({ profile: invokeOnlyProfile, certification: 'native-only' });
    expect(decision).toEqual({ kind: 'blocked', code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE' });
  });

  it('unsupported certification is always blocked, even with a full profile', () => {
    expect(decideCompactPath({ profile: nativeProfile, certification: 'unsupported' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  it('certified-strong prefers native when the profile is native-admissible', () => {
    expect(decideCompactPath({ profile: nativeProfile, certification: 'certified-strong' })).toEqual({
      kind: 'native'
    });
  });

  it('certified-strong falls back when native admission fails but fallback admission holds', () => {
    expect(decideCompactPath({ profile: fallbackProfile, certification: 'certified-strong' })).toEqual({
      kind: 'fallback'
    });
  });

  it('native admission requires an observable progress surface', () => {
    const noProgress: CapabilityProfile = { ...nativeProfile, progressSurface: 'none' };
    expect(decideCompactPath({ profile: noProgress, certification: 'native-only' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  it('native admission requires same-ui continuation', () => {
    const newUiNative: CapabilityProfile = { ...nativeProfile, continuation: 'new-ui' };
    expect(decideCompactPath({ profile: newUiNative, certification: 'native-only' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  it('native admission requires a completion signal', () => {
    const noSignal: CapabilityProfile = { ...nativeProfile, completionSignal: 'none' };
    expect(decideCompactPath({ profile: noSignal, certification: 'native-only' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  it('certified-strong fallback admission requires rollback support', () => {
    const noRollback: CapabilityProfile = {
      ...fallbackProfile,
      rollbackSupport: 'none'
    };
    expect(decideCompactPath({ profile: noRollback, certification: 'certified-strong' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  it('certified-strong fallback admission requires in-place replacement', () => {
    const noInPlace: CapabilityProfile = {
      ...fallbackProfile,
      contextReplacement: 'none'
    };
    expect(decideCompactPath({ profile: noInPlace, certification: 'certified-strong' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  it('new-ui profile can only ever produce the consent-required result (never native/fallback)', () => {
    // Under safe-handoff → consent required.
    expect(decideCompactPath({ profile: newUiProfile, certification: 'safe-handoff' }).kind).toBe(
      'safe-handoff-consent-required'
    );
    // Under any auto certification, new-ui fails admission → blocked, never native/fallback.
    expect(decideCompactPath({ profile: newUiProfile, certification: 'native-only' }).kind).toBe('blocked');
    expect(decideCompactPath({ profile: newUiProfile, certification: 'certified-strong' }).kind).toBe(
      'blocked'
    );
  });
});
