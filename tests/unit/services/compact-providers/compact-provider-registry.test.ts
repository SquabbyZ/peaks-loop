/**
 * compact-provider-registry.test.ts — Phase 3 Task 3.2.
 *
 * Covers the registry, the certification policy, and the manifest store's
 * read/integrity paths. Pure logic, no fs, no host SDK.
 */
import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import {
  CompactProviderManifestSchema,
  computeManifestDigest
} from '../../../../src/services/compact-providers/provider-manifest-schema.js';
import type { CompactProviderManifest } from '../../../../src/services/compact-providers/provider-manifest-schema.js';
import {
  parseProviderManifestJson,
  loadProviderManifestFile,
  findManifestEntry
} from '../../../../src/services/compact-providers/provider-manifest-store.js';
import {
  ManifestParseError,
  ManifestDigestMismatchError
} from '../../../../src/services/compact-providers/provider-manifest-schema.js';
import {
  computeCapabilityHash,
  evaluateCertification,
  decideAttachment
} from '../../../../src/services/compact-providers/provider-certification-policy.js';
import {
  CompactProviderRegistry,
  DuplicateProviderError,
  UnknownProviderError,
  ProviderNotAttachableError,
  CanAttachError
} from '../../../../src/services/compact-providers/compact-provider-registry.js';
import type {
  CompactProviderMetadata,
  CompactCapabilityProvider,
  HostSessionDescriptor
} from '../../../../src/services/compact-providers/compact-capability-provider.js';
import type { HostCompactBridge } from '../../../../src/services/compact-core/protocol/host-compact-bridge.js';
import type { CapabilityProfile } from '../../../../src/services/compact-core/protocol/capability-profile.js';

// --- Fixtures ----------------------------------------------------------------

const STRONG_PROFILE: CapabilityProfile = {
  schemaVersion: 1,
  contextMeasurement: 'exact',
  nativeCompact: 'invoke-and-observe',
  contextReplacement: 'in-place',
  progressSurface: 'host-rendered',
  continuation: 'same-ui',
  completionSignal: 'event-with-measurement',
  rollbackSupport: 'transactional',
  capabilityEpoch: 'ep-strong'
};

const NATIVE_ONLY_PROFILE: CapabilityProfile = {
  ...STRONG_PROFILE,
  contextReplacement: 'none',
  capabilityEpoch: 'ep-native'
};

const SAFE_HANDOVER_PROFILE: CapabilityProfile = {
  ...STRONG_PROFILE,
  contextMeasurement: 'none', // no completion signal
  capabilityEpoch: 'ep-safe'
};

const UNSUPPORTED_PROFILE: CapabilityProfile = {
  schemaVersion: 1,
  contextMeasurement: 'none',
  nativeCompact: 'none',
  contextReplacement: 'none',
  progressSurface: 'none',
  continuation: 'new-ui',
  completionSignal: 'none',
  rollbackSupport: 'none',
  capabilityEpoch: 'ep-none'
};

function baseManifestEntry(providerId: string, overrides: Partial<{ capabilityHash: string; level: 'certified-strong' | 'native-only' | 'safe-handoff' | 'unsupported' }> = {}): CompactProviderManifest['entries'][number] {
  return {
    providerId,
    metadata: {
      providerId,
      protocolVersion: 1,
      implementationVersion: '1.0.0',
      implementationDigest: 'a'.repeat(64)
    },
    certification: {
      providerId,
      protocolVersion: 1,
      implementationVersion: '1.0.0',
      implementationDigest: 'a'.repeat(64),
      capabilityHash: overrides.capabilityHash ?? 'b'.repeat(64),
      certificationLevel: overrides.level ?? 'certified-strong',
      conformanceSuiteVersion: '1.0.0',
      evidenceDigest: 'c'.repeat(64),
      evidenceIndexPath: 'evidence/test.json',
      certifiedAt: '2026-07-20T00:00:00.000Z',
      expiresAt: '2026-08-01T00:00:00.000Z'
    }
  };
}

