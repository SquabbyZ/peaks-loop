/**
 * multi-binary-drift-helpers — the pure PATH-probing primitives behind the
 * `build:multi-binary-drift` doctor check (`multi-binary-drift.ts`).
 *
 * These are declarations + small pure helpers only: the record shape, the
 * cross-platform candidate names, the read-only `exists` probe, and the
 * version dedupe. `multi-binary-drift.ts` imports them and re-exports
 * `PeaksBinaryRecord`, so the check's public surface is unchanged.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Local record shape — same as the canonical
 * `MultiBinaryDriftInspection.binaries[number]`. Re-declared so the
 * helper signature carries the concrete shape (the canonical
 * `MultiBinaryDriftInspection` widens `version` + `installDate` to
 * `string | null` so external consumers do not depend on the
 * field being nullable).
 */
export type PeaksBinaryRecord = {
  readonly path: string;
  readonly version: string | null;
  readonly installDate: string | null;
  readonly realpath: string;
};

/**
 * Cross-platform candidate names. Windows shims the executable as
 * `peaks.cmd` and `peaks.ps1` (npm writes both); POSIX names the
 * binary `peaks`. We probe all three names on every platform —
 * probing a non-existent file is a no-op, so cross-list probing is
 * safe.
 */
export function candidateBinaryNames(dir: string): ReadonlyArray<string> {
  return [join(dir, 'peaks'), join(dir, 'peaks.cmd'), join(dir, 'peaks.ps1')];
}

export function existsSafe(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * `version === null` means we could not read the package.json (or
 * its `name` did not equal `peaks-loop`). Those records stay in
 * `binaries` for the report but do NOT contribute to
 * `uniqueVersions` — including null would falsely trigger drift
 * detection when the only failures are unreadable binaries.
 */
export function dedupeVersions(versions: ReadonlyArray<string | null>): ReadonlyArray<string> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of versions) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
