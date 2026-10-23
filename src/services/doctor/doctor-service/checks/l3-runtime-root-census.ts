/**
 * Check: the runtime root holds only what the registry knows
 * (`L3:l3-runtime-root-census`).
 *
 * WHY A NEW CHECK, AND NOT AN EXTENSION OF `L3:l3-orphan-sessions`.
 *
 * The orphan check answers ONE question: "is this DIRECTORY a valid session
 * id?". It reads directories only, so a stray FILE at the root was invisible
 * to it — 204 of them had accumulated on 2026-10-24 with no product check
 * able to name them. Widening that check to cover files would have made its
 * id lie: an id that says "orphan sessions" must not start reporting stray
 * files.
 *
 * This check answers a different question: "does the runtime root contain
 * anything the registry does not know?". Its id names the ROOT rather than
 * one failure mode, so it covers both an orphan session dir and a stray file
 * — which is exactly what the registry has to be right about.
 *
 * IT READS THE REAL TREE. The drift guard (`tests/unit/workspace/
 * runtime-layout-drift-guard.test.ts`) walks `src/**` and proved the CODE
 * does not write an unregistered child; it never looked at the working tree.
 * This check is the counterpart: it looks at the working tree.
 *
 * FAIL-CLOSED. A runtime root that cannot be read is NOT a clean root. The
 * census reports "could not determine" and this check reports `ok: false`; it
 * is rendered with `severity: 'warning'`, so an unreadable root is visible in
 * the JSON envelope without turning `peaks doctor` red on a project that
 * simply has no peaks workspace yet.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import {
  censusRuntimeRoot,
  type RuntimeRootCensus,
  type RuntimeRootEntry,
  type RuntimeRootRead,
  type RuntimeRootViolation
} from '../../../workspace/runtime-layout.js';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

/**
 * The check id. The `L3:` prefix keeps it in the family that runs last, and
 * the name covers the whole root — an orphan session dir and a stray file are
 * the same finding here: something the registry does not know.
 */
export const RUNTIME_ROOT_CENSUS_CHECK_ID = 'L3:l3-runtime-root-census';

/** How many offenders the message inlines before eliding the rest. */
const MAX_NAMES_IN_MESSAGE = 5;

/**
 * Read the runtime root.
 *
 * A read that fails (missing directory, permission denied) is reported as
 * `unreadable`, NEVER as an empty list: an empty list would read as "clean",
 * which is the one answer an unreadable tree is not entitled to give.
 */
function readRuntimeRoot(runtimeDir: string): RuntimeRootRead {
  try {
    const entries = readdirSync(runtimeDir, { withFileTypes: true });
    const mapped: RuntimeRootEntry[] = entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : 'file'
    }));
    return { status: 'read', entries: mapped };
  } catch (error) {
    return { status: 'unreadable', reason: getErrorMessage(error) };
  }
}

/** The offenders, each with its kind, elided past the cut. */
function describeViolations(violations: readonly RuntimeRootViolation[]): string {
  const shown = violations.slice(0, MAX_NAMES_IN_MESSAGE);
  const elided = violations.length - shown.length;
  const names = shown.map((violation) => `${violation.name} (${violation.kind})`).join(', ');
  return elided > 0 ? `${names} (+${elided} more)` : names;
}

function render(census: RuntimeRootCensus): DoctorCheck {
  if (census.status === 'clean') {
    return {
      id: RUNTIME_ROOT_CENSUS_CHECK_ID,
      ok: true,
      message: `Runtime root census: all ${census.entryCount} top-level entr(y/ies) under .peaks/_runtime/ are registered or session-shaped`
    };
  }
  if (census.status === 'violations') {
    return {
      id: RUNTIME_ROOT_CENSUS_CHECK_ID,
      ok: false,
      severity: 'error',
      message: `Runtime root census: ${census.violations.length} stray entr(y/ies) under .peaks/_runtime/ are not registered: ${describeViolations(census.violations)}. Register the legitimate ones in src/services/workspace/runtime-layout.ts; move the rest under the session dir.`
    };
  }
  return {
    id: RUNTIME_ROOT_CENSUS_CHECK_ID,
    ok: false,
    severity: 'warning',
    message: `Runtime root census could not be determined — the runtime root could not be read (${census.reason}); the tree was NOT verified clean.`
  };
}

function run({ resolvedL3Root, isValidSessionId }: DoctorContext): readonly DoctorCheck[] {
  const runtimeDir = join(resolvedL3Root, '.peaks/_runtime');
  const read = readRuntimeRoot(runtimeDir);
  return [render(censusRuntimeRoot({ read, isValidSessionId }))];
}

export const check: DoctorCheckPlugin = {
  name: 'l3-runtime-root-census',
  run
};
