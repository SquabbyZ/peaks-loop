// src/cli/commands/codegraph-config-restore-command.ts
//
// `peaks codegraph config-restore` — the explicit undo of a repair. Split out
// of `codegraph-commands.ts`; the verb name, options and envelopes are
// unchanged.

import type { Command } from 'commander';
import {
  assertCodegraphDirContained,
  resolveProjectRoot
} from '../../services/codegraph/codegraph-service.js';
import { resolveCodegraphConfigSource } from '../../services/codegraph/codegraph-project-config.js';
import {
  rollbackCodegraphConfig,
  type CodegraphConfigRollbackResult
} from '../../services/codegraph/codegraph-config-repair-writer.js';
import { fail, ok } from 'peaks-loop-shared/result';

import {
  getErrorMessage,
  printResult,
  redactSensitiveErrorMessage,
  type ProgramIO
} from '../cli-helpers.js';
import { addProjectOption } from './codegraph-command-options.js';
import type { CommonCodegraphOptions } from './codegraph-command-runtime.js';

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

/** Everything a `config-restore` failure envelope needs, in one value. */
type ConfigRestoreFailure = {
  readonly asJson: boolean | undefined;
  readonly reason: string;
  readonly exitCode: number;
  readonly nextActions: readonly string[];
};

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
function printConfigRestoreFailure(io: ProgramIO, failure: ConfigRestoreFailure): void {
  const redacted = redactSensitiveErrorMessage(failure.reason);
  printResult(
    io,
    fail(
      'codegraph.config-restore',
      'CODEGRAPH_CONFIG_RESTORE_FAILED',
      redacted,
      { restored: false, from: null, to: null, reason: redacted },
      [...failure.nextActions]
    ),
    failure.asJson
  );
  process.exitCode = failure.exitCode;
}

/** The precondition class: nothing below the resolve ran. */
function printRestorePreconditionFailure(
  io: ProgramIO,
  asJson: boolean | undefined,
  error: unknown
): void {
  printConfigRestoreFailure(io, {
    asJson,
    reason: getErrorMessage(error),
    exitCode: CODEGRAPH_CONFIG_RESTORE_PRECONDITION_EXIT_CODE,
    nextActions: [
      'Check that `--project` names an existing directory whose `.codegraph/` resolves inside it.',
      'Run `peaks codegraph config-restore --project <root>` again once the path is right.'
    ]
  });
}

/** The restore class: the reverse write itself threw. */
function printRestoreWriteFailure(
  io: ProgramIO,
  asJson: boolean | undefined,
  error: unknown
): void {
  printConfigRestoreFailure(io, {
    asJson,
    reason: getErrorMessage(error),
    exitCode: CODEGRAPH_CONFIG_RESTORE_EXIT_CODE,
    nextActions: [
      'Check that the `.codegraph/` directory is writable, then re-run.',
      'The config was NOT restored; its bytes are unchanged.'
    ]
  });
}

/** The refusal arm of the rollback result — the only arm that carries `error`. */
type RefusedRollback = Extract<CodegraphConfigRollbackResult, { rolledBack: false }>;

/** The restore class: the rollback point was examined and refused. */
function printRestoreRefusedFailure(
  io: ProgramIO,
  asJson: boolean | undefined,
  result: RefusedRollback
): void {
  printConfigRestoreFailure(io, {
    asJson,
    reason: result.error,
    exitCode: CODEGRAPH_CONFIG_RESTORE_EXIT_CODE,
    nextActions: [
      `There is no usable rollback point at ${result.backupPath}.`,
      'A restore needs the `.bak` that a previous `peaks codegraph repair-exclude` or `repair-index` left next to the config.'
    ]
  });
}

function printRestoreSuccess(
  io: ProgramIO,
  result: CodegraphConfigRollbackResult,
  asJson: boolean | undefined
): void {
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
    // The same resolver the repair WRITES through, so a restore puts back the
    // file the repair replaced — not a same-named file upstream never reads.
    configPath = resolveCodegraphConfigSource(projectRoot).configPath;
  } catch (error) {
    printRestorePreconditionFailure(io, asJson, error);
    return;
  }

  let result: CodegraphConfigRollbackResult;
  try {
    result = await rollbackCodegraphConfig(configPath);
  } catch (error) {
    // Only the reverse write's own fs failure reaches here (the refusals are
    // returned, not thrown). The RESTORE class, and the same code as a refusal:
    // the restore was attempted and did not happen, and a script that can read
    // one can read the other. What differs is the `reason`, which is this
    // error's own message.
    printRestoreWriteFailure(io, asJson, error);
    return;
  }

  if (!result.rolledBack) {
    // LOUD, never silent: the reason reaches the envelope's `message` (which
    // `fail()` redacts) AND `data.reason`, and the exit code is this verb's
    // own. A restore that quietly reported success over a `.bak` it refused to
    // read is exactly the fail-silent family this release closed.
    printRestoreRefusedFailure(io, asJson, result);
    return;
  }

  printRestoreSuccess(io, result, asJson);
}

export function registerCodegraphConfigRestoreCommand(codegraph: Command, io: ProgramIO): void {
  addProjectOption(
    codegraph
      .command('config-restore')
      .description(
        'Restore .codegraph/config.json from the byte-exact .bak a repair left — the explicit undo of a repair'
      )
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphConfigRestoreCommand(io, options, options.peaksJson)
  );
}
