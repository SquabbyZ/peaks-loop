// src/cli/commands/codegraph-repair-commands.ts
//
// `peaks codegraph repair-exclude` and `peaks codegraph repair-index` — the
// explicit repair path, plus the registration of both verbs. Split out of
// `codegraph-commands.ts`; names, options and envelopes are unchanged.

import type { Command } from 'commander';
import {
  repairCodegraphExcludeFromProject,
  type CodegraphExcludeRepairReport
} from '../../services/codegraph/codegraph-exclude-repair.js';
import { resolveProjectRoot } from '../../services/codegraph/codegraph-service.js';
import { ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { printCodegraphFailure, type CommonCodegraphOptions } from './codegraph-command-runtime.js';
import { addProjectOption } from './codegraph-command-options.js';

// The two explicit repair modes. They differ in exactly one thing — whether
// the follow-up index is incremental or a FORCED full rebuild — and that one
// thing is a contract difference, not a flag difference:
//
//   - `repair-exclude` is the documented remedy for exit 74 (an `exclude`
//     rule blocking tracked source files). It keeps the cost profile it
//     shipped with: an ordinary `codegraph index`.
//   - `repair-index` is the remedy for exit 75 (the index does not cover the
//     repository). Dropping rows for files deleted in an earlier commit is
//     only possible with `index --force`, so that is what it runs — the
//     expensive half is the reason it is a separate verb rather than a flag
//     on the cheap one.
//
// Both run the SAME repair — the config's `exclude` rules are reconciled
// against the tracked files, then the index is rebuilt. See
// `codegraph-exclude-repair.ts` for what the repair no longer does.
type CodegraphRepairMode = 'exclude' | 'index';

interface CodegraphRepairModeSpec {
  readonly commandId: string;
  readonly reindex: boolean | 'force';
  readonly noopNote: string;
}

const REPAIR_MODES: Record<CodegraphRepairMode, CodegraphRepairModeSpec> = {
  exclude: {
    commandId: 'codegraph.repair-exclude',
    reindex: true,
    noopNote: 'Nothing to repair in the codegraph config; nothing was written.'
  },
  index: {
    commandId: 'codegraph.repair-index',
    // 'force' is upstream's `clear()` + full re-index — the only documented
    // way to drop rows for files deleted in an earlier commit.
    reindex: 'force',
    noopNote:
      'The codegraph config already admits every supported tracked file and blocks none; the index was still rebuilt from scratch.'
  }
};

// One sentence, the same shape in both modes, because both modes run the
// same repair — only the rebuild differs.
//
// The include clause this sentence used to carry is gone with the include
// axis (see `codegraph-exclude-repair.ts`), which also removed the reason the
// sentence was once split in two: there is a single axis left, and its own
// counter cannot be read as a verdict on another one.
function appliedRepairNote(report: CodegraphExcludeRepairReport): string {
  return (
    `Removed ${report.rulesRemoved.length} exclude rule(s), recovering ${report.filesRecovered} tracked source file(s) that a rule had been hiding.` +
    ` Config backed up to ${report.backupPath ?? ''}.`
  );
}

/**
 * Explicit repair path: reconcile the config's `exclude` rules → back it up →
 * rewrite it → rebuild the index. Mirrors the automatic step `init` runs
 * after a fresh upstream init, for workspaces that were already
 * initialized before the integrity gate existed.
 */
async function runCodegraphRepairCommand(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  asJson: boolean | undefined,
  mode: CodegraphRepairMode
): Promise<void> {
  const spec = REPAIR_MODES[mode];
  let projectRoot: string;
  try {
    // `resolveProjectRoot`, not a hand-rolled `resolve` + `statSync`: it is
    // the canonicalizer every codegraph invocation already goes through
    // (`createCodegraphInvocation`), so the config path this verb reports
    // and writes names the SAME directory the spawn and the other verbs use
    // even when `--project` is a symlink, a short name or a differently
    // cased alias. The error path is unchanged.
    projectRoot = resolveProjectRoot(options.project);
  } catch (error) {
    printCodegraphFailure(io, spec.commandId, error, asJson);
    return;
  }

  const report = await repairCodegraphExcludeFromProject(projectRoot, undefined, {
    reindex: spec.reindex
  });

  // Where the notes go matters: `printResult` renders every `warnings`
  // entry to stderr with a `warning: ` prefix, so a confirmation parked
  // in the third slot reads as a problem — and a real warning parked
  // there double-prefixes. Confirmations go to `nextActions`; only a
  // genuine `report.warning` reaches `warnings`, verbatim.
  const confirmations: string[] = [report.applied ? appliedRepairNote(report) : spec.noopNote];
  if (report.applied || mode === 'index') {
    confirmations.push(
      'Re-run `peaks codegraph status --project <root>` to confirm the gap is closed.'
    );
  }

  printResult(
    io,
    ok(
      spec.commandId,
      {
        applied: report.applied,
        rulesRemoved: report.rulesRemoved,
        filesRecovered: report.filesRecovered,
        configPath: report.configPath,
        backupPath: report.backupPath,
        reindexed: report.reindexed,
        forcedRebuild: report.forcedRebuild,
        warning: report.warning
      },
      report.warning === null ? [] : [report.warning],
      confirmations
    ),
    asJson
  );

  // A repair that could not run to completion (or could not reindex)
  // must not report success to a shell.
  if (report.warning !== null) {
    process.exitCode = 1;
  }
}

export function registerCodegraphRepairCommands(codegraph: Command, io: ProgramIO): void {
  addProjectOption(
    codegraph
      .command('repair-exclude')
      .description(
        'Drop config exclude rules that block tracked source files, then rebuild the index'
      )
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphRepairCommand(io, options, options.peaksJson, 'exclude')
  );

  addProjectOption(
    codegraph
      .command('repair-index')
      .description(
        'Drop config exclude rules that block tracked source files, then rebuild the index from scratch (drops rows for deleted files)'
      )
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphRepairCommand(io, options, options.peaksJson, 'index')
  );
}
