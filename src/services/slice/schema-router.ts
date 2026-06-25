/**
 * SchemaRouter — dual-read JSON router for `DecompositionResult` (v1/v2).
 *
 * v1 files (legacy, pre-Wave-1 slice decompose output) do NOT carry a
 * `schemaVersion` field; v2 files always carry `schemaVersion: 'v2'`.
 * The router reads the file, dispatches on the discriminator, and returns
 * the parsed object typed as `DecompositionResult` or `DecompositionResultV2`.
 *
 * Why a router (and not a parse-on-write migration):
 *  - v1 files may exist in user workspaces long after v2 ships; rewriting
 *    them on read would force a write-back side-effect that callers don't
 *    need (and breaks `peaks slice pick` which only needs the v1 fields).
 *  - The discriminated return type lets callers narrow once at the boundary
 *    (`schemaVersion === 'v2' ? handleV2(r) : handleV1(r)`) and stay typed
 *    downstream.
 *
 * Unknown versions throw `UnknownSchemaVersionError` so callers can
 * surface a clear migration hint instead of silently treating v3 as v1.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import type { DecompositionResult } from './slice-decompose-types.js';
import type { DecompositionResultV2 } from './slice-topology-types.js';

/**
 * Thrown by `readResult` when the JSON carries a `schemaVersion` value
 * that is neither absent (v1) nor `'v2'`. The `code` is the stable
 * machine-readable discriminator; downstream CLI surfaces should map it
 * to the appropriate exit code.
 */
export class UnknownSchemaVersionError extends Error {
  readonly code = 'UNKNOWN_SCHEMA_VERSION' as const;

  constructor(message: string) {
    super(message);
    this.name = 'UnknownSchemaVersionError';
  }
}

/**
 * Read a decomposition-result JSON file and return it typed as either
 * `DecompositionResult` (v1, no `schemaVersion` field) or
 * `DecompositionResultV2` (`schemaVersion: 'v2'`).
 *
 * Throws `UnknownSchemaVersionError` for any other `schemaVersion` value.
 */
export function readResult(filePath: string): DecompositionResult | DecompositionResultV2 {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new UnknownSchemaVersionError(
      `Unknown schemaVersion: ${String(parsed)}. Supported: v1 (no field), v2.`
    );
  }

  const schemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;

  if (schemaVersion === 'v2') {
    return parsed as DecompositionResultV2;
  }
  if (schemaVersion === undefined) {
    return parsed as DecompositionResult;
  }
  throw new UnknownSchemaVersionError(
    `Unknown schemaVersion: ${String(schemaVersion)}. Supported: v1 (no field), v2.`
  );
}

/**
 * Serialize a v1 or v2 decomposition result to disk as pretty-printed JSON.
 * The `schemaVersion` field (or its absence) is preserved as-is.
 */
export function writeResult(filePath: string, result: DecompositionResult | DecompositionResultV2): void {
  writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf8');
}