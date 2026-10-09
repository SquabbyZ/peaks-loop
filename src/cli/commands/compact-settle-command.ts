// `peaks compact settle` — the `PostCompact` hook's transport. Lets the harness's own
// event settle the open compact run instead of inferring it from a later ratio.
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { fail, ok, getErrorMessage } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readSessionIdFromHookPayload,
  readTriggerFromHookPayload,
  settleCompactFromHarnessEvent,
  type CompactSettleResult
} from '../../services/code/compact-event-settle.js';
import { resolveSessionId } from './compact-shared.js';

type CompactSettleOptions = {
  json?: boolean;
  project?: string;
  sessionId?: string;
};

const COMPACT_SETTLE_DESCRIPTION =
  'PostCompact hook handler: settle the open compact run because the HARNESS reported a ' +
  'compaction completed, and append an `observed` compact-history row carrying the ' +
  'harness-reported trigger (manual | auto). Reads the hook JSON on stdin; prints nothing ' +
  'and exits 0 when run by the hook. Pass --json for the diagnostic envelope.';

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
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function reportCompactSettleSessionFailure(
  io: ProgramIO,
  error: { code: string; message: string; nextActions: string[] },
  project: string
): void {
  printResult(
    io,
    fail('compact.settle', error.code, error.message, { projectRoot: project }, error.nextActions),
    true
  );
}

function buildCompactSettleNextActions(result: CompactSettleResult) {
  return [
    result.settled
      ? result.lifecycleWritten
        ? result.historyWritten
          ? `Settled run ${result.runId}; appended a kind:'observed' row with pathway 'post-compact-hook'.`
          : `Settled run ${result.runId}, but the kind:'observed' row could NOT be appended — check that .peaks/_runtime/<sid>/ is writable.`
        : `The harness reported a compaction for run ${result.runId}, but the lifecycle record could NOT be written — that run is still open, so a later probe will settle it from its own measurement and append the row then. Nothing was recorded for this event: a row here would assert a settlement the store never made.`
      : result.reason === 'different-session'
        ? `The hook payload names a different harness session, so this project's open compact run was left alone.`
        : 'No compact run was open, so nothing was settled and no history row was appended.'
  ];
}

function reportCompactSettleFailure(io: ProgramIO, error: unknown): void {
  printResult(
    io,
    fail('compact.settle', 'COMPACT_SETTLE_FAILED', getErrorMessage(error), {}, [
      'Verify the project path and session binding'
    ]),
    true
  );
}

async function runCompactSettle(options: CompactSettleOptions, io: ProgramIO): Promise<void> {
  // One parse, two fields: reading stdin twice would let the two readers
  // disagree about the payload they were handed.
  const payload = await readHookPayload();
  const trigger = readTriggerFromHookPayload(payload);
  const hookSessionId = readSessionIdFromHookPayload(payload);
  // The hook path returns before any `process.exitCode` assignment below, so
  // the harness never sees a non-zero exit from this command.
  try {
    const project =
      options.project !== undefined
        ? resolveCanonicalProjectRoot(options.project)
        : (findProjectRoot(process.cwd()) ?? process.cwd());
    const session = resolveSessionId(project, options.sessionId);
    if (session.error !== null) {
      if (options.json !== true) return;
      reportCompactSettleSessionFailure(io, session.error, project);
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
        buildCompactSettleNextActions(result)
      ),
      true
    );
  } catch (error) {
    if (options.json !== true) return;
    reportCompactSettleFailure(io, error);
  }
}

export function registerCompactSettleCommand(compact: Command, io: ProgramIO): void {
  // 8. peaks compact settle [--json]
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
      .description(COMPACT_SETTLE_DESCRIPTION)
      .option('--project <path>', 'project root (defaults to git root or cwd)')
      .option(
        '--session-id <sid>',
        'override the active session id (defaults to the canonical binding)'
      )
  ).action((options: CompactSettleOptions) => runCompactSettle(options, io));
}
