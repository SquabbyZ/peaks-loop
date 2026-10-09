// `peaks compact history` — the per-session compact-history.jsonl summary and the
// intent-vs-observed window calibration read off it.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  computeWindowCalibration,
  readCompactHistory,
  summarizeCompactHistory,
  type CompactHistoryReadResult
} from '../../services/compact-history/compact-history-service.js';
import { resolveSessionId } from './compact-shared.js';

const COMPACT_HISTORY_DESCRIPTION =
  'Read the per-session compact-history.jsonl and emit a structured ' +
  'summary of every auto-compact dispatch in the current session.';

interface CompactHistoryOptions {
  project?: string;
  sessionId?: string;
  json?: boolean;
}

type CompactHistoryOkResult = Extract<CompactHistoryReadResult, { kind: 'ok' }>;

function reportCompactHistorySessionFailure(
  io: ProgramIO,
  error: { code: string; message: string; nextActions: string[] },
  project: string,
  json?: boolean
): void {
  printResult(
    io,
    fail('compact.history', error.code, error.message, { projectRoot: project }, error.nextActions),
    json
  );
  process.exitCode = 1;
}

function reportCompactHistoryMissing(
  io: ProgramIO,
  sessionId: string | null,
  historyPath: string,
  json?: boolean
): void {
  printResult(
    io,
    ok('compact.history', {
      sessionId,
      totalCompacts: 0,
      message: 'No compact-history.jsonl yet; auto-compact has not fired in this session.',
      historyPath
    }),
    json
  );
}

function reportCompactHistoryEmpty(
  io: ProgramIO,
  sessionId: string | null,
  historyPath: string,
  json?: boolean
): void {
  printResult(
    io,
    ok('compact.history', {
      sessionId,
      totalCompacts: 0,
      message: 'compact-history.jsonl exists but is empty.',
      historyPath
    }),
    json
  );
}

function reportCompactHistorySummary(
  io: ProgramIO,
  sessionId: string | null,
  result: CompactHistoryOkResult,
  json?: boolean
): void {
  const summary = summarizeCompactHistory(result.events);
  // intent-vs-observed record. `pairs[i].requestedTokens` is the token
  // point peaks-loop asked for; `observedTokens` is what the next real
  // session actually measured. Unmeasured pairs are reported as such —
  // this instrument states what happened, it does not predict.
  const windowCalibration = computeWindowCalibration(result.events);
  printResult(
    io,
    ok('compact.history', {
      sessionId,
      ...summary,
      windowCalibration,
      events: result.events,
      parseErrors: result.parseErrors,
      historyPath: result.path
    }),
    json
  );
}

function reportCompactHistoryFailure(io: ProgramIO, error: unknown, json?: boolean): void {
  printResult(
    io,
    fail('compact.history', 'COMPACT_HISTORY_READ_FAILED', getErrorMessage(error), {}, [
      'Verify the project path is readable and a session is bound'
    ]),
    json
  );
  process.exitCode = 1;
}

function runCompactHistory(options: CompactHistoryOptions, io: ProgramIO): void {
  try {
    const project =
      options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
    const session = resolveSessionId(project, options.sessionId);
    if (session.error !== null) {
      reportCompactHistorySessionFailure(io, session.error, project, options.json);
      return;
    }
    const result = readCompactHistory({
      projectRoot: project,
      sessionId: session.sid as string
    });
    if (result.kind === 'file-missing') {
      reportCompactHistoryMissing(io, session.sid, result.path, options.json);
      return;
    }
    if (result.kind === 'empty') {
      reportCompactHistoryEmpty(io, session.sid, result.path, options.json);
      return;
    }
    reportCompactHistorySummary(io, session.sid, result, options.json);
  } catch (error) {
    reportCompactHistoryFailure(io, error, options.json);
  }
}

export function registerCompactHistoryCommand(compact: Command, io: ProgramIO): void {
  // -----------------------------------------------------------------
  // 6. peaks compact history [--json]
  // -----------------------------------------------------------------
  addJsonOption(
    compact
      .command('history')
      .description(COMPACT_HISTORY_DESCRIPTION)
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option(
        '--session-id <sid>',
        'override the active session id (defaults to the canonical binding)'
      )
      .action((options: CompactHistoryOptions) => runCompactHistory(options, io))
  );
}