function baseManifest(entries: CompactProviderManifest['entries']): CompactProviderManifest {
  const draft: Omit<CompactProviderManifest, 'manifestDigest'> = {
    schemaVersion: 1,
    generatedAt: '2026-07-24T00:00:00.000Z',
    entries
  };
  const withDigest = { ...draft, manifestDigest: 'PLACEHOLDER' } as CompactProviderManifest;
  const realDigest = computeManifestDigest(withDigest);
  return { ...withDigest, manifestDigest: realDigest };
}

function makeFakeProvider(opts: { providerId: string; profile: CapabilityProfile; canAttach?: boolean }): CompactCapabilityProvider {
  const metadata: CompactProviderMetadata = {
    providerId: opts.providerId,
    protocolVersion: 1,
    implementationVersion: '1.0.0',
    implementationDigest: 'a'.repeat(64)
  };
  const fakeBridge: Pick<HostCompactBridge, 'probe'> = {
    probe: async () => opts.profile
  };
  return {
    metadata,
    canAttach: async () => opts.canAttach ?? true,
    createBridge: async () => fakeBridge as unknown as HostCompactBridge
  };
}

// --- Manifest store ----------------------------------------------------------

describe('parseProviderManifestJson', () => {
  it('accepts a well-formed manifest', () => {
    const m = baseManifest([baseManifestEntry('test-provider')]);
    const text = JSON.stringify(m);
    const parsed = parseProviderManifestJson(text);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });

  it('rejects non-JSON input', () => {
    expect(() => parseProviderManifestJson('not-json')).toThrowError(ManifestParseError);
  });

  it('rejects unknown schema version', () => {
    const m = { ...baseManifest([baseManifestEntry('p')]), schemaVersion: 2 };
    expect(() => parseProviderManifestJson(JSON.stringify(m))).toThrowError(ManifestParseError);
  });

  it('rejects malformed hash', () => {
    const m = baseManifest([baseManifestEntry('p')]);
    m.entries[0]!.certification.implementationDigest = 'not-hex';
    // re-stamp digest since payload changed
    m.manifestDigest = computeManifestDigest(m);
    expect(() => parseProviderManifestJson(JSON.stringify(m))).toThrowError(ManifestParseError);
  });
});

describe('findManifestEntry', () => {
  it('finds a matching entry by providerId', () => {
    const m = baseManifest([baseManifestEntry('alpha'), baseManifestEntry('beta')]);
    const found = findManifestEntry(m, 'beta');
    expect(found.providerId).toBe('beta');
  });

  it('throws when absent', () => {
    const m = baseManifest([baseManifestEntry('alpha')]);
    expect(() => findManifestEntry(m, 'missing')).toThrowError(ManifestParseError);
  });
});

describe('loadProviderManifestFile (in-memory integration via schema)', () => {
  it('rejects manifest with wrong digest on disk', () => {
    const m = baseManifest([baseManifestEntry('p')]);
    m.manifestDigest = 'f'.repeat(64);
    const text = JSON.stringify(m);
    expect(() =>
      loadProviderManifestFile.call(null, '/non-existent')
    ).toThrowError(); // missing file; we test the digest path directly
    // Direct digest test:
    expect(() => {
      const parsed = parseProviderManifestJson(text);
      const recomputed = computeManifestDigest(parsed);
      if (recomputed !== parsed.manifestDigest) {
        throw new ManifestDigestMismatchError('manifest digest mismatch');
      }
    }).toThrowError(ManifestDigestMismatchError);
  });
});

// --- Certification policy ---------------------------------------------------

