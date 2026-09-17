// src/cli/commands/codegraph-commands.ts
//
// The codegraph verbs that MUTATE or PROXY: `repair-exclude`, `repair-index`,
// `config-restore`, `init`, `affected`, plus the commander registration for
// every codegraph subcommand.
//
// D1 (rid 2026-09-17-oversize-and-scale, the 800-line file-size cap) moved
// the shared invocation runtime to `codegraph-command-runtime.ts` and the
// `status` integrity gate to `codegraph-status-command.ts`, both verbatim.
// This path keeps its public surface: `registerCodegraphCommands` is defined
// here and `rewriteBareCodegraphHints` / `attributeUpstreamUpToDateLine` are
// re-exported below, so every existing importer still resolves.

import { Command, InvalidArgumentError } from 'commander';
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertCodegraphDirContained,
  createCodegraphInvocation,
  executeCodegraphInvocation,
  defaultCodegraphInitGuard,
  resolveProjectRoot,
  writeCodegraphMarker,
  writeCodegraphAffectedContext,
  CodegraphInitConflictError,
  CODEGRAPH_DIR_NAME
} from '../../services/codegraph/codegraph-service.js';
import {
  repairCodegraphExcludeFromProject,
  type CodegraphExcludeRepairReport
} from '../../services/codegraph/codegraph-exclude-repair.js';
import { CODEGRAPH_CONFIG_FILENAME } from '../../services/codegraph/codegraph-exclude-reconciler.js';
import { rollbackCodegraphConfig } from '../../services/codegraph/codegraph-config-repair-writer.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { getErrorMessage, printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';
import {
  printCodegraphFailure,
  runCodegraphCommand,
  type CommonCodegraphOptions
} from './codegraph-command-runtime.js';
import { runCodegraphStatusCommand } from './codegraph-status-command.js';

// Re-exported so the D1 split is invisible to importers of THIS path.
export { rewriteBareCodegraphHints } from './codegraph-command-runtime.js';
export { attributeUpstreamUpToDateLine } from './codegraph-status-command.js';

interface CodegraphIndexOptions extends CommonCodegraphOptions {
  force?: boolean;
  quiet?: boolean;
}

interface CodegraphQueryOptions extends CommonCodegraphOptions {
  json?: boolean;
  limit?: number;
}

interface CodegraphFilesOptions extends CommonCodegraphOptions {
  json?: boolean;
  maxDepth?: number;
}

interface CodegraphAffectedOptions extends CommonCodegraphOptions {
  json?: boolean;
  rid?: string;
  writeEnvelope?: boolean;
}

function addPeaksJsonOption(command: Command): Command {
  return command.option('--peaks-json', 'print Peaks error envelope as machine-readable JSON');
}

function addProjectOption(command: Command): Command {
  return addPeaksJsonOption(command.requiredOption('--project <path>', 'target project root'));
}

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  return parsed;
}

// " Include now admits 7 of 9 extractor-supported tracked file(s)." — printed
// only when the ratio reports a SHORTFALL, i.e. when the repair has left
// files the extractor supports unadmitted. That is the one reading of this
// sentence an operator can act on.
//
// What this used to say, and why it was wrong: the denominator was fed from
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
function admittingClause(report: CodegraphExcludeRepairReport): string {
  if (report.trackedSourceCount === 0 || report.includeAdmittedAfter >= report.trackedSourceCount) {
    return '';
  }

  return ` Include now admits ${report.includeAdmittedAfter} of ${report.trackedSourceCount} extractor-supported tracked file(s).`;
}

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
// Both run the SAME two-axis repair (normalize `include`, then reconcile
// `exclude` against the widened list), because repairing `exclude` without
// normalizing `include` first reports success over a config it has just made
// worse — see `codegraph-exclude-repair.ts`.
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
// same two-axis repair — only the rebuild differs.
//
// A1 (`2026-09-17-codegraph-msg-and-refresh`): EACH COUNT NAMES ITS OWN AXIS.
// The previous wording ended one sentence about both axes with a single
// "recovering N tracked source file(s)", fed by `filesRecovered` — the
// EXCLUDE axis' counter. On this repo it printed "Added 5 include pattern(s)
// and removed 0 exclude rule(s), recovering 0 tracked source file(s)." while
// those 5 patterns had just admitted 31 tracked source files (30 `.mjs` + 1
// `.cjs`): a true statement about the axis that did not move, read as a
// verdict on the one that did. The `admittingClause` could not correct it
// either — it is silent when the coverage ratio is complete, which is
// exactly the state a fresh include repair produces.
//
// So: the include clause carries the include axis' own file delta and the
// exclude clause carries the exclude axis' own count, and a reader cannot
// attribute either number to the other clause. No combined total is printed,
// because there is no honest single number here — the two axes recover
// disjoint sets (one widens admission, the other unblocks admitted files)
// and only the first of them is cheap enough to measure on every repair.
function appliedRepairNote(report: CodegraphExcludeRepairReport): string {
  return (
    `Added ${report.includePatternsAdded.length} include pattern(s), newly admitting ${report.includeFilesRecovered} tracked source file(s), and removed ${report.rulesRemoved.length} exclude rule(s), recovering ${report.filesRecovered} tracked source file(s) that a rule had been hiding.` +
    admittingClause(report) +
    ` Config backed up to ${report.backupPath ?? ''}.`
  );
}

