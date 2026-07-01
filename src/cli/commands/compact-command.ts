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
import { fail, ok, getErrorMessage } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { writeCheckpoint } from '../../services/session/session-checkpoint-service.js';
import { getSessionIdCanonical } from '../../services/session/session-manager.js';
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
}
