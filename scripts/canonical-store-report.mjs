#!/usr/bin/env node
//
// THE STORE'S OWN ROWS — the canonical store's entries that the package does NOT ship.
//
// WHY THIS MODULE EXISTS. The report the sync command shows used to be built from the
// PACKAGE's skill list alone: one row per skill peaks-loop ships. That is the
// package's slice of the store, not the store. A skill the USER put in the store —
// their own copy, with no sidecar, which peaks-loop never overwrites — was invisible
// in the report that claims to describe the store: the report said "0 unmanaged"
// while their skill sat there.
//
// The rows here close that gap. Every entry in the store that the package does not
// ship gets a row:
//
//   - an entry with NO sidecar is the USER's own → `unmanaged`. It is never
//     overwritten and never pruned, and the report says so.
//   - an entry WITH our sidecar is ours, and this release does not ship it any more
//     → `retired`. A real run removes it; a dry run says what it would remove.
//
// THE ROWS ARE ABOUT THE STORE, so the states are the store's: an entry this module
// reports is never `current` and never `stale` — those two belong to the package's
// own skills, which the install loop reports.
//
// THE ROOT MUST MATCH THE STORE THE COPIES LAND IN. That root is resolved by
// `resolveKindRoot` with NO `root` option, exactly as `ensureCanonicalCopy` resolves
// it, so the two always name the same directory.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  MANAGED_MARKER_SUFFIX,
  isManagedEntry,
  readManagedMarker,
  resolveKindRoot
} from './canonical-store.mjs';

/** The scratch prefix the store's atomic writes use; never an asset name. */
const TEMP_PREFIX = '.peaks-tmp-';

/**
 * Every store entry the package does not ship, as report rows.
 *
 * @param {{ kind: string, knownNames: readonly string[], dryRun?: boolean }} options
 * @returns {Array<{ name: string, state: string, action: string, version: string | null, reason: string | null }>}
 */
export function collectStoreOnlyEntries(options) {
  const { kind, knownNames } = options;
  const dryRun = options.dryRun === true;
  // The SAME resolution `ensureCanonicalCopy` uses: no `root` option, so the
  // canonical root is `$PEAKS_HOME` or `~/.peaks` — the store the copies land in.
  const kindRoot = resolveKindRoot(kind, {});
  if (!existsSync(kindRoot)) return [];

  const known = new Set(knownNames);
  const rows = [];
  for (const name of readdirSync(kindRoot).sort()) {
    // A sidecar is not an entry, and a scratch file is not an entry either.
    if (name.endsWith(MANAGED_MARKER_SUFFIX)) continue;
    if (name.startsWith(TEMP_PREFIX)) continue;
    // The package's own skills already have a row: the install loop reported them.
    if (known.has(name)) continue;

    const entryPath = join(kindRoot, name);
    if (!isManagedEntry(entryPath)) {
      rows.push({
        name,
        state: 'unmanaged',
        action: 'unmanaged',
        version: null,
        reason: null
      });
      continue;
    }
    rows.push({
      name,
      state: 'retired',
      action: dryRun ? 'planned' : 'pruned',
      version: readManagedMarker(entryPath)?.version ?? null,
      reason: 'retired'
    });
  }
  return rows;
}
