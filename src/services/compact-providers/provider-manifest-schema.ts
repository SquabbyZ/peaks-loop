/**
 * Provider manifest schema + integrity (Phase 3 Task 3.1).
 *
 * On-disk shape: `.peaks/_runtime/compact-providers.json`:
 * ```
 * {
 *   "schemaVersion": 1,
 *   "generatedAt": "2026-07-24T00:00:00.000Z",
 *   "entries": [{ "providerId": "...", "certification": {...}, "metadata": {...} }, ...],
 *   "manifestDigest": "..."
 * }
 * ```
 *
 * Hard contracts (binding — design §12.2 + §14.1):
 * - Manifest MUST NOT carry commands, raw tokens, raw transcripts, raw
 *   capsule bodies, or secret-like substrings.
 * - `manifestDigest` is the canonical SHA-256 hex over the JSON with the
 *   digest field excluded. Mismatch ⇒ fail closed.
 * - `expiresAt` in the past ⇒ fail closed.
 * - `certifiedAt` after `now` ⇒ fail closed (clock-skew guard).
 *
 * If any check fails, `loadCertifiedProvider` throws a typed error and
 * returns nothing — the core never sees a partially-validated provider.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  CompactProviderCertification,
  CompactProviderMetadata
} from './compact-capability-provider.js';

export const PROVIDER_MANIFEST_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MANIFEST_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const HEX_64 = /^[a-f0-9]{64}$/i;
const SEMVER_LIKE = /^[A-Za-z0-9._+-]{1,64}$/;

const ProviderMetadataSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    protocolVersion: z.literal(1),
    implementationVersion: z.string().regex(SEMVER_LIKE),
    implementationDigest: z.string().regex(HEX_64)
  })
  .strict();

const ProviderCertificationSchema = z
  .object({
    providerId: z.string().min(1).max(128),
    protocolVersion: z.literal(1),
    implementationVersion: z.string().regex(SEMVER_LIKE),
    implementationDigest: z.string().regex(HEX_64),
    capabilityHash: z.string().regex(HEX_64),
    certificationLevel: z.enum(['certified-strong', 'native-only', 'safe-handoff', 'unsupported']),
    conformanceSuiteVersion: z.string().regex(SEMVER_LIKE),
    evidenceDigest: z.string().regex(HEX_64),
    evidenceIndexPath: z.string().min(1).max(1024).refine(
      (v) => !v.includes('..') && !/[<>:"|?*]/.test(v) && !/^([A-Z]:)?[/\\]/.test(v) && !/^[/\\]/.test(v) && !/^\w:\//.test(v),
      { message: 'evidenceIndexPath must be a relative POSIX path with no traversal or absolute segments' }
    ),
    certifiedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true })
  })
  .strict()
  .superRefine((cert, ctx) => {
    if (cert.providerId.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'providerId must be non-empty' });
    }
    const certTime = Date.parse(cert.certifiedAt);
    const expTime = Date.parse(cert.expiresAt);
    if (Number.isFinite(certTime) && Number.isFinite(expTime) && expTime <= certTime) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'expiresAt must be strictly after certifiedAt' });
    }
  });

const ManifestEntrySchema = z
  .object({
    providerId: z.string().min(1).max(128),
    metadata: ProviderMetadataSchema,
    certification: ProviderCertificationSchema
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.metadata.providerId !== entry.certification.providerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'metadata.providerId and certification.providerId must match'
      });
    }
    if (entry.metadata.implementationDigest !== entry.certification.implementationDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'metadata.implementationDigest and certification.implementationDigest must match'
      });
    }
  });

export const CompactProviderManifestSchema = z
  .object({
    schemaVersion: z.literal(PROVIDER_MANIFEST_SCHEMA_VERSION),
    generatedAt: z.string().datetime({ offset: true }),
    entries: z.array(ManifestEntrySchema).min(0).max(64),
    manifestDigest: z.string().regex(HEX_64)
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const entry of manifest.entries) {
      if (seen.has(entry.providerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate providerId in manifest: ${entry.providerId}`
        });
      }
      seen.add(entry.providerId);
    }
  });

export type CompactProviderManifestEntry = z.infer<typeof ManifestEntrySchema>;
export type CompactProviderManifest = z.infer<typeof CompactProviderManifestSchema>;

// --- Forbid sensitive substrings (case-insensitive) -----------------------------

const FORBIDDEN_SUBSTRINGS = [
  'secret',
  'password',
  'api_key',
  'api-key',
  'token=',
  'bearer ',
  'authorization:',
  'private_key'
];

const FORBIDDEN_PATH_PATTERNS = [
  /passwd/i,
  /shadow/i,
  /\.env$/i,
  /id_rsa/i,
  /id_dsa/i,
  /\.pem$/i,
  /\.key$/i
];

const FORBIDDEN_COMMAND_LIKE = /(\/compact|peaks\s+compact|--execute|--binary|--vendor|spawn\(|\bexec\()/i;

/**
 * Recursively scan a parsed-or-plain JSON value for forbidden substrings.
 * Throws `ManifestForbiddenContentError` on first hit. The scan is
 * exhaustive: keys + values + nested structures.
 */
