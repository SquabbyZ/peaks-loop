// `peaks compact dry-run` — the composite preview of (suggest + recommend + survival).
// No writes.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { dryRunCompact } from '../../services/compact/suggest-service.js';
import { PHASES, isPhase, type Phase } from '../../services/compact/decision-tables.js';
import { resolveSessionId } from './compact-shared.js';

type CompactDryRunOptions = {
  from?: string;
  to?: string;
  json?: boolean;
  project?: string;
  sessionId?: string;
};

type SessionResolveError = { code: string; message: string; nextActions: string[] };

export function registerCompactDryRunCommand(compact: Command, io: ProgramIO): void {
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
      .option(
        '--from <phase>',
        `optional source phase for recommend lookup (one of ${PHASES.join(', ')})`
      )
      .option(
        '--to <phase>',
        `optional target phase for recommend lookup (one of ${PHASES.join(', ')})`
      )
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option('--session-id <sid>', 'override the active session id')
  ).action((options: CompactDryRunOptions) => runCompactDryRun(options, io));
}

function runCompactDryRun(options: CompactDryRunOptions, io: ProgramIO): void {
  try {
    const projectRoot =
      options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
    const session = resolveSessionId(projectRoot, options.sessionId);
    if (session.error !== null) {
      printCompactDryRunSessionError(session.error, projectRoot, io, options.json);
      return;
    }
    if ((options.from === undefined) !== (options.to === undefined)) {
      printCompactDryRunPhasePairIncomplete(options, io);
      return;
    }
    if (options.from !== undefined && !isPhase(options.from)) {
      printCompactDryRunInvalidFrom(options.from, io, options.json);
      return;
    }
    if (options.to !== undefined && !isPhase(options.to)) {
      printCompactDryRunInvalidTo(options.to, io, options.json);
      return;
    }
    const hasPhasePair = options.from !== undefined && options.to !== undefined;
    const dryRunInput: {
      projectRoot: string;
      sessionId: string | null;
      from?: Phase;
      to?: Phase;
    } = {
      projectRoot,
      sessionId: session.sid
    };
    if (hasPhasePair) {
      dryRunInput.from = options.from as Phase;
      dryRunInput.to = options.to as Phase;
    }
    const result = dryRunCompact(dryRunInput);
    printCompactDryRunResult(result, io, options.json);
  } catch (error) {
    reportCompactDryRunFailure(io, error, options.json);
  }
}

function printCompactDryRunSessionError(
  error: SessionResolveError,
  projectRoot: string,
  io: ProgramIO,
  json?: boolean
): void {
  printResult(
    io,
    fail('compact.dry-run', error.code, error.message, { projectRoot }, error.nextActions),
    json
  );
  process.exitCode = 1;
}

function printCompactDryRunPhasePairIncomplete(options: CompactDryRunOptions, io: ProgramIO): void {
  printResult(
    io,
    fail(
      'compact.dry-run',
      'PHASE_PAIR_INCOMPLETE',
      'Both --from and --to must be provided together',
      { from: options.from, to: options.to },
      ['Pass both --from and --to, or omit both for a suggest-only dry-run']
    ),
    options.json
  );
  process.exitCode = 1;
}

function printCompactDryRunInvalidFrom(from: string, io: ProgramIO, json?: boolean): void {
  printResult(
    io,
    fail(
      'compact.dry-run',
      'INVALID_PHASE',
      `--from must be one of ${PHASES.join(', ')} (got "${from}")`,
      { from },
      [`Use --from ${PHASES.join('|')}`]
    ),
    json
  );
  process.exitCode = 1;
}

function printCompactDryRunInvalidTo(to: string, io: ProgramIO, json?: boolean): void {
  printResult(
    io,
    fail(
      'compact.dry-run',
      'INVALID_PHASE',
      `--to must be one of ${PHASES.join(', ')} (got "${to}")`,
      { to },
      [`Use --to ${PHASES.join('|')}`]
    ),
    json
  );
  process.exitCode = 1;
}

function printCompactDryRunResult(
  result: ReturnType<typeof dryRunCompact>,
  io: ProgramIO,
  json?: boolean
): void {
  printResult(
    io,
    ok(
      'compact.dry-run',
      result,
      [],
      [
        result.action === 'compact'
          ? `Action=compact: run \`peaks compact force --reason "<note>"\`, then /compact.`
          : `Action=skip: continue without compacting.`
      ]
    ),
    json
  );
}

function reportCompactDryRunFailure(io: ProgramIO, error: unknown, json?: boolean): void {
  printResult(
    io,
    fail('compact.dry-run', 'COMPACT_DRY_RUN_FAILED', getErrorMessage(error), {}, [
      'Verify project root, session binding, and phase pair before retrying'
    ]),
    json
  );
  process.exitCode = 1;
}
