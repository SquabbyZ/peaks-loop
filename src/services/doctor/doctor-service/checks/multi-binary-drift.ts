/**
 * Check: PATH-scoped `peaks-loop` binary drift
 * (`build:multi-binary-drift`).
 *
 * Slice 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
 * (G3/G4). When more than one `peaks-loop` binary is discoverable on
 * `process.env.PATH` AND the discovered versions disagree, the doctor
 * emits a `PEAKS_MULTI_BINARY_DRIFT` warning. The user-reported
 * production symptom — `peaks` resolving to an old version (e.g.
 * 3.1.2 on `%AppData%\Roaming\npm`) while the freshly installed
 * binary on another PATH entry (e.g. `C:\nvm4w\nodejs\peaks` 4.0.12)
 * is what the user just bumped — produces "Hook JSON output
 * validation failed" when the IDE statusline hook inherits the older
 * binary via PATH ordering.
 *
 * Behavior contract (PRD AC6 / AC7 / AC8 / AC9):
 *   - AC6: ≥ 2 peaks-loop binaries with different versions → warning
 *   - AC7: warning severity only, doctor exit 0 (no other check
 *          flipped to error)
 *   - AC8: drift is scoped to peaks-loop (`package.json#name ===
 *          'peaks-loop'`); sibling npm tools are NOT flagged
 *   - AC9: cross-platform — uses `process.env.PATH` + `path.delimiter`
 *          + binary naming `peaks` / `peaks.cmd` / `peaks.ps1`
 *
 * Pure `inspectMultiBinaryDrift` helper is exported so tests can drive
 * the filesystem walk without monkey-patching `process.env.PATH` or
 * `realpathSync`. Every probe call is wrapped in try/catch (read-only,
 * must not throw across the doctor boundary).
 */

import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs';
import {
  delimiter as pathDelimiter,
  join
} from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type {
  DoctorCheck,
  DoctorCheckPlugin,
  DoctorContext,
  MultiBinaryDriftInspection
} from '../types.js';

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
 * Pure helper. Inspects `process.env.PATH` (or the injected
 * `pathEnv`) for `peaks-loop` binaries. Each found binary is walked
 * to its package.json via `realpathSync` so symlinks / npm shims /
 * `peaks.cmd` / `peaks.ps1` all collapse to the same dedupe key.
 *
 * Exported so tests can drive the filesystem walk without monkey-
 * patching `process.env.PATH` or `realpathSync`.
 */
