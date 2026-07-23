/**
 * Task 1.4 — two-level manual fallback after circuit opens.
 *
 * The decision is a pure function over already-certified provider
 * metadata + the session circuit state. Core never detects a host,
 * never invents a slash command, never parses the host's hint bytes,
 * and never bypasses the metadata digest it was given
 * (design §10.3, §11.2; §2.3 vendor-neutrality red line).
 *
 * Why this is a separate module (not a method on the circuit-breaker):
 *   - the circuit policy owns persistence + count invariants;
 *   - this module owns "what should we *show* the user now?" —
 *     a pure consumer of the persistence layer;
 *   - coordinate concerns (logging the prompt, flipping
 *     `manualPromptShown`) stay with the coordinator slice (1.5).
 *
 * Deterministic digest: the three observed fields
 * (`providerId`, `naturalLanguageActionAvailable`,
 * `hostNativeDisplayHint`) are canonicalised in fixed key order
 * and hashed with SHA-256. The provider that emits the metadata
 * pre-computes the digest over the same canonicalisation; this
 * module only re-runs the canonicalisation and compares. The
 * canonicalisation is exposed (`computeManualMetadataDigest`) so
 * providers and tests share one reference implementation.
 *
 * --- hardening note ---
 * `verifyManualMetadataDigest` returns false on ANY irregularity
 * (bad shape, wrong digest, tampered field, non-hex digest string).
 * There is no "trust on absence of digest" or "trust on
 * single-source match" path; an unverified metadata object is
 * structurally indistinguishable from a missing one and both fall
 * through to `remain-blocked`.
 */
import { createHash } from 'node:crypto';
import type { CompactSessionCircuitState } from './attempt-store.js';

/**
 * The single, fixed, vendor-neutral label offered at the natural-
 * language multi-choice level. Exported so the provider layer and
 * tests can pin against the exact string.
 *
 * Per design §10.3 + §11.2 and the Human-NL-Choice-Only tenet, this
 * is the ONLY user-facing label the core emits at level 1. No
 * vendor name, no slash command, no English paraphrase.
 */
export const MANUAL_FALLBACK_LABEL = '手动压缩当前会话' as const;

/**
 * Metadata supplied by a certified host bridge about how the user
 * can manually compact the current session from inside the host.
 *
 * The producer (a certified provider) MUST populate
 * `metadataDigest` with the hex SHA-256 of the canonical JSON of
 * the observed fields; the core re-derives the digest and refuses
 * to act on a metadata object whose digest does not verify.
 */
export interface CertifiedManualCompactMetadata {
  readonly schemaVersion: 1;
  readonly providerId: string;
  readonly naturalLanguageActionAvailable: boolean;
  /**
   * Opaque, host-chosen text to display to the user ONLY when the
   * natural-language choice is unavailable. The core treats the
   * string as a byte sequence; it never parses, classifies, or
   * recognises it as a command. Empty / null means the provider
   * cannot supply a hint and the core must remain blocked at
   * level 2.
   */
  readonly hostNativeDisplayHint: string | null;
  /**
   * Hex SHA-256 over the canonical JSON of the three observed
   * fields. Required; an empty / missing / non-hex value is
   * treated as unverified.
   */
  readonly metadataDigest: string;
}

/**
 * The user-facing decision the coordinator will emit at level 1 or
 * level 2 of the §10.3 fallback. Discriminated union, exhaustive.
 */
export type ManualFallbackDecision =
  | { readonly kind: 'offer-natural-language-choice'; readonly label: typeof MANUAL_FALLBACK_LABEL }
  | { readonly kind: 'show-host-native-hint-once'; readonly hint: string }
  | { readonly kind: 'remain-blocked' };

export interface DecideManualFallbackInput {
  readonly metadata: CertifiedManualCompactMetadata | null;
  readonly circuit: CompactSessionCircuitState;
}

/**
 * Pure decision function. Given (a) already-certified metadata from
 * the bridge and (b) the current session circuit state, returns the
 * single next action the coordinator should emit. Never mutates the
 * circuit (the coordinator layer owns the `manualPromptShown`
 * transition); never inspects the hint as a command.
 */