/**
 * Explicit repair path: reconcile both config axes → back up the config →
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
  const confirmations: string[] = [
    report.applied ? appliedRepairNote(report) : spec.noopNote
  ];
  if (report.applied || mode === 'index') {
    confirmations.push('Re-run `peaks codegraph status --project <root>` to confirm the gap is closed.');
  }

  printResult(
    io,
    ok(
      spec.commandId,
      {
        applied: report.applied,
        rulesRemoved: report.rulesRemoved,
        includePatternsAdded: report.includePatternsAdded,
        filesRecovered: report.filesRecovered,
        includeFilesRecovered: report.includeFilesRecovered,
        includeAdmittedAfter: report.includeAdmittedAfter,
        trackedSourceCount: report.trackedSourceCount,
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

/**
 * Exit code for a `config-restore` run that never reached the restore point:
 * `--project` is missing or not a directory, or the containment guard refused
 * the `.codegraph/` directory.
 *
 * Deliberately NOT `CODEGRAPH_CONFIG_RESTORE_EXIT_CODE` (77). The two codes
 * answer different questions, and a CI job has to be able to tell them apart:
 *
 *   - 1  — the command was never aimed at a usable project. Nothing looked at a
 *          rollback point, so "your backup is unusable" would be a verdict
 *          nothing reached, and the remedy is a different one (fix the path, or
 *          remove the link). The VALUE is 1 because that is what every other
 *          codegraph verb already exits with for this same input failure —
 *          `repair-exclude --project <bad>` and `status --project <bad>` both
 *          exit 1 (measured), so a caller that handles one handles this one.
 *   - 77 — the restore point WAS examined and the restore did not happen.
 *
 * Named rather than left as `printCodegraphFailure`'s default `1` so both
 * classes are visible in one place, side by side, instead of one of them living
 * only in another module's parameter default.
 */
const CODEGRAPH_CONFIG_RESTORE_PRECONDITION_EXIT_CODE = 1;

/**
 * Exit code for `peaks codegraph config-restore` when the restore did not
 * happen: the backup is absent, unreadable, or REFUSED (a symbolic link, a
 * hard link or a directory occupies the fixed, guessable `.bak` path), or the
 * reverse write itself failed.
 *
 * Its own code rather than the precondition `1`, for the same reason 73/74/75/76
 * have theirs: it is an operator-actionable verdict about the RESTORE POINT, and
 * a CI job has to be able to tell it apart from "the command was aimed wrong".
 * The cause lives in `data.reason`, which names the path and the shape that was
 * refused — a per-cause CODE would need the rollback helper to return a
 * discriminated reason rather than a message, which is a change to that helper's
 * contract for no operator-visible gain while the message already carries the
 * details.
 */
const CODEGRAPH_CONFIG_RESTORE_EXIT_CODE = 77;

