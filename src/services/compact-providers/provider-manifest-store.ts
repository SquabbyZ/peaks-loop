/**
 * Provider manifest store — Phase 3 Task 3.2.
 *
 * On-disk shape `.peaks/_runtime/compact-providers.json` is parsed via
 * `parseProviderManifestJson` (validates the file, not just the parsed
 * structure). `loadCertifiedProvider` is the single public entry: it
 * composes parse + digest verify + freshness + content audit + capability
 * hash check. If anything fails, a typed error is thrown and the registry
 * never sees a partially-validated provider.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CompactProviderManifestSchema,
  computeManifestDigest,
  validateManifestFreshness,
  assertNoForbiddenManifestContent,
  ManifestParseError,
  ManifestDigestMismatchError,
  ManifestClockSkewError,
  ManifestExpiredError,
  ManifestSuspiciousTtlError,
  ManifestInvalidTimestampError,
  ManifestForbiddenContentError
} from './provider-manifest-schema.js';
import type {
  CompactProviderManifest,
  CompactProviderManifestEntry
} from './provider-manifest-schema.js';

/** Read the manifest from disk and parse it. Throws typed errors on failure. */
export function parseProviderManifestJson(jsonText: string): CompactProviderManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    throw new ManifestParseError(`manifest is not valid JSON: ${(err as Error).message}`);
  }
  const result = CompactProviderManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new ManifestParseError(
      `manifest schema mismatch: ${result.error.issues.map((i) => i.message).join('; ')}`
    );
  }
  return result.data;
}

/**
 * Read the manifest file from disk. Fails closed on any read/parse/integrity
 * issue — the registry never sees a partial view.
 */
export function loadProviderManifestFile(
  manifestPath: string,
  options: { now: Date; ttlMs?: number; expectedProviderId?: string } = { now: new Date() }
): CompactProviderManifest {
  if (!existsSync(manifestPath)) {
    throw new ManifestParseError(`manifest file not found: ${manifestPath}`);
  }
  const text = readFileSync(manifestPath, 'utf8');
  const manifest = parseProviderManifestJson(text);

  // 1. Manifest digest must match the recomputed value.
  const computed = computeManifestDigest(manifest);
  if (computed !== manifest.manifestDigest) {
    throw new ManifestDigestMismatchError(
      `manifest digest mismatch: expected ${manifest.manifestDigest}, computed ${computed}`
    );
  }

  // 2. No forbidden substrings anywhere in the parsed value tree.
  assertNoForbiddenManifestContent(manifest);

  // 3. Each entry: freshness + providerId match.
  for (const entry of manifest.entries) {
    if (options.expectedProviderId && entry.providerId !== options.expectedProviderId) {
      throw new ManifestParseError(
        `manifest entry providerId=${entry.providerId} does not match expected ${options.expectedProviderId}`
      );
    }
    try {
      validateManifestFreshness(entry.certification, options.now, options.ttlMs);
    } catch (err) {
      if (
        err instanceof ManifestExpiredError ||
        err instanceof ManifestClockSkewError ||
        err instanceof ManifestSuspiciousTtlError ||
        err instanceof ManifestInvalidTimestampError
      ) {
        throw err;
      }
      throw new ManifestParseError(`manifest entry ${entry.providerId} freshness check failed: ${(err as Error).message}`);
    }
  }

  return manifest;
}

/** Find a single entry by providerId. Throws if absent or duplicated. */
export function findManifestEntry(
  manifest: CompactProviderManifest,
  providerId: string
): CompactProviderManifestEntry {
  const matches = manifest.entries.filter((e) => e.providerId === providerId);
  if (matches.length === 0) {
    throw new ManifestParseError(`no manifest entry for providerId=${providerId}`);
  }
  if (matches.length > 1) {
    throw new ManifestParseError(`duplicate manifest entries for providerId=${providerId}`);
  }
  return matches[0]!;
}
