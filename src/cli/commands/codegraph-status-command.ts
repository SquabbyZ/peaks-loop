// src/cli/commands/codegraph-status-command.ts
//
// `peaks codegraph status` — the two-axis integrity gate (exclude rules +
// index coverage), its `--peaks-json` machine envelope, and the attribution
// of upstream's `[OK] Index is up to date` line.
//
// Extracted verbatim from `codegraph-commands.ts` (rid
// 2026-09-17-oversize-and-scale, D1 — the 800-line file-size cap). Every moved
// line is byte-identical and no behaviour changed; `attributeUpstreamUpToDate
// Line` stays importable from `codegraph-commands.ts`, which re-exports it.

import { resolve } from 'node:path';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  isCodegraphInitialized
} from '../../services/codegraph/codegraph-service.js';
import {
  CODEGRAPH_INTEGRITY_EXIT_CODE,
  inspectCodegraphExcludeIntegrity,
  isCodegraphExcludeConfigPresent,
  renderCodegraphExcludeIntegrityLines,
  type CodegraphExcludeIntegrityReport
} from '../../services/codegraph/codegraph-exclude-integrity.js';
import {
  CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE,
  CODEGRAPH_INDEX_STRICT_ENV_VAR,
  CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE,
  CODEGRAPH_REPAIR_INDEX_COMMAND,
  codegraphIndexIntegrityExitCode,
  inspectCodegraphIndexIntegrity,
  isCodegraphIndexStrictMode,
  renderCodegraphIndexIntegrityLines,
  resolveCodegraphIndexIntegrityVerdict,
  type CodegraphIndexIntegrityDeps,
  type CodegraphIndexIntegrityReport,
  type CodegraphIndexIntegrityVerdict
} from '../../services/codegraph/codegraph-index-integrity.js';
import { readCodegraphProjectInputs } from '../../services/codegraph/codegraph-exclude-reconciler.js';
import { fail, ok } from 'peaks-loop-shared/result';

import {
  getErrorMessage,
  printResult,
  redactSensitiveErrorMessage,
  type ProgramIO
} from '../cli-helpers.js';
import {
  printCodegraphFailure,
  rewriteBareCodegraphHints,
  runCodegraphCommand,
  type CommonCodegraphOptions
} from './codegraph-command-runtime.js';

const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Upstream `status` answers a different question than peaks-loop's
 * integrity gate: upstream says "the on-disk graph matches the last scan"
 * (true), peaks says "that graph covers the repository" (false when rules
 * exclude tracked files). Both verdicts are correct, but an unqualified
 * `[OK] Index is up to date` printed above our `[FAIL] ...` reads as
 * "nothing to see here" — and the OK is the line the eye lands on first.
 * The exit code and the JSON envelope are already right; only this line
 * lies by juxtaposition.
 *
 * So: keep upstream's wording — the line stays recognizable, and the
 * Files/Nodes counts around it are untouched — but drop the bare OK
 * marker and name the only question it answers. Clean runs never reach
 * this, so their output stays byte-identical.
 *
 * The match is anchored to THAT line. An earlier version keyed on
 * `includes('up to date')`, which is content-blind: upstream prints other
 * `[OK] ... are up to date` lines (a language-server or watcher line is the
 * observed one), and each of those was rewritten into a claim about the
 * INDEX — a misattribution introduced by a change whose entire purpose was
 * to stop misleading output. Anything that is not the index line is passed
 * through byte-for-byte, tail note and all.
 */
const INDEX_UP_TO_DATE_RE = /^\[OK\]\s+Index is up to date\b/i;

export function attributeUpstreamUpToDateLine(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => {
      const visible = line.replace(ANSI_SGR_PATTERN, '').trim();
      if (!INDEX_UP_TO_DATE_RE.test(visible)) {
        return line;
      }

      // Only the OK marker is downgraded and the attribution appended: the
      // rest of the line — including whatever upstream wrote after it — is
      // preserved, so nothing upstream actually said is replaced.
      const withoutOk = visible.replace(/^\[OK\]\s*/, '');
      return `[i] ${withoutOk} (upstream: matches the last scan only; repository coverage is answered below)`;
    })
    .join('\n');
}