/**
 * The failure envelope for EVERY `config-restore` failure, so all four `data`
 * keys are present whatever went wrong.
 *
 * A JSON consumer reads `data.restored` and `data.reason` unconditionally, so a
 * failure envelope that omits them leaves it guessing — and this verb reports a
 * `reason` instead of an exit code alone precisely so a failure is never silent.
 * Built here rather than delegated to `printCodegraphFailure`, whose `data` is
 * always `{}` and therefore cannot satisfy that.
 *
 * `code` names the VERB's failure for all three cases; the exit code names the
 * CLASS (precondition vs restore) and `reason` names the cause. That split is
 * deliberate: one `code` a consumer can match on, plus the two facts it needs
 * to decide what to do next.
 *
 * The verb-specific `code` is an INTENTIONAL DIVERGENCE from every other
 * codegraph verb, not a consistency with them — `repair-exclude`,
 * `repair-index` and `status` all report `CODEGRAPH_COMMAND_FAILED` out of
 * `printCodegraphFailure` with `data: {}` (measured, 2026-09-17). Two reasons
 * to diverge here anyway:
 *
 *   1. A generic `code` cannot be paired with a verb-specific `reason`
 *      contract: this verb's failure ALWAYS carries `restored`/`reason`, which
 *      `printCodegraphFailure` cannot express at all (`fail()` hard-codes the
 *      other verbs' `data` to `{}`).
 *   2. `CODEGRAPH_CONFIG_RESTORE_FAILED` says WHICH restore failed, and a
 *      consumer matching on `code` gets that from the envelope rather than from
 *      the exit code alone.
 *
 * FOLLOW-UP (recorded, not done here — it is out of this slice's scope):
 * `code` naming across the codegraph verb family is now inconsistent, and the
 * rest of the family should either adopt verb-specific codes or this one should
 * return to the generic one. See this slice's RD artifact,
 * `## A1 QA 修复循环 2`.
 */
function printConfigRestoreFailure(
  io: ProgramIO,
  asJson: boolean | undefined,
  reason: string,
  exitCode: number,
  nextActions: readonly string[]
): void {
  const redacted = redactSensitiveErrorMessage(reason);
  printResult(
    io,
    fail(
      'codegraph.config-restore',
      'CODEGRAPH_CONFIG_RESTORE_FAILED',
      redacted,
      { restored: false, from: null, to: null, reason: redacted },
      [...nextActions]
    ),
    asJson
  );
  process.exitCode = exitCode;
}

/**
 * `peaks codegraph config-restore` — put `.codegraph/config.json` back to the
 * bytes the last repair backed up to `.codegraph/config.json.bak`.
 *
 * The EXPLICIT undo of a repair, and the only way the `.bak` is ever read: the
 * repair seams leave the copy behind and never consume it, because a repair
 * that restored its own write would cancel itself out (the config would be
 * exactly as it was found, `status` would still report the gap, and exit 75
 * would never clear).
 *
 * Touches the CONFIG FILE ONLY — no `codegraph` subprocess is spawned, so this
 * is safe to run while nothing else is rebuilding. The index still reflects
 * whatever config the last rebuild used; the envelope's `nextActions` says so
 * rather than silently reindexing.
 */
async function runCodegraphConfigRestoreCommand(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  asJson: boolean | undefined
): Promise<void> {
  let configPath: string;
  try {
    // `resolveProjectRoot` for the same reason the repair verbs use it: the
    // paths reported here must be the canonical ones, or a `--project` alias
    // reports a restore that happened somewhere the operator cannot find.
    const projectRoot = resolveProjectRoot(options.project);
    // The containment refusal the repair seam makes before IT writes here. A
    // `.codegraph/` that resolves outside the canonical project root (a junction
    // or a symlink) would otherwise let this verb publish one project's bytes
    // into another. Called for its refusal only — the paths below stay derived
    // from the caller's canonical `projectRoot`.
    assertCodegraphDirContained(projectRoot);
    configPath = join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME);
  } catch (error) {
    // The PRECONDITION class: nothing below this line ran, so the envelope says
    // the restore did not happen and stops short of blaming the rollback point.
    printConfigRestoreFailure(
      io,
      asJson,
      getErrorMessage(error),
      CODEGRAPH_CONFIG_RESTORE_PRECONDITION_EXIT_CODE,
      [
        'Check that `--project` names an existing directory whose `.codegraph/` resolves inside it.',
        'Run `peaks codegraph config-restore --project <root>` again once the path is right.'
      ]
    );
    return;
  }

  let result;
  try {
    result = await rollbackCodegraphConfig(configPath);
  } catch (error) {
    // Only the reverse write's own fs failure reaches here (the refusals are
    // returned, not thrown). The RESTORE class, and the same code as a refusal:
    // the restore was attempted and did not happen, and a script that can read
    // one can read the other. What differs is the `reason`, which is this
    // error's own message.
    printConfigRestoreFailure(
      io,
      asJson,
      getErrorMessage(error),
      CODEGRAPH_CONFIG_RESTORE_EXIT_CODE,
      [
        'Check that the `.codegraph/` directory is writable, then re-run.',
        'The config was NOT restored; its bytes are unchanged.'
      ]
    );
    return;
  }

  if (!result.rolledBack) {
    // LOUD, never silent: the reason reaches the envelope's `message` (which
    // `fail()` redacts) AND `data.reason`, and the exit code is this verb's
    // own. A restore that quietly reported success over a `.bak` it refused to
    // read is exactly the fail-silent family this release closed.
    printConfigRestoreFailure(
      io,
      asJson,
      result.error,
      CODEGRAPH_CONFIG_RESTORE_EXIT_CODE,
      [
        `There is no usable rollback point at ${result.backupPath}.`,
        'A restore needs the `.bak` that a previous `peaks codegraph repair-exclude` or `repair-index` left next to the config.'
      ]
    );
    return;
  }

  printResult(
    io,
    ok(
      'codegraph.config-restore',
      {
        restored: true,
        from: result.backupPath,
        to: result.configPath,
        reason: null
      },
      [],
      [
        'Run `peaks codegraph status --project <root>` to see the restored config reflected in the integrity gate.',
        'Run `peaks codegraph index` if the index should reflect the restored config too — this verb does not rebuild it.'
      ]
    ),
    asJson
  );
}

