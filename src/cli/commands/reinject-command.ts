/**
 * rid `2026-09-13-a2-post-compact-reinject` —
 * `peaks session reinject --project <path>`.
 *
 * The transport for `buildPostCompactReinjectionCard`. A Claude Code
 * `SessionStart` hook (installed by `peaks hooks install`, matcher `compact`)
 * runs this and Claude Code adds its stdout to the context — which is the
 * whole mechanism by which the engineering state comes back after a
 * compaction. See `src/services/context/post-compact-reinjection.ts` for what
 * the card says and why it has a byte budget.
 *
 * THE ONE THING THIS FILE HAS TO GET RIGHT
 *
 * stdout IS context here. Every other peaks command treats stdout as a
 * channel for a human or a JSON consumer; this one's stdout is pasted in
 * front of the model as though it were something peaks-loop meant to say.
 * Two consequences, and both are the reason the code below looks the way it
 * does:
 *
 *   1. The card is printed VERBATIM — no `printResult`, no envelope, no
 *      `next:` lines, no JSON on the card path. Anything else would be
 *      injected too, and a `{"ok":true,...}` blob in the context is noise the
 *      model then has to interpret.
 *   2. A FAILURE PRINTS NOTHING. Not an error, not a warning, not a hint. An
 *      error message on stdout would be injected into the context as a fact,
 *      and a model that reads `REINJECT_FAILED: project root must be
 *      canonical` in its own context has been handed a false problem to solve
 *      mid-slice. So every failure path exits 0 with empty stdout, and the
 *      reason is reported only through `--json` (which the hook never passes).
 *      This is `failure-soft` for a SessionStart hook: the session must start
 *      whether or not there is any state to re-inject.
 *
 * `--json` exists for the human/diagnostic path — `peaks session reinject
 * --json` is how you inspect what the hook would inject without reading a
 * transcript. It is deliberately NOT what the hook runs.
 */

import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';
import { printResult } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  resolveCanonicalProjectRootStrict,
  InvalidProjectRootError
} from '../../services/config/config-safety.js';
import {
  POST_COMPACT_REINJECTION_BYTE_BUDGET,
  buildPostCompactReinjectionCard
} from '../../services/context/post-compact-reinjection.js';

export type ReinjectOptions = {
  project: string;
  json?: boolean;
  budgetBytes?: string;
};

/** Why no card was produced. Reported through `--json` only. */
export type ReinjectSkipReason =
  'empty-project' | 'invalid-project-root' | 'unreadable-project-root';

export type ReinjectResult =
  | { readonly ok: true; readonly card: ReturnType<typeof buildPostCompactReinjectionCard> }
  | { readonly ok: false; readonly reason: ReinjectSkipReason; readonly message: string };

/**
 * Parse `--budget-bytes`. Diagnostic only — the production ceiling is the
 * constant. A value that is not a non-negative integer is REFUSED rather than
 * coerced, because a coerced budget would silently change what the card
 * proves (`--budget-bytes 4KiB` becoming `NaN` and then the default would
 * report a full card while the caller believed they had constrained it).
 */
function parseBudget(
  raw: string | undefined
): { readonly ok: true; readonly value: number | null } | { readonly ok: false } {
  if (raw === undefined) return { ok: true, value: null };
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return { ok: false };
  return { ok: true, value: parsed };
}

/**
 * Pure-ish action body, exported so tests can drive it with inputs Commander
 * would mangle (trailing NUL bytes, whitespace-only paths). Never throws and
 * never writes to stdout itself — `runReinjectAction` is the IO edge.
 */