export function inspectMultiBinaryDrift(opts?: {
  pathEnv?: string;
  envReader?: (key: string) => string | undefined;
  binaryExists?: (candidate: string) => boolean;
  binaryRealpath?: (candidate: string) => string;
  packageJsonReader?: (path: string) => Buffer | string | null;
}): MultiBinaryDriftInspection {
  const envReader = opts?.envReader ?? ((k) => process.env[k]);
  const exists = opts?.binaryExists ?? ((p) => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
  const realpath = opts?.binaryRealpath ?? ((p) => {
    try {
      return realpathSync(p);
    } catch {
      return p;
    }
  });
  const reader = opts?.packageJsonReader ?? ((p) => {
    try {
      return readFileSync(p);
    } catch {
      return null;
    }
  });

  const pathEnv = opts?.pathEnv ?? envReader('PATH') ?? '';
  if (pathEnv.length === 0) {
    return { binaries: [], driftDetected: false, uniqueVersions: [] };
  }

  const dirs = pathEnv.split(pathDelimiter).filter((d) => d.length > 0);
  const seen = new Map<string, PeaksBinaryRecord>();
  for (const dir of dirs) {
    const candidates = candidateBinaryNames(dir);
    for (const candidate of candidates) {
      if (!exists(candidate)) continue;
      const rp = realpath(candidate);
      if (seen.has(rp)) continue;
      const pkgPath = locatePackageJson(rp, candidate);
      const record = readBinaryRecord(candidate, rp, pkgPath, reader);
      seen.set(rp, record);
    }
  }
  const binaries = Array.from(seen.values());
  const uniqueVersions = dedupeVersions(binaries.map((b) => b.version));
  return {
    binaries,
    driftDetected: uniqueVersions.length >= 2,
    uniqueVersions
  };
}

/**
 * Cross-platform candidate names. Windows shims the executable as
 * `peaks.cmd` and `peaks.ps1` (npm writes both); POSIX names the
 * binary `peaks`. We probe all three names on every platform —
 * probing a non-existent file is a no-op, so cross-list probing is
 * safe.
 */
function candidateBinaryNames(dir: string): ReadonlyArray<string> {
  return [join(dir, 'peaks'), join(dir, 'peaks.cmd'), join(dir, 'peaks.ps1')];
}

/**
 * Walk from the binary to its `node_modules/peaks-loop/package.json`.
 *
 * Common layouts handled:
 *
 *   A. `<root>/bin/peaks` (POSIX npm global / nvm) → parent is
 *      `<root>/bin/`, parent's parent is `<root>/`. package.json at
 *      `<root>/package.json`.
 *   B. `<root>/peaks` or `<root>/peaks.cmd` (Windows npm global shim)
 *      → parent is `<root>/`. package.json at `<root>/package.json`,
 *      OR `<root>/../node_modules/peaks-loop/package.json`.
 *   C. `<root>/node_modules/.bin/peaks` (local install) → parent is
 *      `node_modules/.bin/`, parent's parent is `node_modules/`.
 *      package.json at `<root>/node_modules/peaks-loop/package.json`.
 *
 * The locator walks up from the binary path (realpathPath first,
 * then originalCandidate) and checks for the canonical
 * `node_modules/peaks-loop/package.json` and a `package.json` at each
 * ancestor. The probe is read-only and stops at the first hit. We do
 * NOT trust `package.json` without verifying its `name === 'peaks-loop'`
 * later (see {@link readBinaryRecord}) — a sibling package's
 * `package.json` is filtered out at read time.
 */
function locatePackageJson(realpathPath: string, originalCandidate: string): string | null {
  const ancestors = new Set<string>();
  for (const start of [realpathPath, originalCandidate]) {
    let current = start;
    for (let depth = 0; depth < 8; depth++) {
      const parent = join(current, '..');
      if (parent === current) break;
      ancestors.add(parent);
      current = parent;
    }
  }
  for (const ancestor of ancestors) {
    const nmPkg = join(ancestor, 'node_modules', 'peaks-loop', 'package.json');
    if (existsSafe(nmPkg)) return nmPkg;
  }
  for (const ancestor of ancestors) {
    const pkg = join(ancestor, 'package.json');
    if (existsSafe(pkg)) return pkg;
  }
  return null;
}

function existsSafe(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

function readBinaryRecord(
  candidate: string,
  realpathPath: string,
  pkgPath: string | null,
  reader: (p: string) => Buffer | string | null,
): PeaksBinaryRecord {
  if (pkgPath === null) {
    return {
      path: candidate,
      version: null,
      installDate: null,
      realpath: realpathPath
    };
  }
  let version: string | null = null;
  try {
    const raw = reader(pkgPath);
    if (raw !== null) {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
      const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
      if (parsed.name === 'peaks-loop' && typeof parsed.version === 'string') {
        version = parsed.version;
      }
    }
  } catch {
    version = null;
  }
  let installDate: string | null = null;
  try {
    const stat = statSync(pkgPath);
    installDate = stat.mtime.toISOString();
  } catch {
    installDate = null;
  }
  return {
    path: candidate,
    version,
    installDate,
    realpath: realpathPath
  };
}

/**
 * `version === null` means we could not read the package.json (or
 * its `name` did not equal `peaks-loop`). Those records stay in
 * `binaries` for the report but do NOT contribute to
 * `uniqueVersions` — including null would falsely trigger drift
 * detection when the only failures are unreadable binaries.
 */
function dedupeVersions(versions: ReadonlyArray<string | null>): ReadonlyArray<string> {
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

function run({ options }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.multiBinaryDriftProbe ?? (() => inspectMultiBinaryDrift());
  try {
    const result = probe();
    if (result.binaries.length === 0) {
      return [{
        id: 'build:multi-binary-drift',
        ok: true,
        message: 'no peaks-loop binary on PATH (statusLine may be unavailable)'
      }];
    }
    if (!result.driftDetected) {
      return [{
        id: 'build:multi-binary-drift',
        ok: true,
        message: result.binaries.length === 1
          ? `single peaks-loop binary on PATH at ${result.binaries[0]!.path} (version ${result.uniqueVersions[0] ?? 'unknown'})`
          : `${result.binaries.length} peaks-loop binaries on PATH all at version ${result.uniqueVersions[0] ?? 'unknown'}`
      }];
    }
    // Drift detected — WARN-ONLY. AC7: doctor still exit 0 unless
    // another check escalates to error. `ok: false` so the operator
    // sees the finding in the JSON report AND the check carries
    // `severity: 'warning'` so `buildReport` does NOT count it as a
    // failure when computing `summary.ok`. Slice
    // 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
    // repair cycle landed the severity-aware summary so the
    // previously-handwaved "future severity-aware summary can
    // downgrade the doctor exit code" actually fires.
    const binaryTable = result.binaries
      .map((b) => `  ${b.path} version=${b.version ?? 'unknown'} date=${b.installDate ?? 'unknown'}`)
      .join('\n');
    return [{
      id: 'build:multi-binary-drift',
      ok: false,
      severity: 'warning',
      message: `PEAKS_MULTI_BINARY_DRIFT: ${result.uniqueVersions.length} distinct peaks-loop versions on PATH (${result.uniqueVersions.join(', ')}). Run \`npm uninstall -g peaks-loop\` on the stale entries, or reorder PATH so the desired binary resolves first. Binaries:\n${binaryTable}`
    }];
  } catch (error) {
    return [{
      id: 'build:multi-binary-drift',
      ok: false,
      message: `multi-binary drift check failed: ${getErrorMessage(error)}`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'multi-binary-drift',
  run
};