/**
 * rid-CG-006 — init conflict guard. Resolves the project root and
 * probes `.codegraph/` for the peaks-loop marker before invoking the
 * upstream binary.
 *
 *   - fresh                          → proceed to upstream init
 *   - noop-already-peaks-loop        → skip upstream, emit warning
 *   - conflict-foreign-schema        → exit 73 + CODEGRAPH_INIT_CONFLICT envelope
 *
 * On a successful upstream init, write the marker so the next run
 * hits the noop branch instead of the conflict branch.
 */
async function runCodegraphInitCommand(io: ProgramIO, options: CommonCodegraphOptions, asJson?: boolean): Promise<void> {
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

  const guardOutcome = defaultCodegraphInitGuard(projectRoot);

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
      fail('codegraph.init', conflict.code, conflict.message, { codegraphDir: conflict.codegraphDir }, [
        'Move or rename the foreign .codegraph/ directory before retrying.',
        'Or remove .codegraph/ if you are sure no other tool owns it.',
        'Or run `peaks codegraph init --project <path> --force` once the foreign-tool safety flag ships (tracked in rid-CG-006).'
      ]),
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

    if (result.stdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(result.stdout) : result.stdout).trimEnd());
    }
    if (result.stderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(result.stderr) : result.stderr).trimEnd());
    }

    if (didFail) {
      if (asJson === true) {
        printCodegraphFailure(
          io,
          'codegraph.init',
          new Error(result.stderr || result.stdout || `codegraph exited with code ${result.exitCode}`),
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
    if (configRepair.applied) {
      if (configRepair.includePatternsAdded.length > 0) {
        // A1 (2026-09-17): the include axis names its OWN file delta here too.
        // Naming the patterns alone left the same gap the repair note had —
        // a reader learned which extensions were appended but not how many
        // tracked files that admitted, and this note is the ONLY place a
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

/**
 * rid-CG-002 — codegraph-affected envelope write.
 *
 * Wraps the generic `runCodegraphCommand` and, after a successful
 * upstream invocation, calls `writeCodegraphAffectedContext` so the
 * RD / QA handoff can pick up `.peaks/_runtime/<sid>/rd/codegraph-context.md`
 * without re-running the (5-30 s) codegraph query.
 *
 * The envelope write is gated by `--write-envelope` (default off) so
 * ad-hoc CLI invocations don't silently mutate the user's session
 * directory. peaks-code's RD dispatch hook flips the flag on.
 *
 * On no-session-binding, we surface a `warning` field instead of
 * throwing — the upstream result is still printed so the caller
 * always sees the affected list.
 */
async function runCodegraphAffectedCommand(
  io: ProgramIO,
  files: string[],
  options: CodegraphAffectedOptions,
  asJson?: boolean
): Promise<void> {
  // Capture stdout so we can re-emit it into the envelope payload.
  // We still forward every line to the original `io.stdout` so the
  // user sees the affected list as if the wrapper were transparent.
  const capturedLines: string[] = [];
  const captureIo: ProgramIO = {
    stdout: (chunk: string) => {
      capturedLines.push(chunk);
      io.stdout(chunk);
    },
    stderr: (chunk: string) => io.stderr(chunk)
  };

  await runCodegraphCommand(
    captureIo,
    'codegraph.affected',
    {
      subcommand: 'affected',
      project: options.project,
      files,
      ...(options.json === true ? { json: true } : {})
    },
    asJson
  );

  if (!options.writeEnvelope) {
    return;
  }

  // The user opted in via --write-envelope. Run the envelope writer
  // unconditionally (graceful fallback when no session binding).
  const rid = options.rid ?? process.env.PEAKS_RD_RID ?? 'unknown-rid';
  const rawStdout = capturedLines.join('\n');
  let affectedPayload: unknown = rawStdout;
  if (options.json === true && typeof affectedPayload === 'string' && affectedPayload.length > 0) {
    try {
      affectedPayload = JSON.parse(affectedPayload);
    } catch {
      // Keep the raw string when JSON parse fails; the envelope
      // renderer handles strings cleanly.
    }
  }

  const envelope = writeCodegraphAffectedContext({
    projectRoot: resolve(options.project),
    rid,
    files,
    affectedPayload
  });

  if (envelope.written) {
    if (asJson !== true) {
      io.stdout(`[codegraph-context] wrote ${envelope.path}\n`);
    }
  } else if (asJson !== true) {
    io.stdout(`[codegraph-context] skipped: ${envelope.warning}\n`);
  }
}

export function registerCodegraphCommands(program: Command, io: ProgramIO): void {
  const codegraph = program.command('codegraph').description('Run upstream codegraph commands through the Peaks launcher');

  addProjectOption(
    codegraph.command('status').description('Show codegraph status, including the exclude integrity gate')
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphStatusCommand(io, options, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('repair-exclude')
      .description(
        'Normalize the codegraph include list, drop exclude rules that block tracked source files, then rebuild the index'
      )
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphRepairCommand(io, options, options.peaksJson, 'exclude')
  );

  addProjectOption(
    codegraph
      .command('repair-index')
      .description(
        'Repair both codegraph config axes, then rebuild the index from scratch (drops rows for deleted files)'
      )
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphRepairCommand(io, options, options.peaksJson, 'index')
  );

  addProjectOption(
    codegraph
      .command('config-restore')
      .description(
        'Restore .codegraph/config.json from the byte-exact .bak a repair left — the explicit undo of a repair'
      )
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphConfigRestoreCommand(io, options, options.peaksJson)
  );

  addProjectOption(codegraph.command('init').description('Initialize codegraph for a project')).action(
    (options: CommonCodegraphOptions) => runCodegraphInitCommand(io, options, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('index')
      .description('Index a project with codegraph')
      .option('--force', 'force reindexing')
      .option('--quiet', 'reduce upstream output')
  ).action(async (options: CodegraphIndexOptions) => {
    // `runCodegraphCommand` returns "upstream failed" for the one caller
    // that ranks exit-code precedence (`status`); every other command just
    // awaits it, so it is discarded here rather than leaked to commander.
    await runCodegraphCommand(
      io,
      'codegraph.index',
      {
        subcommand: 'index',
        project: options.project,
        ...(options.force === true ? { force: true } : {}),
        ...(options.quiet === true ? { quiet: true } : {})
      },
      options.peaksJson
    );
  });

  addProjectOption(
    codegraph
      .command('query')
      .description('Query codegraph')
      .argument('<search>', 'search text')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--limit <n>', 'maximum result count', parsePositiveInteger)
  ).action(async (search: string, options: CodegraphQueryOptions) => {
    await runCodegraphCommand(
      io,
      'codegraph.query',
      {
        subcommand: 'query',
        project: options.project,
        search,
        ...(options.json === true ? { json: true } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {})
      },
      options.peaksJson
    );
  });

  addProjectOption(
    codegraph
      .command('files')
      .description('List codegraph files')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--max-depth <n>', 'maximum traversal depth', parsePositiveInteger)
  ).action(async (options: CodegraphFilesOptions) => {
    await runCodegraphCommand(
      io,
      'codegraph.files',
      {
        subcommand: 'files',
        project: options.project,
        ...(options.json === true ? { json: true } : {}),
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {})
      },
      options.peaksJson
    );
  });

  addProjectOption(codegraph.command('context').description('Build task context with codegraph').argument('<task>', 'task text')).action(
    async (task: string, options: CommonCodegraphOptions) => {
      await runCodegraphCommand(io, 'codegraph.context', { subcommand: 'context', project: options.project, task }, options.peaksJson);
    }
  );

  addProjectOption(
    codegraph
      .command('affected')
      .description('Find code affected by files')
      .argument('<files...>', 'project-relative file paths')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--rid <rid>', 'request id for the codegraph-context envelope (default: env PEAKS_RD_RID or "unknown-rid")')
      .option('--write-envelope', 'write codegraph-context.md into the active session')
  ).action((files: string[], options: CodegraphAffectedOptions) =>
    runCodegraphAffectedCommand(
      io,
      files,
      options,
      options.peaksJson
    )
  );
}
