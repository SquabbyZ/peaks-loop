// src/cli/commands/codegraph-init-command.ts
//
// `peaks codegraph init` — the guarded init action.
//
// What it guarantees: it never reinitializes over a directory another tool
// owns (`--force` is the only way past that, and it refuses a link and a
// peaks-loop-marked directory); a successful init always stamps the peaks-loop
// marker; the default exclude/include templates are reconciled before the
// command returns; and upstream's own output reaches the reader localized, the
// same way every other codegraph verb does.

import { statSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createCodegraphInvocation,
  CodegraphInitConflictError,
  defaultCodegraphInitGuard,
  executeCodegraphInvocation,
  writeCodegraphMarker
} from '../../services/codegraph/codegraph-service.js';
import {
  repairCodegraphExcludeFromProject,
  type CodegraphExcludeRepairReport
} from '../../services/codegraph/codegraph-exclude-repair.js';
import { forcePastForeignConflict } from '../../services/codegraph/codegraph-foreign-removal.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  localizeUpstreamCodegraphText,
  printCodegraphFailure,
  type CommonCodegraphOptions
} from './codegraph-command-runtime.js';

/** `peaks codegraph init`'s own flags. Upstream `init` takes none. */
export interface CodegraphInitOptions extends CommonCodegraphOptions {
  force?: boolean;
}

// " Include now admits 7 of 9 extractor-supported tracked file(s)." — printed
// only when the ratio reports a SHORTFALL, i.e. when the repair has left
// files the extractor supports unadmitted. That is the one reading of this
// sentence an operator can act on.
//
// the reconciler's admitted count — the NUMERATOR's own expression — so the
// clause could only ever print "N of N", and it was gated on
// `after > before` with a "(was N)" trailer computed by a second full glob
// pass. A repo with 10 supported tracked files of which 5 were admitted was
// told "5 of 5", asserting total coverage that nothing had measured. The
// denominator is now an independent measurement (see the report field), and
// the trailer — whose only consumer was this sentence — is gone with the
// pass that produced it (perf: 11.73 ms of the repair entry's +14.13 ms, on
// every automatic seam including no-ops).
//
// Silence when the ratio is complete is deliberate: "2 of 2" is true but
// says nothing, and the patterns that changed are already named by the
// caller's own sentence.

export function admittingClause(report: CodegraphExcludeRepairReport): string {
  if (report.trackedSourceCount === 0 || report.includeAdmittedAfter >= report.trackedSourceCount) {
    return '';
  }

  return ` Include now admits ${report.includeAdmittedAfter} of ${report.trackedSourceCount} extractor-supported tracked file(s).`;
}

