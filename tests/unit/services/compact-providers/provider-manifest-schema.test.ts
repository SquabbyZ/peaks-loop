/**
 * provider-manifest-schema.test.ts — Phase 3 Task 3.1.
 *
 * Pure schema + integrity tests for `.peaks/_runtime/compact-providers.json`.
 * No fs, no clock, no model, no vendor branches.
 */
import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import {
  CompactProviderManifestSchema,
  computeManifestDigest,
  validateManifestFreshness,
  assertNoForbiddenManifestContent,
  ManifestExpiredError,
  ManifestClockSkewError,
  ManifestForbiddenContentError,
  ManifestSuspiciousTtlError
} from '../../../../src/services/compact-providers/provider-manifest-schema.js';
import type { CompactProviderManifest } from '../../../../src/services/compact-providers/provider-manifest-schema.js';

function baseManifest(overrides: Partial<CompactProviderManifest> = {}): CompactProviderManifest {
  const draft: Omit<CompactProviderManifest, 'manifestDigest'> = {
    schemaVersion: 1,
    generatedAt: '2026-07-24T00:00:00.000Z',
    entries: [
      {
        providerId: 'phase3-test-provider',
        metadata: {
          providerId: 'phase3-test-provider',
          protocolVersion: 1,
          implementationVersion: '1.0.0',
          implementationDigest: 'a'.repeat(64)
        },
        certification: {
          providerId: 'phase3-test-provider',
          protocolVersion: 1,
          implementationVersion: '1.0.0',
          implementationDigest: 'a'.repeat(64),
          capabilityHash: 'b'.repeat(64),
          certificationLevel: 'certified-strong',
          conformanceSuiteVersion: '1.0.0',
          evidenceDigest: 'c'.repeat(64),
          evidenceIndexPath: 'evidence/phase3-test.json',
          certifiedAt: '2026-07-20T00:00:00.000Z',
          expiresAt: '2026-08-01T00:00:00.000Z'
        }
      }
    ]
  };
  const draftWithManifestDigest = { ...draft, manifestDigest: 'd'.repeat(64) } as CompactProviderManifest;
  return { ...draftWithManifestDigest, ...overrides } as CompactProviderManifest;
}

describe('CompactProviderManifestSchema', () => {
  it('accepts a well-formed manifest', () => {
    const m = baseManifest();
    const result = CompactProviderManifestSchema.safeParse(m);
    expect(result.success).toBe(true);
  });

  it('rejects unknown protocol version', () => {
    const m = { ...baseManifest(), schemaVersion: 2 } as unknown;
    const result = CompactProviderManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('rejects extra top-level fields', () => {
    const m = { ...baseManifest(), rogue: 'x' } as unknown;
    const result = CompactProviderManifestSchema.safeParse(m);
    expect(result.success).toBe(false);
  });

  it('rejects malformed implementationDigest', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].metadata.implementationDigest = 'not-hex';
    const result = CompactProviderManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects malformed timestamp', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.certifiedAt = 'not-a-date';
    const result = CompactProviderManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects duplicate providerId across entries', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries.push(JSON.parse(JSON.stringify(bad.entries[0])));
    bad.entries[1].providerId = 'phase3-test-provider';
    const result = CompactProviderManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects metadata.providerId mismatch with certification.providerId', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].metadata.providerId = 'phase3-test-provider-A';
    bad.entries[0].certification.providerId = 'phase3-test-provider-B';
    const result = CompactProviderManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects command-like paths in evidenceIndexPath', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = 'C:\\Windows\\System32\\evil.exe';
    const result = CompactProviderManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects path traversal in evidenceIndexPath', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = '../../../etc/passwd';
    const result = CompactProviderManifestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

describe('assertNoForbiddenManifestContent', () => {
  it('rejects forbidden substrings anywhere in the manifest (token=)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].metadata.implementationVersion = 'token=AKIAxxx';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden substrings (password)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = 'secrets/passwords.json';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden substrings (api-key)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].metadata.implementationVersion = 'api-key-v1';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden substrings (private_key)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = 'private_key.pem';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden path pattern (.env)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = '.env';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden path pattern (id_rsa)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = 'home/.ssh/id_rsa';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden command-like content (spawn() in implementationVersion)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].metadata.implementationVersion = 'spawn(claude --compact)';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });

  it('rejects forbidden command-like content (peaks compact verb name)', () => {
    const m = baseManifest();
    const bad = JSON.parse(JSON.stringify(m));
    bad.entries[0].certification.evidenceIndexPath = 'logs/peaks compact auto.json';
    expect(() => assertNoForbiddenManifestContent(bad)).toThrowError(ManifestForbiddenContentError);
  });
});

describe('opaque providerId acceptance', () => {
  it('accepts vendor-shaped ids without core branching', () => {
    for (const providerId of ['claude-code-test', 'z-code-test', 'codex-test', 'custom-internal-01']) {
      const m = baseManifest();
      const entry = m.entries[0]!;
      entry.providerId = providerId;
      entry.metadata.providerId = providerId;
      entry.certification.providerId = providerId;
      const result = CompactProviderManifestSchema.safeParse(m);
      expect(result.success, `providerId=${providerId} should parse`).toBe(true);
    }
  });
});

describe('computeManifestDigest', () => {
  it('is canonical (key order independent)', () => {
    const m = baseManifest();
    const shuffled: CompactProviderManifest = {
      manifestDigest: m.manifestDigest,
      entries: m.entries,
      schemaVersion: m.schemaVersion,
      generatedAt: m.generatedAt
    };
    assert.equal(computeManifestDigest(m), computeManifestDigest(shuffled));
  });

  it('is sensitive to any payload change', () => {
    const m = baseManifest();
    const tampered = JSON.parse(JSON.stringify(m));
    tampered.entries[0].certification.capabilityHash = 'f'.repeat(64);
    assert.notEqual(computeManifestDigest(m), computeManifestDigest(tampered));
  });
});

describe('validateManifestFreshness', () => {
  it('rejects expired', () => {
    const m = baseManifest();
    const now = new Date('2026-09-01T00:00:00.000Z');
    expect(() => validateManifestFreshness(m.entries[0]!.certification, now)).toThrowError(ManifestExpiredError);
  });

  it('rejects certifiedAt in the future', () => {
    const futureCert = JSON.parse(JSON.stringify(baseManifest()));
    futureCert.entries[0].certification.certifiedAt = '2099-01-01T00:00:00.000Z';
    futureCert.entries[0].certification.expiresAt = '2099-02-01T00:00:00.000Z';
    const now = new Date('2026-07-24T00:00:00.000Z');
    expect(() => validateManifestFreshness(futureCert.entries[0].certification, now)).toThrowError(ManifestClockSkewError);
  });

  it('rejects suspicious TTL > 28d', () => {
    const longTtl = JSON.parse(JSON.stringify(baseManifest()));
    longTtl.entries[0].certification.certifiedAt = '2026-07-01T00:00:00.000Z';
    longTtl.entries[0].certification.expiresAt = '2026-08-30T00:00:00.000Z';
    const now = new Date('2026-07-02T00:00:00.000Z');
    expect(() => validateManifestFreshness(longTtl.entries[0].certification, now)).toThrowError(ManifestSuspiciousTtlError);
  });

  it('accepts fresh manifest', () => {
    const m = baseManifest();
    const now = new Date('2026-07-22T00:00:00.000Z');
    expect(() => validateManifestFreshness(m.entries[0]!.certification, now)).not.toThrow();
  });
});
