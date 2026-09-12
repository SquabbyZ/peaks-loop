/**
 * Check: codegraph exclude integrity (`capability:codegraph-exclude-integrity`).
 *
 * The companion to `capability:codegraph`. That check answers "is the
 * upstream package resolvable at the pinned version"; this one answers
 * "does the project's `.codegraph/config.json` exclude rules silently
 * drop source files git tracks".
 *
 * Why it exists: upstream ships a default `exclude` template matched by
 * *directory name*, and `config.json`'s `exclude` array replaces those
 * defaults wholesale. Any default rule whose directory name collides
 * with a real source directory drops tracked files from the index while
 * `peaks codegraph status` still printed `[OK] Index is up to date`.
 *
 * Read-only by construction — it consumes the same inspector
 * `peaks codegraph status` gates on and never writes the config.
 *
 * Failure posture:
 *   - codegraph not initialized in the inspected root (no
 *     `.codegraph/config.json`) → `ok: true`; there is nothing to
 *     reconcile and a fresh clone must not fail the doctor.
 *   - a confirmed gap → `ok: false` (blocking; the index is provably
 *     incomplete and the fix is one command).
 *   - could not evaluate (not a git work tree, malformed config) →
 *     `ok: false, severity: 'warning'` so the doctor reports the blind
 *     spot without flipping the exit code on an unrelated failure.
 */

import { getErrorMessage } from 'peaks-loop-shared/result';
import {
  inspectCodegraphExcludeIntegrity,
  isCodegraphExcludeConfigPresent
} from '../../../codegraph/codegraph-exclude-integrity.js';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const CHECK_ID = 'capability:codegraph-exclude-integrity';
/** How many rules / offending files the message names before eliding. */
const MAX_NAMED = 5;

function defaultProbe() {
  const projectRoot = process.cwd();

  // No config → codegraph was never initialized here, so no exclude
  // list is in play and there is nothing to report.
  return isCodegraphExcludeConfigPresent(projectRoot)
    ? inspectCodegraphExcludeIntegrity(projectRoot)
    : null;
}

function renderGapMessage(
  excludedTrackedCount: number,
  trackedSourceCount: number,
  rulesToRemove: readonly string[],
  violations: readonly { readonly path: string; readonly matchedRule: string }[]
): string {
  const namedRules = rulesToRemove.slice(0, MAX_NAMED).join(', ');
  const elidedRules = rulesToRemove.length > MAX_NAMED ? `, … (+${rulesToRemove.length - MAX_NAMED})` : '';
  const namedFiles = violations
    .slice(0, MAX_NAMED)
    .map((violation) => `${violation.path} <- ${violation.matchedRule}`)
    .join('; ');
  const elidedFiles = violations.length > MAX_NAMED ? `; … (+${violations.length - MAX_NAMED})` : '';

  return `codegraph index is incomplete: ${excludedTrackedCount} of ${trackedSourceCount} tracked source files are blocked by ${rulesToRemove.length} exclude rule(s) [${namedRules}${elidedRules}]. Blocked: ${namedFiles}${elidedFiles}. Run \`peaks codegraph repair-exclude --project <root>\` to drop them and rebuild the index.`;
}

function run({ options }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.codegraphIntegrityProbe ?? defaultProbe;

  let report;
  try {
    report = probe();
  } catch (error) {
    return [{
      id: CHECK_ID,
      ok: false,
      severity: 'warning',
      message: `codegraph exclude integrity could not be evaluated: ${getErrorMessage(error)}`
    }];
  }

  if (report === null) {
    return [{
      id: CHECK_ID,
      ok: true,
      message: 'codegraph is not initialized in this project (no .codegraph/config.json); the exclude list is not in play yet'
    }];
  }

  if (!report.gap) {
    return [{
      id: CHECK_ID,
      ok: true,
      message: `codegraph exclude list drops no tracked source file (${report.trackedSourceCount} tracked source file(s) admitted by include)`
    }];
  }

  return [{
    id: CHECK_ID,
    ok: false,
    message: renderGapMessage(
      report.excludedTrackedCount,
      report.trackedSourceCount,
      report.rulesToRemove,
      report.violations
    )
  }];
}

export const check: DoctorCheckPlugin = {
  name: 'codegraph-exclude-integrity',
  run
};
