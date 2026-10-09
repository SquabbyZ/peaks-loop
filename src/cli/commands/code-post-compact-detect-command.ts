// `peaks code post-compact-detect` — is this invocation a same-day post-compact
// resume? Owns its own refusal envelope, so it owns its own file.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  detectPostCompactResume,
  formatPostCompactResumeLogLine
} from '../../services/code/post-compact-detector.js';
import { readActiveSid } from './code-runtime-session.js';

function printPostCompactNoActiveSession(io: ProgramIO, opts: { json?: boolean }): void {
  printResult(
    io,
    fail(
      'code.post-compact-detect',
      'NO_ACTIVE_SESSION',
      'no active session id; pass --session-id or set presence via `peaks skill presence:set peaks-code`',
      null,
      ['Re-run with --session-id <sid>']
    ),
    opts.json
  );
  process.exitCode = 1;
}

const POST_COMPACT_DETECT_DESCRIPTION =
  'v2.11.0 D7: detect whether the current invocation is a same-day post-compact resume. ' +
  'Auto-resumes (no AskUserQuestion) when the most-recent checkpoint is from today, has a mode field, ' +
  'and the active skill is peaks-code. Falls through to the normal Step 0.7 flow otherwise.';

interface PostCompactDetectOpts {
  project: string;
  sessionId?: string;
  activeSkill?: string;
  json?: boolean;
}

/** The catch branch, lifted verbatim out of the action body. */
function reportPostCompactDetectFailure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    fail('code.post-compact-detect', 'POST_COMPACT_DETECT_FAILED', getErrorMessage(err), null, [
      'Verify the project path and try again'
    ]),
    json
  );
  process.exitCode = 1;
}

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
async function runPostCompactDetect(opts: PostCompactDetectOpts, io: ProgramIO): Promise<void> {
  try {
    const sessionId = opts.sessionId ?? readActiveSid(opts.project);
    if (sessionId === null) {
      printPostCompactNoActiveSession(io, opts);
      return;
    }
    const probe = await detectPostCompactResume({
      sessionId,
      projectRoot: opts.project,
      activeSkill: opts.activeSkill
    });
    const logLine = formatPostCompactResumeLogLine(probe);
    printResult(
      io,
      ok(
        'code.post-compact-detect',
        { ...probe, logLine },
        [...probe.warnings],
        [
          probe.shouldAutoResume
            ? `Post-compact match → auto-resume mode=${probe.mode ?? '?'} checkpoint=${probe.checkpointPath ?? '?'}`
            : `No auto-resume: ${probe.reason}`
        ]
      ),
      opts.json
    );
  } catch (err) {
    reportPostCompactDetectFailure(io, err, opts.json);
  }
}

export function registerCodePostCompactDetectCommand(code: Command, io: ProgramIO): void {
  addJsonOption(
    code
      .command('post-compact-detect')
      .description(POST_COMPACT_DETECT_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option(
        '--active-skill <skill>',
        'override active skill (test seam; default: read from presence)'
      )
  ).action((opts: PostCompactDetectOpts) => runPostCompactDetect(opts, io));
}