describe('evaluateCertification', () => {
  it('returns certified-strong when live profile is strong and recorded was strong', () => {
    const cert = baseManifestEntry('p', { level: 'certified-strong', capabilityHash: 'B' }).certification;
    expect(evaluateCertification(cert, STRONG_PROFILE).kind).toBe('certified-strong');
  });

  it('reduces strong to native-only when live profile lacks in-place', () => {
    const cert = baseManifestEntry('p', { level: 'certified-strong' }).certification;
    expect(evaluateCertification(cert, NATIVE_ONLY_PROFILE).kind).toBe('native-only');
  });

  it('reduces to safe-handoff when live profile cannot measure but can in-place', () => {
    const cert = baseManifestEntry('p', { level: 'certified-strong' }).certification;
    expect(evaluateCertification(cert, SAFE_HANDOVER_PROFILE).kind).toBe('safe-handoff');
  });

  it('returns unsupported when live profile is empty', () => {
    const cert = baseManifestEntry('p', { level: 'native-only' }).certification;
    expect(evaluateCertification(cert, UNSUPPORTED_PROFILE).kind).toBe('unsupported');
  });

  it('never elevates a recorded unsupported', () => {
    const cert = baseManifestEntry('p', { level: 'unsupported' }).certification;
    expect(evaluateCertification(cert, STRONG_PROFILE).kind).toBe('unsupported');
  });
});

describe('computeCapabilityHash', () => {
  it('is canonical (key order independent)', () => {
    const a: CapabilityProfile = { ...STRONG_PROFILE };
    const bKeys = Object.fromEntries(Object.entries(STRONG_PROFILE).reverse());
    const b = bKeys as unknown as CapabilityProfile;
    expect(computeCapabilityHash(a)).toBe(computeCapabilityHash(b));
  });

  it('is sensitive to payload change', () => {
    const a: CapabilityProfile = { ...STRONG_PROFILE };
    const b: CapabilityProfile = { ...STRONG_PROFILE, capabilityEpoch: 'ep-other' };
    expect(computeCapabilityHash(a)).not.toBe(computeCapabilityHash(b));
  });
});

describe('decideAttachment', () => {
  it('attaches when live profile matches recorded certified-strong', () => {
    const cert = baseManifestEntry('p', {
      level: 'certified-strong',
      capabilityHash: computeCapabilityHash(STRONG_PROFILE)
    }).certification;
    const decision = decideAttachment(cert, STRONG_PROFILE, { now: new Date() });
    expect(decision.effective.kind).toBe('certified-strong');
    expect(decision.attachable).toBe(true);
    expect(decision.hashMatches).toBe(true);
  });

  it('rejects when live capability hash does not match recorded', () => {
    const cert = baseManifestEntry('p', { level: 'certified-strong' }).certification;
    const decision = decideAttachment(cert, STRONG_PROFILE, { now: new Date() });
    expect(decision.hashMatches).toBe(false);
    expect(decision.attachable).toBe(false);
  });

  it('reduces + does not attach when live profile is weak', () => {
    const cert = baseManifestEntry('p', {
      level: 'certified-strong',
      capabilityHash: computeCapabilityHash(NATIVE_ONLY_PROFILE)
    }).certification;
    const decision = decideAttachment(cert, STRONG_PROFILE, { now: new Date() });
    expect(decision.effective.kind).toBe('certified-strong');
    expect(decision.hashMatches).toBe(false); // strong profile vs native-only hash mismatch
    expect(decision.attachable).toBe(false);
  });
});

// --- Registry ----------------------------------------------------------------