async function runCodegraphInitCommand(
  io: ProgramIO,
  options: CodegraphInitOptions,
  asJson?: boolean
): Promise<void> {
  let projectRoot: string;
  try {
    const candidate = resolve(options.project);
    if (!statSync(candidate).isDirectory()) {
      throw new Error('Project path must exist and be a directory');
    }
    projectRoot = candidate;
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.init', error, asJson);
    return;
  }

  let guardOutcome = defaultCodegraphInitGuard(projectRoot);
  // `--force` replaces a FOREIGN `.codegraph/` (never a link, never our own
  // marked index — codegraph-foreign-removal.ts). Re-running the guard after
  // the removal means everything below sees an ordinary fresh init.
  let foreignRemoved: string | null = null;
  if (guardOutcome.status === 'conflict-foreign-schema' && options.force === true) {
    try {
      const forced = forcePastForeignConflict(projectRoot);
      foreignRemoved = forced.removed;
      guardOutcome = forced.outcome;
    } catch (error) {
      printCodegraphFailure(io, 'codegraph.init', error, asJson);
      process.exitCode = 1;
      return;
    }
  }

  if (guardOutcome.status === 'noop-already-peaks-loop') {
    printResult(
      io,
      ok(
        'codegraph.init',
        {
          guard: guardOutcome.status,
          codegraphDir: guardOutcome.codegraphDir,
          markerPresent: true
        },
        // A no-op init is a SUCCESS. This message used to sit in the
        // `warnings` slot and was therefore printed as
        // `warning: .codegraph/ is already managed by peaks-loop...`.
        [],
        [
          `.codegraph/ is already managed by peaks-loop; init is a no-op. Marker: ${guardOutcome.codegraphDir}/.peaks-loop-marker`,
          'Run `peaks codegraph index` to (re)build the index without touching the schema.'
        ]
      ),
      asJson
    );
    return;
  }

  if (guardOutcome.status === 'conflict-foreign-schema') {
    const conflict = new CodegraphInitConflictError(
      `Refusing to init: ${guardOutcome.codegraphDir} already exists with a non-peaks-loop schema. ` +
        'Move or rename the foreign directory, then re-run `peaks codegraph init`.',
      guardOutcome.codegraphDir
    );
    printResult(
      io,
      fail(
        'codegraph.init',
        conflict.code,
        conflict.message,
        { codegraphDir: conflict.codegraphDir },
        [
          'Move or rename the foreign .codegraph/ directory before retrying.',
          'Or remove .codegraph/ if you are sure no other tool owns it.',
          'Or run `peaks codegraph init --project <path> --force` to delete the foreign directory and initialize fresh (no backup; a link or a peaks-loop-marked directory is refused).'
        ]
      ),
      asJson
    );
    process.exitCode = conflict.exitCode;
    return;
  }

  // guardOutcome.status === 'fresh' — proceed.
  try {
    const invocation = createCodegraphInvocation({
      subcommand: 'init',
      project: options.project
    });
    const result = await executeCodegraphInvocation(invocation);
    const didFail = result.exitCode !== null && result.exitCode !== 0;
    // This path forwarded upstream
    // verbatim, so the SQLite-backend advice for a dependency this project
    // removed still reached the reader here.
    const upstreamStdout = localizeUpstreamCodegraphText(result.stdout);
    const upstreamStderr = localizeUpstreamCodegraphText(result.stderr);

    if (upstreamStdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(upstreamStdout) : upstreamStdout).trimEnd());
    }
    if (upstreamStderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(upstreamStderr) : upstreamStderr).trimEnd());
    }

    if (didFail) {
      if (asJson === true) {
        printCodegraphFailure(
          io,
          'codegraph.init',
          new Error(
            upstreamStderr || upstreamStdout || `codegraph exited with code ${result.exitCode}`
          ),
          true,
          result.exitCode ?? 1
        );
      }
      process.exitCode = result.exitCode ?? 1;
      return;
    }

    // Upstream succeeded — stamp the marker so the next run hits the
    // noop branch. Best-effort: a marker-write failure must NOT undo
    // the upstream init (peaks-loop still owns the schema logically).
    try {
      writeCodegraphMarker(guardOutcome.codegraphDir);
    } catch {
      // intentionally swallowed — surface as warning below
    }

    // Upstream `init` writes BOTH default templates: a 99-rule `exclude`
    // list (some rules collide with real source directories in this
    // project) and a 32-entry `include` list (which omits five extensions
    // upstream's own extractor supports). Left alone, a fresh clone / new
    // machine gets an index that silently omits tracked source files while
    // `status` says it is up to date. Reconcile now, append the missing
    // include patterns, drop the offending rules, and rebuild the index — a
    // fresh init is the one moment this is both safe (nothing has been
    // indexed yet) and necessary (`.codegraph/` is gitignored, so every
    // clone starts from the default templates).
    //
    // Never throws: a failure here is reported as a warning, not a
    // failed init (the init itself already succeeded).
    const configRepair = await repairCodegraphExcludeFromProject(projectRoot);

    // These are confirmations, not warnings: `printResult` renders every
    // `warnings` entry to stderr behind a `warning: ` prefix, so a fully
    // successful init used to print a wall of `warning:` lines for what
    // were plain success messages.
    const initNotes: string[] = [
      `Stamped peaks-loop marker at ${guardOutcome.codegraphDir}/.peaks-loop-marker`
    ];
    if (foreignRemoved !== null) {
      initNotes.push(
        `Removed the foreign ${foreignRemoved} (--force: deleted in place, no backup was kept), then initialized a fresh peaks-loop index.`
      );
    }
    if (configRepair.applied) {
      if (configRepair.includePatternsAdded.length > 0) {
        // A1 (2026-09-17): the include axis names its OWN file delta here too.
        // Naming the patterns alone left the same gap the repair note had —
        // a reader learned which extensions were appended but not how many
        // fresh `init` reports the include repair.
        initNotes.push(
          `Added ${configRepair.includePatternsAdded.length} include pattern(s) upstream's extractor supports but its default template omits, newly admitting ${configRepair.includeFilesRecovered} tracked source file(s) (${configRepair.includePatternsAdded.join(', ')}).${admittingClause(configRepair)}`
        );
      }
      if (configRepair.rulesRemoved.length > 0) {
        initNotes.push(
          `Removed ${configRepair.rulesRemoved.length} exclude rule(s) that blocked tracked source files, recovering ${configRepair.filesRecovered} file(s); config backed up to ${configRepair.backupPath ?? ''}.`
        );
      }
      if (configRepair.reindexed) {
        initNotes.push('Rebuilt the codegraph index over the recovered files.');
      }
    }

    printResult(
      io,
      ok(
        'codegraph.init',
        {
          guard: guardOutcome.status,
          codegraphDir: guardOutcome.codegraphDir,
          ...(foreignRemoved === null
            ? {}
            : { foreignCodegraphRemoved: foreignRemoved, foreignCodegraphBackedUp: false }),
          markerWritten: true,
          excludeRepair: {
            applied: configRepair.applied,
            rulesRemoved: configRepair.rulesRemoved,
            includePatternsAdded: configRepair.includePatternsAdded,
            filesRecovered: configRepair.filesRecovered,
            includeFilesRecovered: configRepair.includeFilesRecovered,
            includeAdmittedAfter: configRepair.includeAdmittedAfter,
            trackedSourceCount: configRepair.trackedSourceCount,
            reindexed: configRepair.reindexed,
            backupPath: configRepair.backupPath,
            warning: configRepair.warning
          }
        },
        // Verbatim: `printResult` supplies the `warning: ` prefix, so a
        // prefix added here would render as `warning: warning: ...`.
        configRepair.warning === null ? [] : [configRepair.warning],
        initNotes
      ),
      asJson
    );
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.init', error, asJson);
  }
}

export { runCodegraphInitCommand };
