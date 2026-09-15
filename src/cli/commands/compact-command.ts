/**
 * `peaks compact *` — strategic-compact CLI primitives.
 *
 * Slice 2026-07-01-strategic-compact-cli. Five subcommands under a new
 * top-level `peaks compact` group:
 *
 *   - suggest:    PreToolUse-style two-signal suggestion (context size
 *                 + tool-call count), read-only by default.
 *   - recommend:  Pure (from, to) phase-pair → severity lookup.
 *   - survival:   Static SKILL.md "What Survives Compaction" table.
 *   - dry-run:    Composite of (suggest + recommend + survival), no
 *                 writes.
 *   - force:      Write a pre-compact checkpoint via
 *                 `peaks session checkpoint`; the IDE-side `/compact`
 *                 is still the LLM's call.
 *
 * Each subcommand returns a `--json` envelope via `printResult`.
 */
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { writeCheckpoint } from '../../services/session/session-checkpoint-service.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
import {
  computeWindowCalibration,
  readCompactHistory,
  summarizeCompactHistory,
} from '../../services/compact-history/compact-history-service.js';
import {
  readHarnessWindowState,
  resolveHarnessWindowLocation
} from '../../services/context/auto-compact-reader.js';
import {
  disableHarnessWindowSync,
  reenableHarnessWindowSync,
  resetHarnessWindow
} from '../../services/context/harness-window-config.js';
import {
  buildRecommendEnvelopePure,
  dryRunCompact,
  suggestCompact
} from '../../services/compact/suggest-service.js';
import {
  PHASES,
  SURVIVAL_TABLE,
  isPhase,
  lookupPhaseTransition,
  type Phase
} from '../../services/compact/decision-tables.js';
import {
  readSessionIdFromHookPayload,
  readTriggerFromHookPayload,
  settleCompactFromHarnessEvent,
  type CompactSettleResult
} from '../../services/code/compact-event-settle.js';

type CompactSuggestOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
  apply?: boolean;
};

type CompactRecommendOptions = {
  from: string;
  to: string;
  json?: boolean;
};

type CompactSurvivalOptions = {
  json?: boolean;
};

type CompactDryRunOptions = {
  from?: string;
  to?: string;
  json?: boolean;
  project?: string;
  sessionId?: string;
};

type CompactForceOptions = {
  reason?: string;
  json?: boolean;
  project?: string;
  sessionId?: string;
  currentPlan?: string;
  openQuestions?: string;
  recentDecisions?: string;
  recentArtifactPaths?: string;
  gitStatus?: string;
  skillsActive?: string;
  todoState?: string;
};

type CompactSettleOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
};

/**
 * Read the `PostCompact` hook payload from stdin.
 *
 * `PEAKS_HOOK_STDIN` is the test seam, verbatim the one `peaks gate enforce`
 * uses (`gate-commands.ts`) — the CLI side owns `process.stdin`'s lifecycle, so
 * the reader lives with the command rather than in the service.
 *
 * Returns `null` for every shape that is not a JSON object: empty stdin, a TTY
 * (the `--json` diagnostic path run by a human), malformed JSON. A payload that
 * cannot be read is not a failure — it is a payload with no `trigger`, which is
 * an input this path is explicitly designed to accept.
 */
