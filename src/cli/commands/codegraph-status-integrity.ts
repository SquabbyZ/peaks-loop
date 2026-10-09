// src/cli/commands/codegraph-status-integrity.ts
//
// The two integrity axes `peaks codegraph status` evaluates, and the human
// reading of them. Split out of `codegraph-status-command.ts`; every
// applicability predicate, degradation rule and printed line is unchanged.

import {
  type CodegraphExcludeIntegrityReport,
  inspectCodegraphExcludeIntegrity,
  isCodegraphExcludeConfigPresent,
  renderCodegraphExcludeIntegrityLines
} from '../../services/codegraph/codegraph-exclude-integrity.js';
import {
  type CodegraphIndexIntegrityDeps,
  type CodegraphIndexIntegrityReport,
  type CodegraphIndexIntegrityVerdict,
  inspectCodegraphIndexIntegrity,
  isCodegraphIndexStrictMode,
  renderCodegraphIndexIntegrityLines,
  resolveCodegraphIndexIntegrityVerdict
} from '../../services/codegraph/codegraph-index-integrity.js';
import { isCodegraphInitialized } from '../../services/codegraph/codegraph-service.js';
import { readCodegraphProjectInputs } from '../../services/codegraph/codegraph-exclude-reconciler.js';
import { getErrorMessage, type ProgramIO } from '../cli-helpers.js';

/** Everything both the human and the machine branches of `status` report. */
export type CodegraphStatusAxes = {
  readonly integrity: CodegraphExcludeIntegrityReport | null;
  readonly integrityWarning: string | null;
  readonly indexIntegrity: CodegraphIndexIntegrityReport | null;
  readonly indexIntegrityWarning: string | null;
  readonly indexVerdict: CodegraphIndexIntegrityVerdict;
  readonly strict: boolean;
};

/**
 * Read both axes for a project root.
 *
 * R12-1: the two axes have DIFFERENT applicability predicates, and folding
 * them into the config's alone is how a db-present / config-absent project
 * came to exit 0 in SILENCE — under `PEAKS_CODEGRAPH_INDEX_STRICT=1` too.
 * "Could not evaluate" is a verdict; it may not be spelled the same way as
 * "verified clean" merely because the read happened to be gated out.
 *
 *   - exclude axis: applicable iff `.codegraph/config.json` exists. The
 *     config IS the subject of that axis, so with no config there is no
 *     exclusion list in play — `not-applicable`, silent, as before.
 *   - index axis: applicable iff `.codegraph/codegraph.db` exists — the
 *     SAME predicate the doctor's `defaultProbe` uses
 *     (`isCodegraphInitialized` in
 *     `doctor-service/checks/codegraph-index-integrity.ts`), so the two
 *     consumers now agree about when the axis is evaluable at all. The
 *     index is the subject here and the config is only an INPUT it reads,
 *     so a missing config is "could not evaluate" (exit 76, `[FAIL]`),
 *     not "nothing to evaluate".
 *
 * The user's constraint holds either way: an absent config is LEGITIMATE
 * for a project that never ran `peaks codegraph init` — with no db BOTH
 * predicates are false and the command stays silent exactly as before.
 *
 * The two axes are evaluated INDEPENDENTLY: an unreadable index must not
 * blind the exclude verdict, and a malformed exclude list must not hide a
 * stale index. Each failure degrades to its own warning.
 */
export function readStatusAxes(projectRoot: string): CodegraphStatusAxes {
  let integrity: CodegraphExcludeIntegrityReport | null = null;
  let integrityWarning: string | null = null;
  let indexIntegrity: CodegraphIndexIntegrityReport | null = null;
  let indexIntegrityWarning: string | null = null;
  const configPresent = isCodegraphExcludeConfigPresent(projectRoot);
  const indexPresent = isCodegraphInitialized(projectRoot);

  if (configPresent || indexPresent) {
    // Perf audit F1: both axes need the SAME tracked-file list and the SAME
    // config, and reading them per-axis spawned `git ls-files` twice per
    // command and re-ran the identical 32-glob `include` filter. Read once
    // and hand the values to both inspectors through their deps seam.
    let sharedInputs: CodegraphIndexIntegrityDeps | null = null;
    try {
      sharedInputs = readCodegraphProjectInputs(projectRoot);
    } catch (error) {
      // One read, two blind axes — they consume exactly these two inputs,
      // so a failure here blinds both. Report it on both, rather than
      // letting the second axis re-run the same failing read to find out.
      // Each axis claims the failure only where it was applicable at all:
      // an unreadable CONFIG is not an exclude-axis finding on a project
      // that has no config by design.
      if (configPresent) integrityWarning = getErrorMessage(error);
      if (indexPresent) indexIntegrityWarning = getErrorMessage(error);
    }

    if (sharedInputs !== null) {
      if (configPresent) {
        try {
          integrity = inspectCodegraphExcludeIntegrity(projectRoot, sharedInputs);
        } catch (error) {
          integrityWarning = getErrorMessage(error);
        }
      }
      // The index axis needs an index. A config without `codegraph.db` is a
      // pre-init / dangling state, not a defect: there are no rows to be
      // stale and nothing `include` withheld from a graph that does not exist.
      if (indexPresent) {
        try {
          indexIntegrity = inspectCodegraphIndexIntegrity(projectRoot, sharedInputs);
        } catch (error) {
          indexIntegrityWarning = getErrorMessage(error);
        }
      }
    }
  }

  return {
    integrity,
    integrityWarning,
    indexIntegrity,
    indexIntegrityWarning,
    indexVerdict: resolveCodegraphIndexIntegrityVerdict(indexIntegrity, indexIntegrityWarning),
    strict: isCodegraphIndexStrictMode()
  };
}

/** The human-readable axis report, printed only by the non-JSON branch. */
export function emitIntegrityText(io: ProgramIO, axes: CodegraphStatusAxes): void {
  if (axes.integrityWarning !== null) {
    io.stdout(`[WARN] codegraph exclude integrity not evaluated: ${axes.integrityWarning}`);
  } else if (axes.integrity !== null) {
    for (const line of renderCodegraphExcludeIntegrityLines(axes.integrity)) {
      io.stdout(line);
    }
  }
  if (axes.indexVerdict === 'not-evaluated') {
    // `[FAIL]`, in every mode, because the command exits non-zero in
    // every mode: the axis was attempted and failed, so this is not a
    // statement about the index. Distinct wording from the gap line so
    // the two can never be confused.
    io.stdout(
      `[FAIL] codegraph index integrity could not be evaluated (the index was NOT measured): ${axes.indexIntegrityWarning ?? 'unknown cause'}`
    );
  } else if (axes.indexIntegrity !== null) {
    for (const line of renderCodegraphIndexIntegrityLines(axes.indexIntegrity, axes.strict)) {
      io.stdout(line);
    }
  }
}
