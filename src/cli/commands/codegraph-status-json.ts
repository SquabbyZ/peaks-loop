// src/cli/commands/codegraph-status-json.ts
//
// The `--peaks-json` machine report for `peaks codegraph status`. Split out of
// `codegraph-status-command.ts`; every envelope code, message, `data` field,
// next-action string and exit-code rule is unchanged.
//
// EXIT-CODE PRECEDENCE (decided here, mirrored on the human path, pinned
// by tests on BOTH axes):
//
//   1. upstream failed      → upstream's exit code. Ranked FIRST because
//      every gate's remedy assumes upstream can run, and because the
//      gate's own branches would otherwise MASK a real command failure:
//      under the advisory default a gap exits 0, so a "gate first" order
//      would turn "upstream failed + gap" into exit 0 — the gate hiding a
//      failure. The gate verdicts stay in `data` verbatim, so ranking
//      them lower hides nothing.
//   2. exclude gap          → 74 (`CODEGRAPH_INDEX_INCOMPLETE`).
//   3. index not evaluated  → 76 (`CODEGRAPH_INDEX_NOT_EVALUATED`): the
//      axis was attempted and failed, which is NOT "verified clean".
//   4. index gap            → 75 (`CODEGRAPH_INDEX_GAP`) in strict mode,
//      0 in the advisory default.
//
// The envelope still reports the finding in case 4 (`ok:false`, the same
// `code`, plus `indexIntegritySeverity: 'warning'`) — the policy governs
// the EXIT CODE, not whether the finding is visible. This mirrors the
// doctor's established convention: `ok:false` + `severity:'warning'`
// surfaces the finding without escalating the exit code.

import { fail, ok } from 'peaks-loop-shared/result';

import {
  CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE,
  CODEGRAPH_INDEX_STRICT_ENV_VAR,
  CODEGRAPH_REPAIR_INDEX_COMMAND
} from '../../services/codegraph/codegraph-index-integrity.js';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphExecutionResult
} from '../../services/codegraph/codegraph-service.js';
import { printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  localizeUpstreamCodegraphText,
  printCodegraphFailure,
  type CommonCodegraphOptions
} from './codegraph-command-runtime.js';
import type { CodegraphStatusAxes } from './codegraph-status-integrity.js';

/** The localised upstream result, as the envelope reports it. */
type UpstreamReport = {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

type StatusReport = {
  readonly upstream: UpstreamReport;
  readonly data: Record<string, unknown>;
};

/**
 * `--peaks-json` machine report for `status`. Carries the upstream
 * result AND the peaks-loop integrity verdict as one JSON document so a
 * CI job can gate on `data.integrity.gap` / `data.integrity.rulesToRemove`
 * without scraping human text.
 */
function buildStatusReport(
  result: CodegraphExecutionResult,
  axes: CodegraphStatusAxes
): StatusReport {
  const upstream: UpstreamReport = {
    exitCode: result.exitCode,
    stdout: localizeUpstreamCodegraphText(result.stdout).trimEnd(),
    stderr: redactSensitiveErrorMessage(localizeUpstreamCodegraphText(result.stderr)).trimEnd()
  };
  return {
    upstream,
    data: {
      upstream,
      integrity: axes.integrity,
      integrityWarning: axes.integrityWarning,
      indexIntegrity: axes.indexIntegrity,
      indexIntegrityWarning: axes.indexIntegrityWarning,
      indexIntegrityVerdict: axes.indexVerdict,
      // Only meaningful where there IS a finding: a `clean` or `not-applicable`
      // axis has no severity, and reporting `'warning'` there would read as
      // "something was wrong but advisory".
      indexIntegritySeverity:
        axes.indexVerdict === 'gap' ? (axes.strict ? 'error' : 'warning') : null
    }
  };
}

/** The refusal an index gap produces, in strict or advisory wording. */
function indexGapVerdict(axes: CodegraphStatusAxes): {
  readonly message: string;
  readonly nextActions: string[];
} {
  const includeGap = axes.indexIntegrity?.includeGap.length ?? 0;
  const deadRows = axes.indexIntegrity?.deadRows.length ?? 0;
  return {
    message: `codegraph index does not cover the repository: ${includeGap} extractor-supported tracked file(s) are not admitted by the config's include globs, and ${deadRows} index row(s) point at files that no longer exist.`,
    nextActions: axes.strict
      ? [
          'The index must admit every extractor-supported tracked file and hold no row for a path that is gone.',
          `Run \`${CODEGRAPH_REPAIR_INDEX_COMMAND}\` to drop the blocking exclude rules and rebuild the index without the stale rows.`
        ]
      : [
          'Advisory: this gap is reported as a warning and the command exits 0.',
          `Set ${CODEGRAPH_INDEX_STRICT_ENV_VAR}=1 to make it blocking (exit ${CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE}).`,
          `Run \`${CODEGRAPH_REPAIR_INDEX_COMMAND}\` to drop the blocking exclude rules and rebuild the index without the stale rows.`
        ]
  };
}

/** Upstream failed: its exit code outranks both gates, so it is ranked first. */
function emitUpstreamFailure(
  io: ProgramIO,
  result: CodegraphExecutionResult,
  report: StatusReport
): void {
  const { stdout, stderr } = report.upstream;
  printResult(
    io,
    fail(
      'codegraph.status',
      'CODEGRAPH_COMMAND_FAILED',
      redactSensitiveErrorMessage(
        stderr || stdout || `codegraph exited with code ${String(result.exitCode)}`
      ),
      report.data,
      ['Check the codegraph project path before retrying']
    ),
    true
  );
}

/** The gate verdicts, in precedence order, when upstream itself succeeded. */
function emitGateVerdict(
  io: ProgramIO,
  axes: CodegraphStatusAxes,
  data: Record<string, unknown>
): void {
  const integrity = axes.integrity;
  if (integrity?.gap === true) {
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
    return;
  }
  if (axes.indexVerdict === 'not-evaluated') {
    // Distinct from the `ok` branch below on purpose: this axis produced
    // NO verdict, and the envelope must not read as "index verified".
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_INDEX_NOT_EVALUATED',
        `codegraph index integrity could not be evaluated: ${axes.indexIntegrityWarning ?? 'unknown cause'}`,
        data,
        [
          'The index was NOT measured — this is not a statement that the index is correct.',
          'Re-run once the cause above is resolved.'
        ]
      ),
      true
    );
    return;
  }
  if (axes.indexVerdict === 'gap') {
    const verdict = indexGapVerdict(axes);
    printResult(
      io,
      fail('codegraph.status', 'CODEGRAPH_INDEX_GAP', verdict.message, data, verdict.nextActions),
      true
    );
    return;
  }
  printResult(io, ok('codegraph.status', data), true);
}

/** Returns true when upstream failed (the caller must stop before the gates). */
export async function runCodegraphStatusJson(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  axes: CodegraphStatusAxes
): Promise<boolean> {
  let result: CodegraphExecutionResult;
  try {
    result = await executeCodegraphInvocation(
      createCodegraphInvocation({ subcommand: 'status', project: options.project })
    );
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.status', error, true);
    return true;
  }

  const report = buildStatusReport(result, axes);
  if (result.exitCode !== null && result.exitCode !== 0) {
    emitUpstreamFailure(io, result, report);
    process.exitCode = result.exitCode ?? 1;
    return true;
  }
  emitGateVerdict(io, axes, report.data);
  return false;
}
