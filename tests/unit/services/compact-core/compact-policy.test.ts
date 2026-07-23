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

describe('decideCompactPath — §5.2 fallback quality gate (measurement / completion signal)', () => {
  // Profile that is otherwise structurally fallback-eligible: in-place, progress,
  // same-ui, rollback, nativeCompact='none'. The only knob we vary is the
  // measurement + completion-signal combination.
  const fallbackStructOnly: CapabilityProfile = {
    schemaVersion: 1,
    contextMeasurement: 'exact',
    nativeCompact: 'none',
    contextReplacement: 'in-place',
    progressSurface: 'native',
    continuation: 'same-ui',
    completionSignal: 'remeasure',
    rollbackSupport: 'transactional',
    capabilityEpoch: 'epoch-1'
  };

  // Sanity: this profile is the canonical fallback-admissible shape → fallback.
  it('baseline: structural-only fallback profile + remeasure under certified-strong → fallback', () => {
    expect(decideCompactPath({ profile: fallbackStructOnly, certification: 'certified-strong' })).toEqual({
      kind: 'fallback'
    });
  });

  // NEGATIVE 1 (the blocking bug): measurement 'none' + completion 'remeasure'
  // — no independent measurement source AND no event-with-measurement → blocked.
  it('certified-strong with contextMeasurement=none + completionSignal=remeasure → blocked', () => {
    const noneRemeasure: CapabilityProfile = {
      ...fallbackStructOnly,
      contextMeasurement: 'none',
      completionSignal: 'remeasure'
    };
    expect(decideCompactPath({ profile: noneRemeasure, certification: 'certified-strong' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  // POSITIVE: measurement 'none' is acceptable only when the provider is
  // certified-strong AND the event itself carries host-trusted measurement.
  it('certified-strong with contextMeasurement=none + completionSignal=event-with-measurement → fallback', () => {
    const noneEventMeasured: CapabilityProfile = {
      ...fallbackStructOnly,
      contextMeasurement: 'none',
      completionSignal: 'event-with-measurement'
    };
    expect(decideCompactPath({ profile: noneEventMeasured, certification: 'certified-strong' })).toEqual({
      kind: 'fallback'
    });
  });

  // Non-strong certifications cannot use the event-with-measurement escape:
  // they have no certified event source to trust.
  it('same none+event-with-measurement profile under native-only → blocked', () => {
    const noneEventMeasured: CapabilityProfile = {
      ...fallbackStructOnly,
      contextMeasurement: 'none',
      completionSignal: 'event-with-measurement'
    };
    expect(decideCompactPath({ profile: noneEventMeasured, certification: 'native-only' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });

  // Negative: pure measurement capability with remeasure signal remains admissible
  // (this is the canonical fallback-admissible path; pin to lock in).
  it('certified-strong with contextMeasurement=exact + completionSignal=remeasure → fallback', () => {
    const exactRemeasure: CapabilityProfile = {
      ...fallbackStructOnly,
      contextMeasurement: 'exact',
      completionSignal: 'remeasure'
    };
    expect(decideCompactPath({ profile: exactRemeasure, certification: 'certified-strong' })).toEqual({
      kind: 'fallback'
    });
  });

  // Negative structural cases (still relevant): a fallback profile that is
  // missing measurement entirely under native-only is irrelevant (native-only
  // never uses fallback), but ensure the certification arm is unchanged.
  it('certified-strong with measurement=none and completion=none → blocked (no signal either)', () => {
    const noneNone: CapabilityProfile = {
      ...fallbackStructOnly,
      contextMeasurement: 'none',
      completionSignal: 'none'
    };
    expect(decideCompactPath({ profile: noneNone, certification: 'certified-strong' })).toEqual({
      kind: 'blocked',
      code: 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE'
    });
  });
});