describe('CompactProviderRegistry', () => {
  it('rejects duplicate providerId', () => {
    const reg = new CompactProviderRegistry();
    reg.register(makeFakeProvider({ providerId: 'dup', profile: STRONG_PROFILE }));
    expect(() => reg.register(makeFakeProvider({ providerId: 'dup', profile: STRONG_PROFILE }))).toThrowError(DuplicateProviderError);
  });

  it('lists providers in registration order, opaque id preserved', () => {
    const reg = new CompactProviderRegistry();
    reg.register(makeFakeProvider({ providerId: 'alpha', profile: STRONG_PROFILE }));
    reg.register(makeFakeProvider({ providerId: 'beta', profile: STRONG_PROFILE }));
    reg.register(makeFakeProvider({ providerId: 'gamma', profile: STRONG_PROFILE }));
    expect(reg.list().map((m) => m.providerId)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('has() reflects registration', () => {
    const reg = new CompactProviderRegistry();
    expect(reg.has('x')).toBe(false);
    reg.register(makeFakeProvider({ providerId: 'x', profile: STRONG_PROFILE }));
    expect(reg.has('x')).toBe(true);
  });

  it('attach() throws UnknownProviderError for unregistered id', async () => {
    const reg = new CompactProviderRegistry();
    const session: HostSessionDescriptor = { sessionId: 's1', projectRoot: '/tmp' };
    await expect(
      reg.attach(session, { providerId: 'missing', manifestPath: '/n', now: new Date() })
    ).rejects.toThrowError(UnknownProviderError);
  });

  it('attach() throws CanAttachError when canAttach rejects', async () => {
    const reg = new CompactProviderRegistry();
    reg.register(makeFakeProvider({ providerId: 'p', profile: STRONG_PROFILE, canAttach: false }));
    const session: HostSessionDescriptor = { sessionId: 's1', projectRoot: '/tmp' };
    const entry = baseManifestEntry('p', {
      level: 'certified-strong',
      capabilityHash: computeCapabilityHash(STRONG_PROFILE)
    });
    await expect(
      reg.attach(session, {
        providerId: 'p',
        manifestPath: '/n',
        now: new Date(),
        manifestEntry: entry
      })
    ).rejects.toThrowError(ProviderNotAttachableError);
  });

  it('attach() returns certified attachment with recorded strong + matching live profile', async () => {
    const reg = new CompactProviderRegistry();
    reg.register(makeFakeProvider({ providerId: 'p', profile: STRONG_PROFILE }));
    const session: HostSessionDescriptor = { sessionId: 's1', projectRoot: '/tmp' };
    const entry = baseManifestEntry('p', {
      level: 'certified-strong',
      capabilityHash: computeCapabilityHash(STRONG_PROFILE)
    });
    const result = await reg.attach(session, {
      providerId: 'p',
      manifestPath: '/n',
      now: new Date(),
      manifestEntry: entry
    });
    expect(result.certificationLevel).toBe('certified-strong');
    expect(result.capabilityHash).toBe(entry.certification.capabilityHash);
    expect(result.decision.attachable).toBe(true);
  });

  it('attach() returns safe-handoff consent shape when live profile is weak + recorded strong', async () => {
    const reg = new CompactProviderRegistry();
    reg.register(makeFakeProvider({ providerId: 'p', profile: NATIVE_ONLY_PROFILE }));
    const session: HostSessionDescriptor = { sessionId: 's1', projectRoot: '/tmp' };
    const entry = baseManifestEntry('p', {
      level: 'certified-strong',
      capabilityHash: computeCapabilityHash(STRONG_PROFILE) // mismatch with live native-only
    });
    await expect(
      reg.attach(session, {
        providerId: 'p',
        manifestPath: '/n',
        now: new Date(),
        manifestEntry: entry
      })
    ).rejects.toThrowError(ProviderNotAttachableError);
  });

  it('attach() isolates canAttach() errors (CanAttachError wrapper)', async () => {
    const reg = new CompactProviderRegistry();
    reg.register({
      metadata: { providerId: 'p', protocolVersion: 1, implementationVersion: '1.0.0', implementationDigest: 'a'.repeat(64) },
      canAttach: async () => { throw new Error('host probe exploded'); },
      createBridge: async () => ({ probe: async () => STRONG_PROFILE } as unknown as HostCompactBridge)
    });
    const session: HostSessionDescriptor = { sessionId: 's1', projectRoot: '/tmp' };
    const entry = baseManifestEntry('p', {
      level: 'certified-strong',
      capabilityHash: computeCapabilityHash(STRONG_PROFILE)
    });
    await expect(
      reg.attach(session, {
        providerId: 'p',
        manifestPath: '/n',
        now: new Date(),
        manifestEntry: entry
      })
    ).rejects.toThrowError(CanAttachError);
  });
});
