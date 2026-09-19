/**
 * Check: codegraph index integrity (`capability:codegraph-index-integrity`).
 *
 * The third codegraph check, and the one that stops `[OK]` from being a
 * self-consistency assertion:
 *   - `capability:codegraph` answers "is upstream resolvable";
 *   - `capability:codegraph-exclude-integrity` answers "do the `exclude`
 *     rules drop tracked files";
 *   - this one answers "does the INDEX ITSELF cover the repository" —
 *     files the extractor supports that `include` never admitted, and rows
 *     the index still holds for paths that are gone.
 *
 * Why the exclude gate structurally cannot answer it: that gate runs the
 * `include` filter FIRST and reconciles `exclude` against the survivors, so
 * a file dropped by `include` is not "a tracked source file" as far as it is
 * concerned; and it never reads the index at all, so dead rows are invisible
 * to it. Both defects were present while `peaks codegraph status` printed
 * `[OK] Index is up to date`.
 *
 * Read-only by construction — it consumes the same read-only inspector
 * `peaks codegraph status` gates on. It never writes `.codegraph/config.json`
 * and never invokes the upstream binary.
 *
 * Failure posture:
 *   - codegraph not initialized in the inspected root (no
 *     `.codegraph/codegraph.db`) → `ok: true`; there is no index to be
 *     incomplete or stale, and a fresh clone must not fail the doctor.
 *   - a confirmed gap on either axis → `ok: false`. ADVISORY by default
 *     (`severity: 'warning'`, the doctor exit code is left alone), and
 *     blocking (no severity tag) when the project opts in with
 *     `PEAKS_CODEGRAPH_INDEX_STRICT=1` — the user's option C decision.
 *     The finding is `ok: false` either way; only its severity moves.
 *   - could not evaluate (not a git work tree, missing/malformed config,
 *     unreadable index) → `ok: false, severity: 'warning'` so the doctor
 *     reports the blind spot without flipping the exit code on an
 *     unrelated failure. Kept non-blocking in BOTH modes: "could not
 *     evaluate" is not a finding about the project, and it is
 *     distinguishable from the `ok: true` "covers the repository"
 *     verdict by its `ok` value.
 *
 * R12-2 — the partial collapse that remains, stated rather than implied:
 * this branch and the advisory `gap` branch below BOTH emit `ok: false`
 * with `severity: 'warning'`, and `DoctorCheck` has no third field, so in
 * the doctor envelope they are separated by message text alone. Not fixed,
 * deliberately: the shape is legacy (`runDoctor` compatibility is a
 * stated constraint), neither state is `ok: true` — so the invariant that
 * a non-measurement may never read as "verified clean" holds — and in the
 * mode where they are collapsed neither state moves the exit code.
 * Under `PEAKS_CODEGRAPH_INDEX_STRICT=1` they ARE separated in the
 * machine fields: the advisory `gap` branch drops its tag, this one keeps
 * it. Pinned by the "(severity policy)" and "(unevaluable)" tests.
 */

import { getErrorMessage } from 'peaks-loop-shared/result';
import { isCodegraphInitialized } from '../../../codegraph/codegraph-service.js';
import {
  CODEGRAPH_INDEX_STRICT_ENV_VAR,
  CODEGRAPH_REPAIR_INDEX_COMMAND,
  inspectCodegraphIndexIntegrity,
  isCodegraphIndexStrictMode
} from '../../../codegraph/codegraph-index-integrity.js';

import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

const CHECK_ID = 'capability:codegraph-index-integrity';
/** How many offending paths the message names per axis before eliding. */
const MAX_NAMED = 5;

function elide(paths: readonly string[]): string {
  const named = paths.slice(0, MAX_NAMED).join(', ');
  return paths.length > MAX_NAMED ? `${named}, … (+${paths.length - MAX_NAMED})` : named;
}

