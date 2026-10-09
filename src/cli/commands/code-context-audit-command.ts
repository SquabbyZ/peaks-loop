// `peaks code context-audit` — what fills the window, grouped by tool + short input
// key. Read-only and fail-soft: it never sets a non-zero exit code.
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { ok } from 'peaks-loop-shared/result';
import { auditContext } from '../../services/context/context-audit.js';
import { resolveOuterSessionId } from '../../services/session/binding-status-service.js';
import { readActiveSid } from './code-runtime-session.js';

const CONTEXT_AUDIT_DESCRIPTION =
  "Slice 2026-09-10 Slice A: report what fills the current session's " +
  'context window, grouped by tool + short input key (command line / ' +
  "path tail / pattern), sorted by bytes. Locates the CURRENT session's " +
  "IDE transcript through the active adapter's " +
  '`compact.resolveTranscriptPath` (vendor-neutral); emits total bytes, ' +
  'entry count, and the top-N groups ' +
  '(`{tool, key, bytes, pctOfTotal, count}`). Read-only and fail-soft — ' +
  'a missing/oversized/corrupt transcript returns `available:false` ' +
  'with a reason and never blocks. Never dumps tool result content.';

interface ContextAuditOpts {
  project: string;
  sessionId?: string;
  top?: number;
  transcript?: string;
  json?: boolean;
}

/** The catch branch, lifted verbatim out of the action body (fail-soft, exit code untouched). */
function reportContextAuditFailure(io: ProgramIO, err: unknown, json?: boolean): void {
  printResult(
    io,
    ok(
      'code.context-audit',
      {
        available: false,
        reason: `audit-failed: ${getErrorMessage(err)}`,
        transcriptPath: null,
        totalBytes: 0,
        entryCount: 0,
        groupCount: 0,
        topN: 0,
        entries: []
      },
      [],
      ['context-audit is a read-only probe; continue without it.']
    ),
    json
  );
}

/** The action body, lifted to a module-level function so both it and the registrar fit in 50 lines. */
function runCodeContextAudit(opts: ContextAuditOpts, io: ProgramIO): void {
  try {
    // `resolveOuterSessionId` checks the env signal FIRST, so the peaks
    // session id is only a fallback lookup key — mirror context-now's
    // 'unknown' default so an unbound presence still resolves via env.
    const sessionId = opts.sessionId ?? readActiveSid(opts.project) ?? 'unknown';
    const outerSessionId = resolveOuterSessionId(opts.project, sessionId);
    const result = auditContext({
      outerSessionId: outerSessionId ?? null,
      ...(opts.top !== undefined ? { topN: opts.top } : {}),
      ...(opts.transcript !== undefined ? { transcriptPath: opts.transcript } : {})
    });
    // Fail-soft contract: unavailability is DATA, not an error. The exit
    // code stays 0 so a `context-audit` call can never block a workflow.
    const nextActions = result.available
      ? [
          `${result.entryCount} tool result(s) across ${result.groupCount} group(s); showing top ${result.entries.length}.`
        ]
      : [
          `context-audit unavailable: ${result.reason ?? 'unknown'} — continue without it (read-only probe).`
        ];
    printResult(io, ok('code.context-audit', { ...result }, [], nextActions), opts.json);
  } catch (err) {
    reportContextAuditFailure(io, err, opts.json);
  }
}

export function registerCodeContextAuditCommand(code: Command, io: ProgramIO): void {
  // WHAT fills the orchestrator window. `context-now` returns a ratio; this
  // returns the grouped byte breakdown of tool results from the live
  // transcript. Read-only + fail-soft: an unavailable transcript reports
  // `available:false` with a reason and NEVER sets a non-zero exit code.
  addJsonOption(
    code
      .command('context-audit')
      .description(CONTEXT_AUDIT_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <sid>', 'override session id (default: read from active presence)')
      .option('--top <n>', 'number of top entries to emit (default 15, max 100)', (value: string) =>
        Number(value)
      )
      .option('--transcript <path>', 'override the transcript jsonl path (test seam)')
  ).action((opts: ContextAuditOpts) => runCodeContextAudit(opts, io));
}
