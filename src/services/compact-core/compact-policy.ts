/**
 * Strong-guarantee admission policy (design §5, §12.3).
 *
 * `decideCompactPath` is a pure function over a capability profile and the
 * provider's certification level. It never inspects a vendor name and has
 * no side effects. It returns exactly one of four discriminated outcomes;
 * there are deliberately no optional escape hatches.
 *
 * Admission rules (design §5):
 *   Native (§5.1): nativeCompact === 'invoke-and-observe' AND
 *     progressSurface !== 'none' AND continuation === 'same-ui' AND
 *     completionSignal !== 'none'.
 *   Fallback (§5.2): contextReplacement === 'in-place' AND
 *     progressSurface !== 'none' AND continuation === 'same-ui' AND
 *     rollbackSupport !== 'none' AND
 *     (contextMeasurement !== 'none' OR
 *       (certification === 'certified-strong' AND
 *         completionSignal === 'event-with-measurement')).
 *   `new-ui` continuation can only ever yield the consent-required result.
 *
 * The §5.2 trailing clause is the *quality gate* on fallback: without an
 * independent measurement source we cannot verify that context actually
 * dropped (§9.2). A provider only earns the event-with-measurement escape
 * when the conformance runner has certified its host-event receipts as
 * trustworthy.
 */
import type { CapabilityProfile } from './protocol/capability-profile.js';

/** Certification level assigned to the provider by the conformance runner. */
export type ProviderCertification =
  | 'certified-strong'
  | 'native-only'
  | 'safe-handoff'
  | 'unsupported';

/** The sole strong-guarantee blocking code (design §5.3). */
export const AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE = 'AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE' as const;

/** The four possible admission outcomes. No escape hatches. */
export type CompactPathDecision =
  | { readonly kind: 'native' }
  | { readonly kind: 'fallback' }
  | { readonly kind: 'safe-handoff-consent-required' }
  | { readonly kind: 'blocked'; readonly code: typeof AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE };

/** True when the profile satisfies the native strong-guarantee rule (§5.1). */
function isNativeAdmissible(profile: CapabilityProfile): boolean {
  return (
    profile.nativeCompact === 'invoke-and-observe' &&
    profile.progressSurface !== 'none' &&
    profile.continuation === 'same-ui' &&
    profile.completionSignal !== 'none'
  );
}

/**
 * True when the profile satisfies the fallback strong-guarantee *structural*
 * rule (§5.2). The measurement/quality gate is applied separately because
 * it depends on the provider's certification.
 */
function hasFallbackStructure(profile: CapabilityProfile): boolean {
  return (
    profile.contextReplacement === 'in-place' &&
    profile.progressSurface !== 'none' &&
    profile.continuation === 'same-ui' &&
    profile.rollbackSupport !== 'none'
  );
}

/**
 * §5.2 quality gate. Either the host can independently measure context, or
 * the provider is `certified-strong` *and* its completion event itself
 * carries host-trusted pre/post measurement. Without one of these we cannot
 * verify the compact actually reduced context (design §9.2).
 */
function hasFallbackMeasurementGate(
  profile: CapabilityProfile,
  certification: ProviderCertification
): boolean {
  if (profile.contextMeasurement !== 'none') {
    return true;
  }
  return (
    certification === 'certified-strong' && profile.completionSignal === 'event-with-measurement'
  );
}

/** True when the profile + certification satisfy the full fallback rule (§5.2). */
function isFallbackAdmissible(
  profile: CapabilityProfile,
  certification: ProviderCertification
): boolean {
  return hasFallbackStructure(profile) && hasFallbackMeasurementGate(profile, certification);
}

const BLOCKED: CompactPathDecision = {
  kind: 'blocked',
  code: AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE
};

/**
 * Decide which compact path (if any) a session may take under the strong
 * guarantee. Pure; deterministic; vendor-neutral.
 *
 * - `unsupported`: always blocked.
 * - `safe-handoff`: never auto-executes; yields consent-required.
 * - `native-only`: native path if native-admissible, else blocked.
 * - `certified-strong`: native path if native-admissible; else fallback
 *   path if fallback-admissible; else blocked.
 */
export function decideCompactPath(input: {
  readonly profile: CapabilityProfile;
  readonly certification: ProviderCertification;
}): CompactPathDecision {
  const { profile, certification } = input;

  switch (certification) {
    case 'unsupported':
      return BLOCKED;
    case 'safe-handoff':
      return { kind: 'safe-handoff-consent-required' };
    case 'native-only':
      return isNativeAdmissible(profile) ? { kind: 'native' } : BLOCKED;
    case 'certified-strong':
      if (isNativeAdmissible(profile)) {
        return { kind: 'native' };
      }
      if (isFallbackAdmissible(profile, certification)) {
        return { kind: 'fallback' };
      }
      return BLOCKED;
    default: {
      const exhaustive: never = certification;
      return exhaustive;
    }
  }
}