/**
 * 2026-09-17 — `projectRoot` is the doctor's resolved L3 root, NOT
 * `process.cwd()`. It used to read `process.cwd()`, which is a different
 * thing from the root the rest of the doctor was pointed at: a caller that
 * injects `projectRootResolver` (e.g.
 * `tests/unit/doctor/doctor-exit-code-warn-only.test.ts`) got every other
 * check aimed at its temp root while THIS one opened the operator's real
 * `.codegraph/codegraph.db`. Opening that database materialises its
 * `-shm`/`-wal` sidecars, so a unit run mutated the operator's checkout and
 * the check's result depended on which repository you happened to run it
 * in. Every other L3 check reads `resolvedL3Root` from `DoctorContext`;
 * this one now does too.
 */
function defaultProbe(projectRoot: string) {
  // An unresolved root is not a project. It must NOT fall through to a
  // relative lookup (`join('', '.codegraph', …)` resolves against `cwd`),
  // because that fallback IS the defect this signature was changed to close:
  // a caller that never resolved a root would silently inspect the operator's
  // checkout. `runDoctor` always resolves one; only a hand-built test context
  // can pass ''.
  if (projectRoot.length === 0) return null;

  // No index → nothing to be incomplete or stale.
  return isCodegraphInitialized(projectRoot) ? inspectCodegraphIndexIntegrity(projectRoot) : null;
}

function renderGapMessage(
  includeGap: readonly string[],
  admittedTrackedCount: number,
  trackedSourceCount: number,
  deadRows: readonly string[],
  indexedFileCount: number
): string {
  const parts: string[] = [];

  if (includeGap.length > 0) {
    parts.push(
      `${includeGap.length} of ${trackedSourceCount} extractor-supported tracked file(s) are not admitted by the config's include globs (admitted: ${admittedTrackedCount}) [${elide(includeGap)}]`
    );
  }
  if (deadRows.length > 0) {
    parts.push(
      `${deadRows.length} of ${indexedFileCount} indexed file(s) are gone from disk [${elide(deadRows)}]`
    );
  }

  return `codegraph index does not cover the repository: ${parts.join('; ')}.`;
}

// The remediation clause, in both modes. Naming the command is the
// slice-002 half of slice-001's design decision 4 (which deliberately named
// none while none existed); the command name is a shared constant, so this
// message cannot drift from the CLI surface it points at.
function remediation(): string {
  return `Run \`${CODEGRAPH_REPAIR_INDEX_COMMAND}\` to add the missing include pattern(s) and rebuild the index without the stale rows.`;
}

function run({ options, resolvedL3Root }: DoctorContext): readonly DoctorCheck[] {
  const probe = options.codegraphIndexIntegrityProbe ?? (() => defaultProbe(resolvedL3Root));
  const strict = isCodegraphIndexStrictMode();

  let report;
  try {
    report = probe();
  } catch (error) {
    return [
      {
        id: CHECK_ID,
        ok: false,
        severity: 'warning',
        message: `codegraph index integrity could not be evaluated: ${getErrorMessage(error)}`
      }
    ];
  }

  if (report === null) {
    return [
      {
        id: CHECK_ID,
        ok: true,
        message:
          'codegraph is not initialized in this project (no .codegraph/codegraph.db); there is no index to be incomplete or stale'
      }
    ];
  }

  if (!report.gap) {
    return [
      {
        id: CHECK_ID,
        ok: true,
        message: `codegraph index covers the repository (${report.admittedTrackedCount} extractor-supported tracked file(s) admitted, ${report.indexedFileCount} indexed row(s), none stale)`
      }
    ];
  }

  const gapMessage = renderGapMessage(
    report.includeGap,
    report.admittedTrackedCount,
    report.trackedSourceCount,
    report.deadRows,
    report.indexedFileCount
  );

  // Option C: advisory by default, blocking on opt-in. `ok: false` in both
  // modes — the finding is reported either way; only `severity` (and with
  // it the doctor exit code) moves. The advisory suffix is the discovery
  // path for the switch, so an operator who wants blocking is told how.
  return strict
    ? [{ id: CHECK_ID, ok: false, message: `${gapMessage} ${remediation()}` }]
    : [
        {
          id: CHECK_ID,
          ok: false,
          severity: 'warning',
          message: `${gapMessage} ${remediation()} Advisory: set ${CODEGRAPH_INDEX_STRICT_ENV_VAR}=1 to make this blocking.`
        }
      ];
}

export const check: DoctorCheckPlugin = {
  name: 'codegraph-index-integrity',
  run
};
