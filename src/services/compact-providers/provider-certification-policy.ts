/**
 * Provider certification policy — Phase 3 Task 3.2.
 *
 * Compares a live `CapabilityProfile` (just probed) against the on-disk
 * `CompactProviderCertification`. The core never branches on the provider
 * ID — it only consumes the four-axis strength verdict:
 *
 *   - certified-strong: native AND fallback admissible
 *   - native-only:      only native admissible
 *   - safe-handoff:     never auto-executes (consent required)
 *   - unsupported:      admit nothing (blocked)
 *
 * Live profile can REDUCE the recorded strength (e.g. capabilityEpoch
 * changed) but can never ELEVATE it. A provider that lied about its
 * capabilities gets a no-attachment answer.
 */
import type { CapabilityProfile } from '../compact-core/protocol/capability-profile.js';
import type { CompactProviderCertification } from './compact-capability-provider.js';
import { createHash } from 'node:crypto';

export type EffectiveCertification =
  | { readonly kind: 'certified-strong' }
  | { readonly kind: 'native-only' }
  | { readonly kind: 'safe-handoff' }
  | { readonly kind: 'unsupported' };

const STRENGTH_RANK: Record<EffectiveCertification['kind'], number> = {
  'certified-strong': 3,
  'native-only': 2,
  'safe-handoff': 1,
  'unsupported': 0
};

/**
 * Recompute the capability hash from a live `CapabilityProfile`. Stable across
 * key reorderings (uses canonical JSON).
 */
export function computeCapabilityHash(profile: CapabilityProfile): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(profile).sort()) {
    sorted[key] = (profile as unknown as Record<string, unknown>)[key];
  }
  const json = JSON.stringify(sorted);
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

/**
 * Effective certification is the LOWER of (a) the recorded certificationLevel
 * and (b) the live profile's capabilities. A recorded "certified-strong" with
 * a profile that lacks an in-place capability drops to "native-only" or
 * "safe-handoff". A recorded "unsupported" never elevates — even if the
 * live profile looks perfect, the recorded ceiling caps the result.
 */
export function evaluateCertification(
  recorded: CompactProviderCertification,
  liveProfile: CapabilityProfile
): EffectiveCertification {
  // 1. Derive what the live profile is actually capable of. Per design §5:
  //    a) unsupported if it can neither invoke native nor replace in place;
  //    b) safe-handoff if it can replace in place but not measure or invoke
  //       and observe the result;
  //    c) native-only if it can invoke native and observe but not in place;
  //    d) certified-strong if it can invoke native, observe, AND in-place.
  let liveCapable: EffectiveCertification['kind'];
  if (
    liveProfile.nativeCompact === 'none' ||
    liveProfile.nativeCompact === 'invoke-only'
  ) {
    // No native compact at all → can't even attempt strong. If in-place
    // replacement is available, the operator can still manually replace;
    // otherwise unsupported.
    if (liveProfile.contextReplacement !== 'in-place') {
      liveCapable = 'unsupported';
    } else {
      liveCapable = 'safe-handoff';
    }
  } else if (liveProfile.contextReplacement !== 'in-place') {
    // Native invoke + observe works, but no in-place replace → fallback
    // path is closed; only native-only is safe.
    liveCapable = 'native-only';
  } else if (
    liveProfile.contextMeasurement === 'none' ||
    liveProfile.continuation !== 'same-ui'
  ) {
    // In-place works and native works, but no completion signal / not
    // same-ui → can't verify or resume safely. Safe-handoff.
    liveCapable = 'safe-handoff';
  } else {
    liveCapable = 'certified-strong';
  }

  // 2. Cap by the recorded level — never elevate.
  const recordedRank = STRENGTH_RANK[recorded.certificationLevel];
  const liveRank = STRENGTH_RANK[liveCapable];
  if (liveRank <= recordedRank) return { kind: liveCapable };
  return { kind: recorded.certificationLevel };
}

export class CertificationReducedError extends Error {
  override readonly name = 'CertificationReducedError';
  constructor(public readonly recorded: CompactProviderCertification['certificationLevel'], public readonly effective: EffectiveCertification) {
    super(
      `certification reduced from "${recorded}" to "${effective.kind}"; live capability profile does not support the stronger guarantee`
    );
  }
}

export class CertificationCapabilityHashMismatchError extends Error {
  override readonly name = 'CertificationCapabilityHashMismatchError';
  constructor(public readonly recorded: string, public readonly live: string) {
    super(
      `capabilityHash mismatch: recorded=${recorded} live=${live}; provider implementation has drifted from certification evidence`
    );
  }
}

export interface CertificationDecision {
  readonly effective: EffectiveCertification;
  readonly attachable: boolean;
  readonly hashMatches: boolean;
}

/**
 * Run the full certification decision: hash check + effective strength +
 * attachable verdict. A `safe-handoff` is never auto-attached; a
 * mismatch is never silently accepted; an `unsupported` is never attached.
 */
export function decideAttachment(
  recorded: CompactProviderCertification,
  liveProfile: CapabilityProfile,
  options: { now: Date; requireHashMatch?: boolean } = { now: new Date() }
): CertificationDecision {
  const liveHash = computeCapabilityHash(liveProfile);
  const hashMatches = liveHash === recorded.capabilityHash;
  const effective = evaluateCertification(recorded, liveProfile);
  const attachable =
    hashMatches &&
    (options.requireHashMatch !== false) &&
    effective.kind === 'certified-strong';
  return { effective, attachable, hashMatches };
}
