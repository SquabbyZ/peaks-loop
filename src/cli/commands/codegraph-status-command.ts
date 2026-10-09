// src/cli/commands/codegraph-status-command.ts
//
// `peaks codegraph status` — the two-axis integrity gate (exclude rules +
// index coverage), its `--peaks-json` machine envelope, and the attribution
// of upstream's `[OK] Index is up to date` line.
//
// Extracted verbatim from `codegraph-commands.ts`; `attributeUpstreamUpToDate
// Line` stays importable from `codegraph-commands.ts`, which re-exports it.
// The axis evaluation lives in `codegraph-status-integrity.ts` and the
// machine report in `codegraph-status-json.ts`.

import { resolve } from 'node:path';
import { CODEGRAPH_INTEGRITY_EXIT_CODE } from '../../services/codegraph/codegraph-exclude-integrity.js';
import {
  codegraphIndexIntegrityExitCode,
  type CodegraphIndexIntegrityVerdict
} from '../../services/codegraph/codegraph-index-integrity.js';
import { runCodegraphCommand, type CommonCodegraphOptions } from './codegraph-command-runtime.js';
import { emitIntegrityText, readStatusAxes } from './codegraph-status-integrity.js';
import { runCodegraphStatusJson } from './codegraph-status-json.js';
import type { ProgramIO } from '../cli-helpers.js';

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
 * Gate precedence: exclude wins when both fire (it is the upstream cause,
 * and repairing it also rebuilds the index the staleness axis is about).
 * Then "not evaluated" outranks "gap", because an unmeasured axis must
 * never be reported with the same status as a measured one. See
 * `codegraphIndexIntegrityExitCode`.
 */
function applyStatusExitCode(
  integrityGap: boolean,
  indexVerdict: CodegraphIndexIntegrityVerdict,
  strict: boolean
): void {
  const indexExitCode = codegraphIndexIntegrityExitCode(indexVerdict, strict);
  if (integrityGap) {
    process.exitCode = CODEGRAPH_INTEGRITY_EXIT_CODE;
  } else if (indexExitCode !== null) {
    process.exitCode = indexExitCode;
  }
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
  const axes = readStatusAxes(resolve(options.project));
  const integrityGap = axes.integrity?.gap === true;
  const indexGap = axes.indexVerdict === 'gap';

  if (asJson === true) {
    // Upstream failure outranks both gates — and it already set the exit
    // code to upstream's (see `runCodegraphStatusJson`).
    if (await runCodegraphStatusJson(io, options, axes)) return;
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
      integrityGap || indexGap ? attributeUpstreamUpToDateLine : undefined
    );
    emitIntegrityText(io, axes);
    // Upstream failure outranks both gates — and it already set the exit
    // code to upstream's.
    if (upstreamFailed) return;
  }

  applyStatusExitCode(integrityGap, axes.indexVerdict, axes.strict);
}