export function decideManualFallback(
  input: DecideManualFallbackInput
): ManualFallbackDecision {
  // (1) The fallback only fires while the circuit is `open`. `closed`
  // means no fallback warranted; `awaiting-manual-observation` means
  // we already acted once and are now waiting for the host to confirm
  // completion — re-prompting would burn tokens for nothing (§10.3).
  if (input.circuit.circuit !== 'open') {
    return { kind: 'remain-blocked' };
  }

  // (2) Absence of metadata is treated identically to unverified
  // metadata. There is no path that trusts metadata on a missing
  // digest.
  if (input.metadata === null) {
    return { kind: 'remain-blocked' };
  }

  // (3) Reject any metadata whose digest does not match the
  // canonical SHA-256 over the observed fields. This includes a
  // missing/empty/non-hex digest string AND a tampered field.
  if (!verifyManualMetadataDigest(input.metadata)) {
    return { kind: 'remain-blocked' };
  }

  // (4) Already-shown latch: never re-prompt. This applies to BOTH
  // levels (natural-language choice AND host-native hint). The
  // "failed manual observation → remain blocked" rule (design
  // §10.3 final paragraph) is also covered: a failed observation
  // never clears `manualPromptShown`.
  if (input.circuit.manualPromptShown) {
    return { kind: 'remain-blocked' };
  }

  // (5) Level 1 — natural-language multi-choice. Preferred because
  // it preserves the Human-NL-Choice-Only tenet end-to-end.
  if (input.metadata.naturalLanguageActionAvailable) {
    return {
      kind: 'offer-natural-language-choice',
      label: MANUAL_FALLBACK_LABEL
    };
  }

  // (6) Level 2 — host-native hint. Fires only when the bridge
  // cannot map level 1 to a host action. The hint is opaque; we
  // pass it through unchanged after a single shape check (non-null,
  // non-empty).
  const hint = input.metadata.hostNativeDisplayHint;
  if (typeof hint === 'string' && hint.length > 0) {
    return {
      kind: 'show-host-native-hint-once',
      hint
    };
  }

  // (7) All gates exhausted (e.g., metadata exists, digest verifies,
  // circuit is open, prompt not yet shown, but the provider offers
  // neither a mapping nor a hint). Stay blocked; do not invent
  // output. The coordinator may surface an honest "cannot compact"
  // status from this.
  return { kind: 'remain-blocked' };
}

/**
 * Deterministic canonical SHA-256 over the three observed fields.
 *
 * Canonicalisation rule: JSON.stringify with the object's keys
 * emitted in the SAME fixed order every call
 * (providerId, naturalLanguageActionAvailable, hostNativeDisplayHint).
 * The provider that emits `CertifiedManualCompactMetadata` MUST
 * compute the digest against the same canonicalisation; any drift
 * here is a contract break and will be caught by
 * `verifyManualMetadataDigest`.
 *
 * Exposed for the provider layer and for tests.
 */
export function computeManualMetadataDigest(
  metadata: CertifiedManualCompactMetadata
): string {
  const canonical = JSON.stringify({
    providerId: metadata.providerId,
    naturalLanguageActionAvailable: metadata.naturalLanguageActionAvailable,
    hostNativeDisplayHint: metadata.hostNativeDisplayHint
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Returns true iff `metadata.metadataDigest` equals the SHA-256 of
 * the canonical JSON of the three observed fields AND the digest
 * field itself is a 64-character lowercase/uppercase hex string.
 * Returns false on any irregularity (this module never throws on a
 * malformed metadata object — the caller treats false as "blocked").
 */
export function verifyManualMetadataDigest(
  metadata: CertifiedManualCompactMetadata
): boolean {
  const claimed = metadata.metadataDigest;
  if (typeof claimed !== 'string' || claimed.length !== 64) {
    return false;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(claimed)) {
    return false;
  }
  const expected = computeManualMetadataDigest(metadata);
  // Length-equal hex strings compared with a constant-time-ish loop
  // to avoid a naive early-exit; this is the only shape-dependent
  // comparison in the module.
  let diff = 0;
  for (let i = 0; i < 64; i += 1) {
    diff |= claimed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
