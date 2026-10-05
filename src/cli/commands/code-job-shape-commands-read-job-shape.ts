/**
 *
 * Extracted from code-job-shape-commands.ts (C wave 4 near-cap split). Owns:
 * read-job-shape (read + print). Command name, options, emitted message text,
 * exit code and the ok/fail payload shape are unchanged from the predecessor's
 * inline action. The active-session-id read is passed in rather than
 * duplicated here so the one swallowing `catch` that reads presence stays in
 * exactly one place (silent-warning census: `catch-return-null`).
 */

import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  readJobShapeDecision,
  JobShapeDecisionError,
  JOB_SHAPE_NOT_DECIDED
} from '../../services/code/job-shape-decision.js';
import { findProjectRoot } from '../../services/config/config-safety.js';

type ReadJobShapeOptions = { sessionId?: string; project?: string; json?: boolean };
type ActiveSidReader = (projectRoot: string) => string | null;

export function registerCodeJobShapeReadCommand(
  code: Command,
  io: ProgramIO,
  readActiveSid: ActiveSidReader
): void {
  // v3.1.1 Step 0.8 — read-only validator. Downstream steps call this
  // to refuse to proceed if the LLM has not yet recorded a decision.
  addJsonOption(
    code
      .command('read-job-shape')
      .description(
        'v3.1.1 Step 0.8: return the recorded Job-shape decision. ' +
          'Returns JOB_SHAPE_NOT_DECIDED when the LLM has not yet recorded a verdict.'
      )
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--project <path>', 'target project root (default: findProjectRoot(cwd))')
  ).action((opts: ReadJobShapeOptions) => {
    runReadJobShape(io, opts, readActiveSid);
  });
}

function runReadJobShape(
  io: ProgramIO,
  opts: ReadJobShapeOptions,
  readActiveSid: ActiveSidReader
): void {
  try {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const sessionId = opts.sessionId ?? readActiveSid(projectRoot);
    if (sessionId === null) {
      printReadJobShapeNoSession(io, opts);
      process.exitCode = 1;
      return;
    }
    const record = readJobShapeDecision(projectRoot, sessionId);
    printReadJobShapeDecision(io, opts, record);
  } catch (err) {
    printReadJobShapeError(io, opts, err);
  }
}

function printReadJobShapeNoSession(io: ProgramIO, opts: ReadJobShapeOptions): void {
  printResult(
    io,
    fail(
      'code.read-job-shape',
      'NO_ACTIVE_SESSION',
      'no active session id; pass --session-id or set presence via `peaks skill presence:set peaks-code`',
      null,
      ['Re-run with --session-id <sid>']
    ),
    opts.json
  );
}

function printReadJobShapeDecision(
  io: ProgramIO,
  opts: ReadJobShapeOptions,
  record: ReturnType<typeof readJobShapeDecision>
): void {
  printResult(
    io,
    ok(
      'code.read-job-shape',
      {
        sessionId: record.sessionId,
        promptHash: record.promptHash,
        decision: record.decision,
        schemaVersion: record.schemaVersion
      },
      [],
      [
        `Decision on file: isJob=${record.decision.isJob} strategy=${record.decision.suggestedStrategy} confidence=${record.decision.confidence}`
      ]
    ),
    opts.json
  );
}

function printReadJobShapeError(io: ProgramIO, opts: ReadJobShapeOptions, err: unknown): void {
  if (err instanceof JobShapeDecisionError) {
    printResult(
      io,
      fail('code.read-job-shape', err.code, err.message, err.details ?? null, [
        err.code === JOB_SHAPE_NOT_DECIDED
          ? 'Run `peaks code detect-job` to record a decision.'
          : 'Investigate the decision file integrity.'
      ]),
      opts.json
    );
    process.exitCode = 1;
    return;
  }
  printResult(
    io,
    fail('code.read-job-shape', 'READ_JOB_SHAPE_FAILED', getErrorMessage(err), null, [
      'Verify the project path and try again'
    ]),
    opts.json
  );
  process.exitCode = 1;
}