/**
 * `--peaks-json` machine report for `status`. Carries the upstream
 * result AND the peaks-loop integrity verdict as one JSON document so a
 * CI job can gate on `data.integrity.gap` / `data.integrity.rulesToRemove`
 * without scraping human text.
 *
 * EXIT-CODE PRECEDENCE (decided here, mirrored on the human path, pinned
 * by tests on BOTH axes):
 *
 *   1. upstream failed      → upstream's exit code. Ranked FIRST because
 *      every gate's remedy assumes upstream can run, and because the
 *      gate's own branches would otherwise MASK a real command failure:
 *      under the advisory default a gap exits 0, so a "gate first" order
 *      would turn "upstream failed + gap" into exit 0 — the gate hiding a
 *      failure. The gate verdicts stay in `data` verbatim, so ranking
 *      them lower hides nothing.
 *   2. exclude gap          → 74 (`CODEGRAPH_INDEX_INCOMPLETE`).
 *   3. index not evaluated  → 76 (`CODEGRAPH_INDEX_NOT_EVALUATED`): the
 *      axis was attempted and failed, which is NOT "verified clean".
 *   4. index gap            → 75 (`CODEGRAPH_INDEX_GAP`) in strict mode,
 *      0 in the advisory default.
 *
 * The envelope still reports the finding in case 4 (`ok:false`, the same
 * `code`, plus `indexIntegritySeverity: 'warning'`) — the policy governs
 * the EXIT CODE, not whether the finding is visible. This mirrors the
 * doctor's established convention: `ok:false` + `severity:'warning'`
 * surfaces the finding without escalating the exit code.
 */
async function runCodegraphStatusJson(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  integrity: CodegraphExcludeIntegrityReport | null,
  integrityWarning: string | null,
  indexIntegrity: CodegraphIndexIntegrityReport | null,
  indexIntegrityWarning: string | null,
  indexVerdict: CodegraphIndexIntegrityVerdict,
  strict: boolean
): Promise<boolean> {
  let result;
  try {
    result = await executeCodegraphInvocation(
      createCodegraphInvocation({ subcommand: 'status', project: options.project })
    );
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.status', error, true);
    return true;
  }

  const upstream = {
    exitCode: result.exitCode,
    stdout: rewriteBareCodegraphHints(result.stdout).trimEnd(),
    stderr: redactSensitiveErrorMessage(rewriteBareCodegraphHints(result.stderr)).trimEnd()
  };
  const upstreamFailed = result.exitCode !== null && result.exitCode !== 0;
  const data = {
    upstream,
    integrity,
    integrityWarning,
    indexIntegrity,
    indexIntegrityWarning,
    indexIntegrityVerdict: indexVerdict,
    // Only meaningful where there IS a finding: a `clean` or `not-applicable`
    // axis has no severity, and reporting `'warning'` there would read as
    // "something was wrong but advisory".
    indexIntegritySeverity: indexVerdict === 'gap' ? (strict ? 'error' : 'warning') : null
  };

  if (upstreamFailed) {
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_COMMAND_FAILED',
        redactSensitiveErrorMessage(
          upstream.stderr ||
            upstream.stdout ||
            `codegraph exited with code ${String(result.exitCode)}`
        ),
        data,
        ['Check the codegraph project path before retrying']
      ),
      true
    );
  } else if (integrity?.gap === true) {
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_INDEX_INCOMPLETE',
        `codegraph index is incomplete: ${integrity.excludedTrackedCount} of ${integrity.trackedSourceCount} tracked source files are excluded by ${integrity.rulesToRemove.length} rule(s).`,
        data,
        [
          'Run `peaks codegraph repair-exclude --project <root>` to drop the offending rules and rebuild the index.'
        ]
      ),
      true
    );
  } else if (indexVerdict === 'not-evaluated') {
    // Distinct from the `ok` branch below on purpose: this axis produced
    // NO verdict, and the envelope must not read as "index verified".
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_INDEX_NOT_EVALUATED',
        `codegraph index integrity could not be evaluated: ${indexIntegrityWarning ?? 'unknown cause'}`,
        data,
        [
          'The index was NOT measured — this is not a statement that the index is correct.',
          'Re-run once the cause above is resolved.'
        ]
      ),
      true
    );
  } else if (indexVerdict === 'gap') {
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_INDEX_GAP',
        `codegraph index does not cover the repository: ${indexIntegrity?.includeGap.length ?? 0} extractor-supported tracked file(s) are not admitted by the config's include globs, and ${indexIntegrity?.deadRows.length ?? 0} index row(s) point at files that no longer exist.`,
        data,
        strict
          ? [
              'The index must admit every extractor-supported tracked file and hold no row for a path that is gone.',
              `Run \`${CODEGRAPH_REPAIR_INDEX_COMMAND}\` to add the missing include pattern(s) and rebuild the index without the stale rows.`
            ]
          : [
              'Advisory: this gap is reported as a warning and the command exits 0.',
              `Set ${CODEGRAPH_INDEX_STRICT_ENV_VAR}=1 to make it blocking (exit ${CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE}).`,
              `Run \`${CODEGRAPH_REPAIR_INDEX_COMMAND}\` to add the missing include pattern(s) and rebuild the index without the stale rows.`
            ]
      ),
      true
    );
  } else {
    printResult(io, ok('codegraph.status', data), true);
  }

  if (upstreamFailed) {
    process.exitCode = result.exitCode ?? 1;
  }

  return upstreamFailed;
}

