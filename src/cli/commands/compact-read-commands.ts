// `peaks compact suggest | recommend | survival` — the three read-only lookups: the
// two-signal suggestion, the phase-pair table, and the static survival table.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  buildRecommendEnvelopePure,
  suggestCompact
} from '../../services/compact/suggest-service.js';
import {
  PHASES,
  SURVIVAL_TABLE,
  isPhase,
  lookupPhaseTransition
} from '../../services/compact/decision-tables.js';
import { resolveSessionId } from './compact-shared.js';

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

type CompactSuggestResult = ReturnType<typeof suggestCompact>;

const COMPACT_SUGGEST_DESCRIPTION =
  'Two-signal suggestion (context-size + tool-call-count). ' +
  'Honor COMPACT_THRESHOLD / COMPACT_CONTEXT_THRESHOLD / COMPACT_CONTEXT_INTERVAL env vars. ' +
  'Read-only by default; pass --apply to also append a one-line info row to the session log.';

const COMPACT_RECOMMEND_DESCRIPTION =
  `Strategic-compact "Compaction Decision Guide" lookup. ` +
  `Valid phases: ${PHASES.join(', ')}. Pure function over (from, to); no I/O.`;

const COMPACT_SURVIVAL_DESCRIPTION =
  'Strategic-compact "What Survives Compaction" table. Pure static data; no I/O.';

function reportCompactSuggestSessionFailure(
  io: ProgramIO,
  error: { code: string; message: string; nextActions: string[] },
  projectRoot: string,
  json?: boolean
): void {
  printResult(
    io,
    fail('compact.suggest', error.code, error.message, { projectRoot }, error.nextActions),
    json
  );
  process.exitCode = 1;
}

function buildCompactSuggestNextActions(result: CompactSuggestResult) {
  return [
    result.shouldSuggest
      ? `Run \`peaks compact force --reason "<short note>"\` to checkpoint, then /compact.`
      : `Context at ${(result.ratio * 100).toFixed(1)}% (${result.tokensUsed} of ${result.windowKind === '1m' ? '1M' : '200k'}); below threshold.`
  ];
}

function reportCompactSuggestFailure(io: ProgramIO, error: unknown, json?: boolean): void {
  printResult(
    io,
    fail('compact.suggest', 'COMPACT_SUGGEST_FAILED', getErrorMessage(error), {}, [
      'Verify project root and session binding before retrying'
    ]),
    json
  );
  process.exitCode = 1;
}

function runCompactSuggest(options: CompactSuggestOptions, io: ProgramIO): void {
  try {
    const projectRoot =
      options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
    const session = resolveSessionId(projectRoot, options.sessionId);
    if (session.error !== null) {
      reportCompactSuggestSessionFailure(io, session.error, projectRoot, options.json);
      return;
    }
    const result = suggestCompact({
      projectRoot,
      sessionId: session.sid
    });
    printResult(
      io,
      ok('compact.suggest', result, [], buildCompactSuggestNextActions(result)),
      options.json
    );
  } catch (error) {
    reportCompactSuggestFailure(io, error, options.json);
  }
}

function reportRecommendInvalidFrom(io: ProgramIO, value: string, json?: boolean): void {
  printResult(
    io,
    fail(
      'compact.recommend',
      'INVALID_PHASE',
      `--from must be one of ${PHASES.join(', ')} (got "${value}")`,
      { from: value },
      [`Use --from ${PHASES.join('|')}`]
    ),
    json
  );
  process.exitCode = 1;
}

function reportRecommendInvalidTo(io: ProgramIO, value: string, json?: boolean): void {
  printResult(
    io,
    fail(
      'compact.recommend',
      'INVALID_PHASE',
      `--to must be one of ${PHASES.join(', ')} (got "${value}")`,
      { to: value },
      [`Use --to ${PHASES.join('|')}`]
    ),
    json
  );
  process.exitCode = 1;
}

function reportCompactRecommendFailure(
  io: ProgramIO,
  error: unknown,
  options: CompactRecommendOptions
): void {
  printResult(
    io,
    fail(
      'compact.recommend',
      'COMPACT_RECOMMEND_FAILED',
      getErrorMessage(error),
      { from: options.from, to: options.to },
      ['Verify the phase pair against the documented transitions']
    ),
    options.json
  );
  process.exitCode = 1;
}

function runCompactRecommend(options: CompactRecommendOptions, io: ProgramIO): void {
  try {
    if (!isPhase(options.from)) {
      reportRecommendInvalidFrom(io, options.from, options.json);
      return;
    }
    if (!isPhase(options.to)) {
      reportRecommendInvalidTo(io, options.to, options.json);
      return;
    }
    const envelope = buildRecommendEnvelopePure(options.from, options.to);
    const lookup = lookupPhaseTransition(options.from, options.to);
    printResult(
      io,
      ok(
        'compact.recommend',
        {
          from: envelope.from,
          to: envelope.to,
          shouldCompact: envelope.shouldCompact,
          severity: envelope.severity,
          rationale: envelope.rationale,
          suggestedMessage: envelope.suggestedMessage,
          notInTable: lookup.notInTable
        },
        lookup.notInTable
          ? [
              `Transition ${options.from} → ${options.to} is not in the strategic-compact table; defaulting to severity=no.`
            ]
          : []
      ),
      options.json
    );
  } catch (error) {
    reportCompactRecommendFailure(io, error, options);
  }
}

function runCompactSurvival(options: CompactSurvivalOptions, io: ProgramIO): void {
  printResult(
    io,
    ok(
      'compact.survival',
      {
        persists: [...SURVIVAL_TABLE.persists],
        lost: [...SURVIVAL_TABLE.lost]
      },
      [],
      [
        'Persists = guaranteed across `/compact`. Lost = not preserved; persist to disk before compacting.'
      ]
    ),
    options.json
  );
}

export function registerCompactReadCommands(compact: Command, io: ProgramIO): void {
  // -----------------------------------------------------------------
  // 1. peaks compact suggest [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('suggest')
      .description(COMPACT_SUGGEST_DESCRIPTION)
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option(
        '--session-id <sid>',
        'override the active session id (defaults to the canonical binding)'
      )
      .option(
        '--apply',
        'append a one-line info row to .peaks/_runtime/<sid>/session.json (default: dry-run)'
      )
  ).action((options: CompactSuggestOptions) => runCompactSuggest(options, io));

  // -----------------------------------------------------------------
  // 2. peaks compact recommend --from <phase> --to <phase> [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('recommend')
      .description(COMPACT_RECOMMEND_DESCRIPTION)
      .requiredOption('--from <phase>', `source phase (one of ${PHASES.join(', ')})`)
      .requiredOption('--to <phase>', `target phase (one of ${PHASES.join(', ')})`)
  ).action((options: CompactRecommendOptions) => runCompactRecommend(options, io));

  // -----------------------------------------------------------------
  // 3. peaks compact survival [--json]
  // -----------------------------------------------------------------
  addJsonOption(compact.command('survival').description(COMPACT_SURVIVAL_DESCRIPTION)).action(
    (options: CompactSurvivalOptions) => runCompactSurvival(options, io)
  );
}