export function buildReinjectResult(opts: ReinjectOptions): ReinjectResult {
  if (!opts.project || opts.project.trim() === '') {
    return {
      ok: false,
      reason: 'empty-project',
      message: '--project <path> is required and must be non-empty'
    };
  }
  let projectRoot: string;
  try {
    projectRoot = resolveCanonicalProjectRootStrict(opts.project);
  } catch (error) {
    if (error instanceof InvalidProjectRootError) {
      return {
        ok: false,
        reason: 'invalid-project-root',
        message: `--project is not a usable project root (${error.reason})`
      };
    }
    return {
      ok: false,
      reason: 'unreadable-project-root',
      message: error instanceof Error ? error.message : String(error)
    };
  }

  const budget = parseBudget(opts.budgetBytes);
  if (!budget.ok) {
    return {
      ok: false,
      reason: 'invalid-project-root',
      message: `--budget-bytes must be a non-negative integer, got ${String(opts.budgetBytes)}`
    };
  }

  const card = buildPostCompactReinjectionCard({
    projectRoot,
    ...(budget.value !== null ? { budgetBytes: budget.value } : {})
  });
  return { ok: true, card };
}

/**
 * The IO edge. Returns the process exit code so callers (CLI path or test
 * path) apply it uniformly. NEVER calls `process.exit`.
 *
 * Both branches return 0 on the failure path — see this file's header. The
 * only way a caller sees `exitCode: 1` is a bug in the `--json` serializer
 * itself, and even that is caught.
 */
export function runReinjectAction(opts: ReinjectOptions, io: ProgramIO): { exitCode: 0 | 1 } {
  let result: ReinjectResult;
  try {
    result = buildReinjectResult(opts);
  } catch (error) {
    result = {
      ok: false,
      reason: 'unreadable-project-root',
      message: error instanceof Error ? error.message : String(error)
    };
  }

  if (opts.json === true) {
    if (!result.ok) {
      printResult(
        io,
        fail(
          'session.reinject',
          `REINJECT_SKIPPED_${result.reason.replace(/-/g, '_').toUpperCase()}`,
          result.message,
          {
            project: opts.project
          },
          []
        ),
        true
      );
      // A skipped card is a legitimate answer, not a failed command: the hook
      // that runs this must never report a non-zero exit to the harness.
      return { exitCode: 0 };
    }
    const card = result.card;
    printResult(
      io,
      ok('session.reinject', {
        sessionId: card.sessionId,
        budgetBytes: card.budgetBytes,
        bytes: card.bytes,
        emittedRanks: card.emittedRanks,
        droppedRanks: card.droppedRanks,
        unresolved: card.unresolved,
        // The payload itself, so a caller can read it without re-running.
        card: card.text
      }),
      true
    );
    return { exitCode: 0 };
  }

  // The card path — the one the hook uses. Verbatim, and nothing on failure.
  if (!result.ok) return { exitCode: 0 };
  if (result.card.text.length > 0) io.stdout(result.card.text);
  return { exitCode: 0 };
}

export function registerReinjectCommand(program: Command, io: ProgramIO): void {
  // Reuse the `session` commander group registered by the auto-registration
  // pass, exactly as `registerPrimerCommand` does — `program.command('session
  // reinject')` would register a single literal command name instead of a
  // child of the group, and creating a second `session` group throws.
  const session = program.commands.find((c) => c.name() === 'session');
  if (!session) {
    throw new Error(
      'registerReinjectCommand: session group not registered; ' +
        'autoRegisterAllCommands must run before registerReinjectCommand'
    );
  }
  session
    .command('reinject')
    .description(
      'Print the post-compact engineering-state card to stdout. ' +
        'Run by the SessionStart hook (matcher: compact) so Claude Code re-injects it ' +
        'as context after a compaction. Read-only; prints nothing (exit 0) when there is ' +
        'no state to re-inject.'
    )
    .requiredOption('--project <path>', 'Project root (must be a non-empty canonical path)')
    .option(
      '--budget-bytes <n>',
      `Diagnostic override for the card's byte ceiling (default ${POST_COMPACT_REINJECTION_BYTE_BUDGET})`
    )
    .option('--json', 'emit a JSON envelope { ok, data } to stdout instead of the card')
    .action((opts: ReinjectOptions) => {
      const { exitCode } = runReinjectAction(opts, io);
      if (exitCode !== 0) process.exitCode = exitCode;
    });
}