/**
 * `peaks codegraph status` with an integrity gate.
 *
 * The upstream status is still proxied verbatim (that is what the
 * command has always done), but a clean upstream "index is up to date"
 * is no longer sufficient: when git-tracked source files are being
 * excluded by the config, or the index itself does not cover the
 * repository, the command says so and names the rules and files.
 *
 * SEVERITY (user decision, option C): the exclude gate keeps its shipped
 * blocking behaviour (exit 74); the index gate is ADVISORY by default and
 * blocking only when `PEAKS_CODEGRAPH_INDEX_STRICT` is set. A detected
 * gap is the finding either way — only the tag and the exit code move.
 *
 * Read-only by construction — it imports the integrity inspectors, never
 * the repair writer. Fixing the config is `peaks codegraph init`
 * (fresh) or `peaks codegraph repair-exclude` (explicit).
 */
export async function runCodegraphStatusCommand(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  asJson?: boolean
): Promise<void> {
  let integrity: CodegraphExcludeIntegrityReport | null = null;
  let integrityWarning: string | null = null;
  let indexIntegrity: CodegraphIndexIntegrityReport | null = null;
  let indexIntegrityWarning: string | null = null;
  const projectRoot = resolve(options.project);
  const strict = isCodegraphIndexStrictMode();
  // R12-1: the two axes have DIFFERENT applicability predicates, and folding
  // them into the config's alone is how a db-present / config-absent project
  // came to exit 0 in SILENCE — under `PEAKS_CODEGRAPH_INDEX_STRICT=1` too.
  // "Could not evaluate" is a verdict; it may not be spelled the same way as
  // "verified clean" merely because the read happened to be gated out.
  //
  //   - exclude axis: applicable iff `.codegraph/config.json` exists. The
  //     config IS the subject of that axis, so with no config there is no
  //     exclusion list in play — `not-applicable`, silent, as before.
  //   - index axis: applicable iff `.codegraph/codegraph.db` exists — the
  //     SAME predicate the doctor's `defaultProbe` uses
  //     (`isCodegraphInitialized` in
  //     `doctor-service/checks/codegraph-index-integrity.ts`), so the two
  //     consumers now agree about when the axis is evaluable at all. The
  //     index is the subject here and the config is only an INPUT it reads,
  //     so a missing config is "could not evaluate" (exit 76, `[FAIL]`),
  //     not "nothing to evaluate".
  //
  // The user's constraint holds either way: an absent config is LEGITIMATE
  // for a project that never ran `peaks codegraph init` — with no db BOTH
  // predicates are false and the command stays silent exactly as before.
  const configPresent = isCodegraphExcludeConfigPresent(projectRoot);
  const indexPresent = isCodegraphInitialized(projectRoot);

  // The two axes are evaluated INDEPENDENTLY: an unreadable index must not
  // blind the exclude verdict, and a malformed exclude list must not hide a
  // stale index. Each failure degrades to its own warning.
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
      if (configPresent) {
        integrityWarning = getErrorMessage(error);
      }
      if (indexPresent) {
        indexIntegrityWarning = getErrorMessage(error);
      }
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

  const indexVerdict = resolveCodegraphIndexIntegrityVerdict(indexIntegrity, indexIntegrityWarning);
  const indexGap = indexVerdict === 'gap';

  if (asJson === true) {
    const upstreamFailed = await runCodegraphStatusJson(
      io,
      options,
      integrity,
      integrityWarning,
      indexIntegrity,
      indexIntegrityWarning,
      indexVerdict,
      strict
    );
    // Upstream failure outranks both gates — and it already set the exit
    // code to upstream's (see `runCodegraphStatusJson`).
    if (upstreamFailed) {
      return;
    }
  } else {
    // Only when a gate found a gap: upstream's `[OK] Index is up
    // to date` answers "consistent with the last scan", and printing it
    // unqualified right above our verdict tells the reader two opposite
    // things at once. Clean runs get no transform and stay byte-identical.
    const upstreamFailed = await runCodegraphCommand(
      io,
      'codegraph.status',
      { subcommand: 'status', project: options.project },
      false,
      integrity?.gap === true || indexGap ? attributeUpstreamUpToDateLine : undefined
    );

    if (integrityWarning !== null) {
      io.stdout(`[WARN] codegraph exclude integrity not evaluated: ${integrityWarning}`);
    } else if (integrity !== null) {
      for (const line of renderCodegraphExcludeIntegrityLines(integrity)) {
        io.stdout(line);
      }
    }
    if (indexVerdict === 'not-evaluated') {
      // `[FAIL]`, in every mode, because the command exits non-zero in
      // every mode: the axis was attempted and failed, so this is not a
      // statement about the index. Distinct wording from the gap line so
      // the two can never be confused.
      io.stdout(
        `[FAIL] codegraph index integrity could not be evaluated (the index was NOT measured): ${indexIntegrityWarning ?? 'unknown cause'}`
      );
    } else if (indexIntegrity !== null) {
      for (const line of renderCodegraphIndexIntegrityLines(indexIntegrity, strict)) {
        io.stdout(line);
      }
    }

    // Upstream failure outranks both gates — and it already set the exit
    // code to upstream's.
    if (upstreamFailed) {
      return;
    }
  }

  // Gate precedence: exclude wins when both fire (it is the upstream cause,
  // and repairing it also rebuilds the index the staleness axis is about).
  // Then "not evaluated" outranks "gap", because an unmeasured axis must
  // never be reported with the same status as a measured one. See
  // `codegraphIndexIntegrityExitCode`.
  const indexExitCode = codegraphIndexIntegrityExitCode(indexVerdict, strict);
  if (integrity?.gap === true) {
    process.exitCode = CODEGRAPH_INTEGRITY_EXIT_CODE;
  } else if (indexExitCode !== null) {
    process.exitCode = indexExitCode;
  }
}