async function readHookPayload(): Promise<unknown> {
  const override = process.env.PEAKS_HOOK_STDIN;
  let raw: string;
  if (override !== undefined) {
    raw = override;
  } else if (process.stdin.isTTY) {
    raw = '';
  } else {
    raw = await new Promise<string>((resolveStdin) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolveStdin(data));
      process.stdin.on('error', () => resolveStdin(data));
    });
  }
  if (raw.trim().length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function resolveSessionId(
  projectRoot: string,
  explicit: string | undefined
): { sid: string | null; error: { code: string; message: string; nextActions: string[] } | null } {
  if (explicit !== undefined && explicit.length > 0) {
    return { sid: explicit, error: null };
  }
  // Statically-imported `getSessionIdCanonical` (see import block
  // at the top of this file). It is the single source of truth for
  // "what session is bound to this project"; we use it instead of
  // re-implementing the resolution here to keep one fix point when
  // the binding layout changes.
  const sid = getSessionIdCanonical(projectRoot) ?? null;
  if (sid === null) {
    return {
      sid: null,
      error: {
        code: 'NO_ACTIVE_SESSION',
        message: 'No active session bound. Run `peaks workspace init --project <repo> --json` to bind one.',
        nextActions: [`peaks workspace init --project ${projectRoot} --json`]
      }
    };
  }
  return { sid, error: null };
}

export function registerCompactCommands(program: Command, io: ProgramIO): void {
  const compact = program
    .command('compact')
    .description('Strategic-compact primitives: suggest / recommend / survival / dry-run / force');

  // -----------------------------------------------------------------
  // 1. peaks compact suggest [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('suggest')
      .description(
        'Two-signal suggestion (context-size + tool-call-count). ' +
          'Honor COMPACT_THRESHOLD / COMPACT_CONTEXT_THRESHOLD / COMPACT_CONTEXT_INTERVAL env vars. ' +
          'Read-only by default; pass --apply to also append a one-line info row to the session log.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id (defaults to the canonical binding)')
      .option('--apply', 'append a one-line info row to .peaks/_runtime/<sid>/session.json (default: dry-run)')
  ).action((options: CompactSuggestOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.suggest', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      const result = suggestCompact({
        projectRoot,
        sessionId: session.sid
      });
      printResult(io, ok('compact.suggest', result, [], [
        result.shouldSuggest
          ? `Run \`peaks compact force --reason "<short note>"\` to checkpoint, then /compact.`
          : `Context at ${(result.ratio * 100).toFixed(1)}% (${result.tokensUsed} of ${result.windowKind === '1m' ? '1M' : '200k'}); below threshold.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.suggest', 'COMPACT_SUGGEST_FAILED', getErrorMessage(error), {}, ['Verify project root and session binding before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 2. peaks compact recommend --from <phase> --to <phase> [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('recommend')
      .description(
        `Strategic-compact "Compaction Decision Guide" lookup. ` +
          `Valid phases: ${PHASES.join(', ')}. Pure function over (from, to); no I/O.`
      )
      .requiredOption('--from <phase>', `source phase (one of ${PHASES.join(', ')})`)
      .requiredOption('--to <phase>', `target phase (one of ${PHASES.join(', ')})`)
  ).action((options: CompactRecommendOptions) => {
    try {
      if (!isPhase(options.from)) {
        printResult(io, fail('compact.recommend', 'INVALID_PHASE', `--from must be one of ${PHASES.join(', ')} (got "${options.from}")`, { from: options.from }, [`Use --from ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      if (!isPhase(options.to)) {
        printResult(io, fail('compact.recommend', 'INVALID_PHASE', `--to must be one of ${PHASES.join(', ')} (got "${options.to}")`, { to: options.to }, [`Use --to ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      const envelope = buildRecommendEnvelopePure(options.from as Phase, options.to as Phase);
      const lookup = lookupPhaseTransition(options.from as Phase, options.to as Phase);
      printResult(io, ok('compact.recommend', {
        from: envelope.from,
        to: envelope.to,
        shouldCompact: envelope.shouldCompact,
        severity: envelope.severity,
        rationale: envelope.rationale,
        suggestedMessage: envelope.suggestedMessage,
        notInTable: lookup.notInTable
      }, lookup.notInTable ? [`Transition ${options.from} → ${options.to} is not in the strategic-compact table; defaulting to severity=no.`] : []), options.json);
    } catch (error) {
      printResult(io, fail('compact.recommend', 'COMPACT_RECOMMEND_FAILED', getErrorMessage(error), { from: options.from, to: options.to }, ['Verify the phase pair against the documented transitions']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 3. peaks compact survival [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('survival')
      .description('Strategic-compact "What Survives Compaction" table. Pure static data; no I/O.')
  ).action((options: CompactSurvivalOptions) => {
    printResult(io, ok('compact.survival', {
      persists: [...SURVIVAL_TABLE.persists],
      lost: [...SURVIVAL_TABLE.lost]
    }, [], [
      'Persists = guaranteed across `/compact`. Lost = not preserved; persist to disk before compacting.'
    ]), options.json);
  });

  // -----------------------------------------------------------------
  // 4. peaks compact dry-run [--from <phase>] [--to <phase>] [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('dry-run')
      .description(
        'Composite preview of (suggest + recommend + survival). ' +
          'No writes. The LLM calls this every tool-call cycle to stay informed.'
      )
      .option('--from <phase>', `optional source phase for recommend lookup (one of ${PHASES.join(', ')})`)
      .option('--to <phase>', `optional target phase for recommend lookup (one of ${PHASES.join(', ')})`)
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id')
  ).action((options: CompactDryRunOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.dry-run', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      if ((options.from === undefined) !== (options.to === undefined)) {
        printResult(io, fail('compact.dry-run', 'PHASE_PAIR_INCOMPLETE', 'Both --from and --to must be provided together', { from: options.from, to: options.to }, ['Pass both --from and --to, or omit both for a suggest-only dry-run']), options.json);
        process.exitCode = 1;
        return;
      }
      if (options.from !== undefined && !isPhase(options.from)) {
        printResult(io, fail('compact.dry-run', 'INVALID_PHASE', `--from must be one of ${PHASES.join(', ')} (got "${options.from}")`, { from: options.from }, [`Use --from ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      if (options.to !== undefined && !isPhase(options.to)) {
        printResult(io, fail('compact.dry-run', 'INVALID_PHASE', `--to must be one of ${PHASES.join(', ')} (got "${options.to}")`, { to: options.to }, [`Use --to ${PHASES.join('|')}`]), options.json);
        process.exitCode = 1;
        return;
      }
      const hasPhasePair = options.from !== undefined && options.to !== undefined;
      const dryRunInput: { projectRoot: string; sessionId: string | null; from?: Phase; to?: Phase } = {
        projectRoot,
        sessionId: session.sid
      };
      if (hasPhasePair) {
        dryRunInput.from = options.from as Phase;
        dryRunInput.to = options.to as Phase;
      }
      const result = dryRunCompact(dryRunInput);
      printResult(io, ok('compact.dry-run', result, [], [
        result.action === 'compact'
          ? `Action=compact: run \`peaks compact force --reason "<note>"\`, then /compact.`
          : `Action=skip: continue without compacting.`
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.dry-run', 'COMPACT_DRY_RUN_FAILED', getErrorMessage(error), {}, ['Verify project root, session binding, and phase pair before retrying']), options.json);
      process.exitCode = 1;
    }
  });

  // -----------------------------------------------------------------
  // 5. peaks compact force [--reason <text>] [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('force')
      .description(
        'Write a pre-compact checkpoint via `peaks session checkpoint --reason context-fill`. ' +
          'The IDE-side `/compact` is still the LLM\'s call; this primitive guarantees ' +
          'the pre-compact state is persisted. NO sleep, NO wait for IDE response.'
      )
      .option('--reason <text>', 'human-readable reason for the pre-compact checkpoint', 'pre-force-compact')
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id')
      .option('--current-plan <text>', 'current plan summary (forwarded to the checkpoint snapshot)')
      .option('--open-questions <list>', 'newline-separated open questions')
      .option('--recent-decisions <list>', 'newline-separated recent decisions')
      .option('--recent-artifact-paths <list>', 'newline-separated recent artifact paths')
      .option('--git-status <text>', 'recent git status')
      .option('--skills-active <list>', 'newline-separated active skill names')
      .option('--todo-state <list>', 'newline-separated todo lines')
  ).action((options: CompactForceOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(projectRoot, options.sessionId);
      if (session.error !== null) {
        printResult(io, fail('compact.force', session.error.code, session.error.message, { projectRoot }, session.error.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
          const reason = (options.reason ?? 'pre-force-compact').slice(0, 200);
      // The session-checkpoint-service restricts `reason` to a fixed
      // enum. The strategic-compact `force` primitive uses
      // 'context-fill' (the closest semantic match: the LLM is
      // compacting because of context pressure) and records the
      // caller's free-form reason in `gitStatus` so the snapshot
      // is self-describing without inventing a new enum value.
      const checkpointOptions: Parameters<typeof writeCheckpoint>[1] = {
        sessionId: session.sid as string,
        reason: 'context-fill',
        gitStatus: `compact.force: ${reason}`,
        openQuestions: splitList(options.openQuestions),
        recentDecisions: splitList(options.recentDecisions),
        recentArtifactPaths: splitList(options.recentArtifactPaths),
        skillsActive: splitList(options.skillsActive),
        todoState: splitList(options.todoState)
      };
      if (options.currentPlan !== undefined) {
        checkpointOptions.currentPlan = options.currentPlan;
      }
      const result = writeCheckpoint(projectRoot, checkpointOptions);
      printResult(io, ok('compact.force', {
        checkpointPath: result.path,
        reason: 'pre-force-compact',
        callerReason: reason,
        sessionId: result.sessionId,
        createdAt: result.createdAt,
        totalRetained: result.totalRetained,
        message: 'Pre-compact checkpoint written. The IDE-side /compact is still the LLM\'s call; this CLI does NOT invoke the IDE slash command.'
      }, [], [
        'After the LLM fires the IDE-side /compact, call `peaks compact survival` to see what to persist before the next compact.'
      ]), options.json);
    } catch (error) {
      printResult(io, fail('compact.force', 'COMPACT_FORCE_FAILED', getErrorMessage(error), {}, ['Verify the project path is writable and a session is bound']), options.json);
      process.exitCode = 1;
    }
  });

  // 6. peaks compact history [--json] (slice 2026-07-30-compact-visibility)
  addJsonOption(
    compact
      .command('history')
      .description(
        'Read the per-session compact-history.jsonl and emit a structured ' +
          'summary of every auto-compact dispatch in the current session.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id (defaults to the canonical binding)')
      .action((options: { project?: string; sessionId?: string; json?: boolean }) => {
        try {
          const project = options.project !== undefined
            ? resolveCanonicalProjectRoot(options.project)
            : (findProjectRoot(process.cwd()) ?? process.cwd());
          const session = resolveSessionId(project, options.sessionId);
          if (session.error !== null) {
            printResult(
              io,
              fail('compact.history', session.error.code, session.error.message, { projectRoot: project }, session.error.nextActions),
              options.json,
            );
            process.exitCode = 1;
            return;
          }
          const result = readCompactHistory({ projectRoot: project, sessionId: session.sid as string });
          if (result.kind === 'file-missing') {
            printResult(
              io,
              ok('compact.history', {
                sessionId: session.sid,
                totalCompacts: 0,
                message: 'No compact-history.jsonl yet; auto-compact has not fired in this session.',
                historyPath: result.path,
              }),
              options.json,
            );
            return;
          }
          if (result.kind === 'empty') {
            printResult(
              io,
              ok('compact.history', {
                sessionId: session.sid,
                totalCompacts: 0,
                message: 'compact-history.jsonl exists but is empty.',
                historyPath: result.path,
              }),
              options.json,
            );
            return;
          }
          const summary = summarizeCompactHistory(result.events);
          // Slice 2026-09-13-auto-compact-trigger-ownership (T4): the
          // intent-vs-observed record. `pairs[i].requestedTokens` is the token
          // point peaks-loop asked for; `observedTokens` is what the next real
          // session actually measured. Unmeasured pairs are reported as such —
          // this instrument states what happened, it does not predict.
          const windowCalibration = computeWindowCalibration(result.events);
          printResult(
            io,
            ok('compact.history', {
              sessionId: session.sid,
              ...summary,
              windowCalibration,
              events: result.events,
              parseErrors: result.parseErrors,
              historyPath: result.path,
            }),
            options.json,
          );
        } catch (error) {
          printResult(
            io,
            fail('compact.history', 'COMPACT_HISTORY_READ_FAILED', getErrorMessage(error), {}, ['Verify the project path is readable and a session is bound']),
            options.json,
          );
          process.exitCode = 1;
        }
      }),
  );

  // 7. peaks compact harness-window [--reset | --disable | --reenable]
  //    (slice 2026-09-13-auto-compact-trigger-ownership, T1 + T2)
  //
  // The window peaks-loop divides by and the window the harness compacts
  // against must be ONE number, or "95%" lands at two different token counts.
  // This command is the visible half of that write: the default reports what
  // is in force, `--reset` removes it, `--disable` stops managing it.
  //
  // There is deliberately NO `--sync` flag. Materializing the window requires
  // the ratio's own denominator, which only a probe has (it is the only place
  // the active model is known). A `--sync` that re-derived the window here
  // would be the second, independent resolution this slice exists to delete —
  // `peaks code context-now` and `peaks code auto-compact` already sync.
  addJsonOption(
    compact
      .command('harness-window')
      .description(
        'Report / roll back the auto-compact window peaks-loop writes into the ' +
          'harness\'s own machine-local settings (the adapter-declared ' +
          'autoCompactWindowEnvVar, e.g. CLAUDE_CODE_AUTO_COMPACT_WINDOW in ' +
          '.claude/settings.local.json). peaks-loop computes its context ratio ' +
          'against exactly this number, so the value it reports as "85%" and the ' +
          'point the harness compacts at are the same. Context probes ' +
          '(`peaks code context-now`, `peaks code auto-compact`) materialize it ' +
          'automatically. Two different intentions, two verbs: --reset removes ' +
          'the key AND opts the project out so later probes do not put it back ' +
          '(when the file holds no peaks-loop row at all there is nothing to ' +
          'roll back, so --reset writes nothing); --disable records the opt-out ' +
          'only, leaving whatever value is already there untouched, so "stop ' +
          'managing this key" works on a project peaks-loop has never written ' +
          'to; --reenable undoes either opt-out.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--reset', 'rollback: remove the window key and stop managing it')
      .option('--disable', 'record the opt-out only (do not manage this key), without removing a value that is already there; expressible before the first write')
      .option('--reenable', 'undo a --reset or --disable opt-out (peaks-loop manages it again)')
      .action((options: { project?: string; reset?: boolean; disable?: boolean; reenable?: boolean; json?: boolean }) => {
        try {
          const project = options.project !== undefined
            ? resolveCanonicalProjectRoot(options.project)
            : (findProjectRoot(process.cwd()) ?? process.cwd());

          const location = resolveHarnessWindowLocation({ projectRoot: project, env: process.env });
          if (location === null) {
            printResult(
              io,
              ok('compact.harness-window', {
                projectRoot: project,
                managed: false,
                message:
                  'The active IDE adapter declares no auto-compact window key, so peaks-loop cannot tie ' +
                  'the harness window to its own ratio. Nothing was written and there is nothing to roll back.',
              }),
              options.json,
            );
            return;
          }

          if (options.reset === true) {
            const result = resetHarnessWindow({ location, env: process.env });
            printResult(
              io,
              ok(
                'compact.harness-window',
                {
                  projectRoot: project,
                  action: result.action,
                  key: location.envVar,
                  settingsPath: result.settingsPath,
                  previousTokens: result.previousTokens,
                },
                [],
                [
                  result.action === 'removed'
                    ? `Removed ${location.envVar} from ${result.settingsPath} and opted this project out, so later probes stop writing it. Undo with \`peaks compact harness-window --reenable\`.`
                    : `Nothing to remove — ${location.envVar} was already absent from ${result.settingsPath}, so nothing was written and no opt-out row was recorded: if a probe writes a window here later, run --reset again to remove it. To say "never manage this key here" WITHOUT waiting for that first write, run \`peaks compact harness-window --disable\`.`,
                ],
              ),
              options.json,
            );
            return;
          }

          if (options.disable === true) {
            const result = disableHarnessWindowSync({ location });
            printResult(
              io,
              ok(
                'compact.harness-window',
                {
                  projectRoot: project,
                  action: result.action,
                  key: location.envVar,
                  settingsPath: result.settingsPath,
                },
                [],
                [
                  result.action === 'disabled'
                    ? `Recorded the opt-out in ${result.settingsPath}: peaks-loop will not write ${location.envVar} here, and left any value already in the file exactly as it was. Undo with \`peaks compact harness-window --reenable\`.`
                    : result.action === 'already-opted-out'
                      ? `Already opted out — ${result.settingsPath} carries ${location.envVar}'s opt-out, so nothing was written. Undo with \`peaks compact harness-window --reenable\`.`
                      : result.action === 'refused-unsafe-project-root'
                        ? `Nothing written: the resolved project root is the user's own home directory, so ${result.settingsPath} is their PERSONAL harness settings, not a project's. peaks-loop already refuses to write ${location.envVar} there, so an opt-out would change nothing except which refusal you see. Point --project at a project (a subdirectory of home is fine) and the opt-out lands there.`
                        : `Nothing written — ${result.settingsPath} is not a JSON object peaks-loop can safely edit, so the opt-out could not be recorded there.`,
                ],
              ),
              options.json,
            );
            return;
          }

          if (options.reenable === true) {
            const result = reenableHarnessWindowSync({ location });
            printResult(
              io,
              ok(
                'compact.harness-window',
                { projectRoot: project, action: result.action, key: location.envVar, settingsPath: result.settingsPath },
                [],
                [
                  result.action === 'reenabled'
                    ? 'Opt-out cleared; the next context probe will materialize the window again.'
                    : 'No opt-out was recorded for this project.',
                ],
              ),
              options.json,
            );
            return;
          }

          const state = readHarnessWindowState({ projectRoot: project, env: process.env });
          printResult(
            io,
            ok(
              'compact.harness-window',
              {
                projectRoot: project,
                managed: true,
                key: location.envVar,
                settingsPath: location.settingsPath,
                tokens: state?.tokens ?? null,
                raw: state?.raw ?? null,
                source: state?.source ?? null,
                optedOut: state?.optedOut ?? false,
                // Provenance: whether this value is peaks-loop's own write or
                // one the user set by hand. It decides whether the late 1M
                // rescue may override it, so it is not just diagnostics.
                peakWritten: state?.peakWritten ?? false,
              },
              [],
              [
                state?.tokens === null || state?.tokens === undefined
                  ? 'No window is set yet. The next `peaks code context-now` probe materializes the window it computes its ratio against.'
                  : `peaks-loop computes its context ratio against ${state.tokens} tokens; the harness fires near the end of that window. ${
                      state.peakWritten
                        ? 'peaks-loop wrote this value; it may raise it if a session outgrows it.'
                        : 'This value is not peaks-loop\'s own write, so peaks-loop will not raise it — it is treated as your setting.'
                    }`,
                'Rollback: `peaks compact harness-window --reset`.',
                'Intent-vs-observed calibration: `peaks compact history --json` → windowCalibration.',
              ],
            ),
            options.json,
          );
        } catch (error) {
          printResult(
            io,
            fail('compact.harness-window', 'COMPACT_HARNESS_WINDOW_FAILED', getErrorMessage(error), {}, ['Verify the project path is writable and a session is bound']),
            options.json,
          );
          process.exitCode = 1;
        }
      }),
  );

  // 8. peaks compact settle [--json]
  //    (slice 2026-09-13-compact-event-settle)
  //
  // The `PostCompact` hook's transport. Before this command, peaks-loop knew a
  // compaction had landed only because a LATER probe measured a ratio that had
  // fallen — an inference. This command lets the harness's own event settle the
  // run, and records what the harness said the compaction WAS (`manual` /
  // `auto`), which is the one question a ratio can never answer.
  //
  // STDOUT IS CONTEXT HERE. `PostCompact`'s output contract is truncated in the
  // retrievable docs, so the safe assumption is the `SessionStart` one: stdout
  // is added to the model's context. The hook path therefore prints NOTHING and
  // exits 0 for every outcome — success, no open run, unresolvable session,
  // unparseable stdin. An error sentence in the model's context is a false
  // problem handed to it mid-slice. Same discipline as `session reinject`;
  // `--json` is the diagnostic surface, and the hook never passes it.
  addJsonOption(
    compact
      .command('settle')
      .description(
        'PostCompact hook handler: settle the open compact run because the HARNESS reported a ' +
          'compaction completed, and append an `observed` compact-history row carrying the ' +
          'harness-reported trigger (manual | auto). Reads the hook JSON on stdin; prints nothing ' +
          'and exits 0 when run by the hook. Pass --json for the diagnostic envelope.'
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id (defaults to the canonical binding)')
  ).action(async (options: CompactSettleOptions) => {
    // One parse, two fields: reading stdin twice would let the two readers
    // disagree about the payload they were handed.
    const payload = await readHookPayload();
    const trigger = readTriggerFromHookPayload(payload);
    const hookSessionId = readSessionIdFromHookPayload(payload);
    // The hook path returns before any `process.exitCode` assignment below, so
    // the harness never sees a non-zero exit from this command.
    try {
      const project = options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
      const session = resolveSessionId(project, options.sessionId);
      if (session.error !== null) {
        if (options.json !== true) return;
        printResult(io, fail('compact.settle', session.error.code, session.error.message, { projectRoot: project }, session.error.nextActions), true);
        return;
      }
      const result: CompactSettleResult = settleCompactFromHarnessEvent({
        projectRoot: project,
        sessionId: session.sid as string,
        trigger,
        hookSessionId
      });
      if (options.json !== true) return;
      printResult(
        io,
        ok(
          'compact.settle',
          { projectRoot: project, sessionId: session.sid, trigger: trigger ?? null, ...result },
          [],
          [
            result.settled
              ? result.lifecycleWritten
                ? result.historyWritten
                  ? `Settled run ${result.runId}; appended a kind:'observed' row with pathway 'post-compact-hook'.`
                  : `Settled run ${result.runId}, but the kind:'observed' row could NOT be appended — check that .peaks/_runtime/<sid>/ is writable.`
                : `The harness reported a compaction for run ${result.runId}, but the lifecycle record could NOT be written — that run is still open, so a later probe will settle it from its own measurement and append the row then. Nothing was recorded for this event: a row here would assert a settlement the store never made.`
              : result.reason === 'different-session'
                ? `The hook payload names a different harness session, so this project's open compact run was left alone.`
                : 'No compact run was open, so nothing was settled and no history row was appended.'
          ],
        ),
        true,
      );
    } catch (error) {
      if (options.json !== true) return;
      printResult(
        io,
        fail('compact.settle', 'COMPACT_SETTLE_FAILED', getErrorMessage(error), {}, ['Verify the project path and session binding']),
        true,
      );
    }
  });
}