export function assertNoForbiddenManifestContent(value: unknown, path = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    for (const s of FORBIDDEN_SUBSTRINGS) {
      if (value.toLowerCase().includes(s)) {
        throw new ManifestForbiddenContentError(`${path} contains forbidden substring "${s}"`);
      }
    }
    for (const p of FORBIDDEN_PATH_PATTERNS) {
      if (p.test(value)) {
        throw new ManifestForbiddenContentError(`${path} matches forbidden path pattern ${p}`);
      }
    }
    if (FORBIDDEN_COMMAND_LIKE.test(value)) {
      throw new ManifestForbiddenContentError(`${path} contains forbidden command-like token`);
    }
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      assertNoForbiddenManifestContent(value[i], `${path}[${i}]`);
    }
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      assertNoForbiddenManifestContent(k, `${path}.${k}`);
      assertNoForbiddenManifestContent(obj[k], `${path}.${k}`);
    }
  }
}

// --- Canonical digest ---------------------------------------------------------

function canonicalizeForDigest(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalizeForDigest);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalizeForDigest(obj[key]);
  }
  return sorted;
}

export function computeManifestDigest(manifest: CompactProviderManifest): string {
  const { manifestDigest: _ignored, ...rest } = manifest;
  const json = JSON.stringify(canonicalizeForDigest(rest));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

// --- Freshness ---------------------------------------------------------------

export function validateManifestFreshness(
  certification: CompactProviderCertification,
  now: Date,
  ttlMs: number = DEFAULT_MANIFEST_TTL_MS
): void {
  const expTime = Date.parse(certification.expiresAt);
  if (!Number.isFinite(expTime)) {
    throw new ManifestInvalidTimestampError('expiresAt is not a valid ISO timestamp');
  }
  const nowMs = now.getTime();
  const certTime = Date.parse(certification.certifiedAt);
  if (Number.isFinite(certTime) && certTime > nowMs + 60_000) {
    throw new ManifestClockSkewError(`certifiedAt ${certification.certifiedAt} is in the future (now=${now.toISOString()})`);
  }
  if (expTime <= nowMs) {
    throw new ManifestExpiredError(`certification expired at ${certification.expiresAt} (now=${now.toISOString()})`);
  }
  const ageMs = expTime - nowMs;
  if (ageMs > ttlMs * 4) {
    // 28 days sanity: a >28d TTL entry is almost certainly a corrupted
    // date. We don't refuse, but we surface a warning via a separate
    // error class so a caller can choose to flag it.
    throw new ManifestSuspiciousTtlError(`certification TTL ${Math.round(ageMs / 86400000)}d exceeds 28d sanity`);
  }
}

// --- Errors -----------------------------------------------------------------

export class ManifestParseError extends Error {
  override readonly name = 'ManifestParseError';
  constructor(message: string) {
    super(message);
  }
}

export class ManifestDigestMismatchError extends Error {
  override readonly name = 'ManifestDigestMismatchError';
  constructor(message: string) {
    super(message);
  }
}

export class ManifestExpiredError extends Error {
  override readonly name = 'ManifestExpiredError';
  constructor(message: string) {
    super(message);
  }
}

export class ManifestClockSkewError extends Error {
  override readonly name = 'ManifestClockSkewError';
  constructor(message: string) {
    super(message);
  }
}

export class ManifestSuspiciousTtlError extends Error {
  override readonly name = 'ManifestSuspiciousTtlError';
  constructor(message: string) {
    super(message);
  }
}

export class ManifestInvalidTimestampError extends Error {
  override readonly name = 'ManifestInvalidTimestampError';
  constructor(message: string) {
    super(message);
  }
}

export class ManifestForbiddenContentError extends Error {
  override readonly name = 'ManifestForbiddenContentError';
  constructor(message: string) {
    super(message);
  }
}
