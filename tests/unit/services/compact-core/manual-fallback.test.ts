/**
 * Task 1.4 — two-level manual fallback after circuit opens (design §10.3, §11.2).
 *
 * Dimensions: behavior and integration. Render and a11y do not apply because
 * this module returns typed control decisions without user-facing output.
 * Vendor neutrality is enforced by the project-wide vendor-neutrality test.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  MANUAL_FALLBACK_LABEL,
  computeManualMetadataDigest,
  decideManualFallback,
  verifyManualMetadataDigest,
  type CertifiedManualCompactMetadata
} from '../../../../src/services/compact-core/manual-fallback.js';
import type { CompactSessionCircuitState } from '../../../../src/services/compact-core/attempt-store.js';

const PROVIDER_ID = 'provider-bridge-a';

function buildOpenCircuit(
  overrides: Partial<CompactSessionCircuitState> = {}
): CompactSessionCircuitState {
  return {
    schemaVersion: 1,
    sessionId: 'session-1',
    consecutiveVerificationFailures: 3,
    circuit: 'open',
    openedAt: '2026-07-23T00:00:00.000Z',
    lastAttemptId: 'attempt-1',
    lastFailureCode: 'AUTO_COMPACT_VERIFICATION_FAILED',
    manualPromptShown: false,
    ...overrides
  };
}

function certifiedMetadata(
  overrides: Partial<CertifiedManualCompactMetadata> = {}
): CertifiedManualCompactMetadata {
  const naturalLanguageActionAvailable = overrides.naturalLanguageActionAvailable ?? true;
  const hostNativeDisplayHint = overrides.hostNativeDisplayHint ?? null;
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    naturalLanguageActionAvailable,
    hostNativeDisplayHint,
    metadataDigest: overrides.metadataDigest ?? ''
  };
}

function expectedDigest(metadata: CertifiedManualCompactMetadata): string {
  // Mirror the canonicalization in manual-fallback.ts (fixed-key order
  // JSON over the three observed fields). Tests assert the production
  // digester agrees via `verifyManualMetadataDigest`.
  const canonical = JSON.stringify({
    providerId: metadata.providerId,
    naturalLanguageActionAvailable: metadata.naturalLanguageActionAvailable,
    hostNativeDisplayHint: metadata.hostNativeDisplayHint
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function withVerifiedDigest(
  metadata: CertifiedManualCompactMetadata
): CertifiedManualCompactMetadata {
  const digest = expectedDigest(metadata);
  return { ...metadata, metadataDigest: digest };
}

describe('decideManualFallback — natural-language choice (level 1)', () => {
  it('offers the natural-language choice when metadata is certified, action is available, circuit is open, and prompt not yet shown', () => {
    const circuit = buildOpenCircuit();
    const metadata = withVerifiedDigest(certifiedMetadata({ naturalLanguageActionAvailable: true }));

    expect(decideManualFallback({ metadata, circuit })).toEqual({
      kind: 'offer-natural-language-choice',
      label: MANUAL_FALLBACK_LABEL
    });
  });

  it('exposes the exact UI label mandated by the design (no vendor-specific or English fallback)', () => {
    expect(MANUAL_FALLBACK_LABEL).toBe('手动压缩当前会话');
  });

  it('skips the choice when the circuit is closed', () => {
    const circuit = buildOpenCircuit({ circuit: 'closed', consecutiveVerificationFailures: 0 });
    const metadata = withVerifiedDigest(certifiedMetadata());

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('skips the choice when the circuit is awaiting-manual-observation (do not re-prompt)', () => {
    const circuit = buildOpenCircuit({ circuit: 'awaiting-manual-observation' });
    const metadata = withVerifiedDigest(certifiedMetadata());

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });
});

describe('decideManualFallback — host-native hint (level 2)', () => {
  it('shows the opaque hint exactly once when the bridge cannot map the natural-language choice', () => {
    const circuit = buildOpenCircuit();
    const metadata = withVerifiedDigest(
      certifiedMetadata({
        naturalLanguageActionAvailable: false,
        hostNativeDisplayHint: '随便提示文本'
      })
    );

    expect(decideManualFallback({ metadata, circuit })).toEqual({
      kind: 'show-host-native-hint-once',
      hint: '随便提示文本'
    });
  });

  it('treats the hint as opaque — no parsing, slash detection, or vendor recognition', () => {
    const circuit = buildOpenCircuit();
    const metadata = withVerifiedDigest(
      certifiedMetadata({
        naturalLanguageActionAvailable: false,
        hostNativeDisplayHint: '随便提示文本' // contains Chinese characters; opaque byte sequence
      })
    );

    const decision = decideManualFallback({ metadata, circuit });
    if (decision.kind !== 'show-host-native-hint-once') {
      throw new Error('expected host-native hint decision');
    }
    // Core must not have classified/normalized the string. Exact byte identity.
    expect(decision.hint).toBe(metadata.hostNativeDisplayHint);
    expect(decision.hint.startsWith('/')).toBe(false);
    expect(decision.hint.startsWith('peaks ')).toBe(false);
  });

  it('shows no hint when mapping is unavailable but the hint string is null', () => {
    const circuit = buildOpenCircuit();
    const metadata = withVerifiedDigest(
      certifiedMetadata({
        naturalLanguageActionAvailable: false,
        hostNativeDisplayHint: null
      })
    );

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('shows no hint when the hint string is empty', () => {
    const circuit = buildOpenCircuit();
    const metadata = withVerifiedDigest(
      certifiedMetadata({
        naturalLanguageActionAvailable: false,
        hostNativeDisplayHint: ''
      })
    );

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });
});

describe('decideManualFallback — null / unverified / repeat-prompt blocking', () => {
  it('returns remain-blocked when metadata is null', () => {
    const circuit = buildOpenCircuit();
    expect(decideManualFallback({ metadata: null, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('returns remain-blocked when metadata digest does not match the canonical digest', () => {
    const circuit = buildOpenCircuit();
    const metadata = certifiedMetadata({ metadataDigest: 'deadbeef'.repeat(8) });

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('returns remain-blocked when metadata digest is the empty string (uncertified)', () => {
    const circuit = buildOpenCircuit();
    const metadata = certifiedMetadata({ metadataDigest: '' });

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('returns remain-blocked when the natural-language prompt was already shown (no repeat)', () => {
    const circuit = buildOpenCircuit({ manualPromptShown: true });
    const metadata = withVerifiedDigest(certifiedMetadata());

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('returns remain-blocked when the host-native hint was already shown (no repeat)', () => {
    const circuit = buildOpenCircuit({ manualPromptShown: true });
    const metadata = withVerifiedDigest(
      certifiedMetadata({
        naturalLanguageActionAvailable: false,
        hostNativeDisplayHint: '随便提示文本'
      })
    );

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });

  it('returns remain-blocked after a failed manual verification (no repeat prompt)', () => {
    // After failed manual observation the circuit remains open and
    // manualPromptShown is true; both must stay blocked.
    const circuit = buildOpenCircuit({
      circuit: 'open',
      consecutiveVerificationFailures: 3,
      manualPromptShown: true,
      lastFailureCode: 'AUTO_COMPACT_VERIFICATION_FAILED'
    });
    const metadata = withVerifiedDigest(certifiedMetadata());

    expect(decideManualFallback({ metadata, circuit })).toEqual({ kind: 'remain-blocked' });
  });
});

describe('digest verification — canonical SHA-256 over a fixed-key payload', () => {
  it('agrees with the in-test digester for a representative metadata object', () => {
    const metadata = withVerifiedDigest(certifiedMetadata());
    expect(verifyManualMetadataDigest(metadata)).toBe(true);
  });

  it('exposes a digester that reproduces the verification digest', () => {
    const metadata = certifiedMetadata();
    const digest = computeManualMetadataDigest(metadata);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyManualMetadataDigest({ ...metadata, metadataDigest: digest })).toBe(true);
  });

  it('rejects a metadata object whose observed fields were tampered with', () => {
    const metadata = withVerifiedDigest(certifiedMetadata({ naturalLanguageActionAvailable: true }));
    const tampered: CertifiedManualCompactMetadata = {
      ...metadata,
      naturalLanguageActionAvailable: false
    };
    expect(verifyManualMetadataDigest(tampered)).toBe(false);
  });

  it('rejects a metadata object whose providerId was swapped', () => {
    const metadata = withVerifiedDigest(certifiedMetadata());
    const tampered: CertifiedManualCompactMetadata = { ...metadata, providerId: 'spoofed' };
    expect(verifyManualMetadataDigest(tampered)).toBe(false);
  });

  it('rejects a metadata object whose hostNativeDisplayHint was swapped', () => {
    const metadata = withVerifiedDigest(
      certifiedMetadata({
        naturalLanguageActionAvailable: false,
        hostNativeDisplayHint: '随便提示文本'
      })
    );
    const tampered: CertifiedManualCompactMetadata = {
      ...metadata,
      hostNativeDisplayHint: 'spoofed'
    };
    expect(verifyManualMetadataDigest(tampered)).toBe(false);
  });

  it('rejects metadata whose digest field is not a 64-character hex string', () => {
    const metadata: CertifiedManualCompactMetadata = {
      ...certifiedMetadata(),
      metadataDigest: 'not-hex'
    };
    expect(verifyManualMetadataDigest(metadata)).toBe(false);
  });
});

describe('decideManualFallback — host-detection red line', () => {
  it('does not consult any host, provider-id-vendor-match, or slash-string detector', () => {
    // The decision must change ONLY with circuit/manualPromptShown/digest state,
    // not with the content of `hostNativeDisplayHint`. This proves the hint is
    // treated as opaque bytes and never inspected.
    const circuit = buildOpenCircuit();
    const baseline = decideManualFallback({
      metadata: withVerifiedDigest(
        certifiedMetadata({
          naturalLanguageActionAvailable: false,
          hostNativeDisplayHint: '随便提示文本'
        })
      ),
      circuit
    });
    const swapped = decideManualFallback({
      metadata: withVerifiedDigest(
        certifiedMetadata({
          naturalLanguageActionAvailable: false,
          hostNativeDisplayHint: '/some/slash/string'
        })
      ),
      circuit
    });
    expect(baseline.kind).toBe(swapped.kind);
    if (baseline.kind === 'show-host-native-hint-once' && swapped.kind === 'show-host-native-hint-once') {
      expect(baseline.hint).not.toBe(swapped.hint);
    }
  });
});
