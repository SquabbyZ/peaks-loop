/**
 * `peaks sub-agent exec` — slice 4.0.7-PR-meta-6.
 *
 * Companion to `peaks sub-agent dispatch` (slice 2026-06-07). The
 * dispatch CLI is dry-run by design (per skill-first / CLI-auxiliary
 * red line PB-4): it returns a `toolCall` envelope that the LLM
 * extracts args from and re-executes via the Agent tool. The 4.0.7
 * ice-cola dogfood pass surfaced the friction: the LLM often
 * skipped the dispatch altogether instead of paying the parse
 * cost, and routed `Edit` calls directly. PR-meta-4 lowered the
 * friction by adding `--emit-bash-script`, which prints a
 * ready-to-exec bash script alongside the JSON envelope. PR-meta-6
 * ships the actual surface the script invokes: this `exec`
 * sub-command reads the dispatch record from disk (the same
 * record the dispatch CLI wrote) and re-emits the canonical
 * toolCall envelope so the LLM does not have to hand-parse the
 * JSON to retry a dispatch.
 *
 * Architecture (PR-meta-6):
 *   1. The user (or the LLM via Bash tool) runs the script
 *      emitted by `peaks sub-agent dispatch --emit-bash-script`.
 *   2. The script invokes `peaks sub-agent exec --session-id ...
 *      --request-id ... --role ... --batch-id ... --dispatch-record ...
 *      --project ...`.
 *   3. `exec` reads the dispatch record from disk, re-emits the
 *      same toolCall envelope, and prints a single next-action
 *      line: "Run this Task tool call to dispatch."
 *
 * The dry-run architecture is preserved: the LLM still has the
 * final say on whether to actually spawn the Task tool. The
 * script + exec pair is a transparent retry path, not a side-step.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

interface SubAgentExecOptions {
  sessionId?: string;
  requestId?: string;
  role?: string;
  batchId?: string;
  dispatchRecord?: string;
  project?: string;
  json?: boolean;
}

/**
 * Shape of a dispatch record on disk (slice 2026-06-07 +
 * dispatch-record metadata). We only read the fields `exec` needs
 * to re-emit the toolCall envelope; everything else (heartbeat,
 * artifacts, lease, isolation) is preserved by the dispatch record
 * itself and surfaced in the re-emitted envelope.
 */
interface DispatchRecordToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface DispatchRecord {
  toolCall?: DispatchRecordToolCall;
  promptSize?: number;
  originalPromptSize?: number;
  batchId?: string;
  rid?: string;
  role?: string;
  sessionId?: string;
}

function failExec(command: string, message: string, options: SubAgentExecOptions, hint: string): never {
  printResult(
    undefined as never, // io is plumbed below
    fail(command, 'SUB_AGENT_EXEC_FAILED', message, null, [hint]),
    options.json
  );
  // The above `printResult` expects io — the real call site passes
  // io explicitly. This helper is only used for type-level
  // documentation; the actual printing is inline in the action.
  throw new Error(message);
}

export function registerSubAgentExecCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('exec')
      .description(
        'Slice 4.0.7-PR-meta-6. Re-emit a stored dispatch envelope. Companion to `peaks sub-agent dispatch --emit-bash-script`. Reads the dispatch record from `--dispatch-record` and prints the canonical toolCall envelope so the LLM does not have to hand-parse the JSON to retry. Dry-run: the LLM still owns the actual Agent tool invocation.'
      )
      .requiredOption('--session-id <sid>', 'session id the dispatch was created in')
      .requiredOption('--request-id <rid>', 'request id the dispatch was created for')
      .requiredOption('--role <role>', 'sub-agent role (rd | qa | ui | sc | txt | qa-business | qa-business-api)')
      .requiredOption('--batch-id <uuid>', 'batch id the dispatch was created in')
      .requiredOption('--dispatch-record <path>', 'path to the dispatch record JSON (the same file the dispatch CLI wrote under .peaks/_sub_agents/<sid>/)')
      .requiredOption('--project <path>', 'target project root (echoed back in the envelope; not used to read files)')
  ).action((options: SubAgentExecOptions) => {
    if (options.dispatchRecord === undefined || !existsSync(options.dispatchRecord)) {
      printResult(
        io,
        fail('sub-agent.exec', 'DISPATCH_RECORD_MISSING',
          `Dispatch record not found at ${options.dispatchRecord ?? '(unset)'}`,
          null,
          [
            'Re-run `peaks sub-agent dispatch <role> --prompt <text> --request-id <rid> --json` to create the record.',
            'Then pass the emitted `dispatchRecordPath` to `peaks sub-agent exec --dispatch-record <path>`.'
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    let record: DispatchRecord;
    try {
      record = JSON.parse(readFileSync(options.dispatchRecord, 'utf8')) as DispatchRecord;
    } catch (err) {
      printResult(
        io,
        fail('sub-agent.exec', 'DISPATCH_RECORD_INVALID',
          `Failed to parse dispatch record: ${err instanceof Error ? err.message : String(err)}`,
          { dispatchRecord: options.dispatchRecord },
          [
            'The dispatch record may be truncated. Re-run `peaks sub-agent dispatch` to create a fresh record.'
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    if (record.toolCall === undefined) {
      printResult(
        io,
        fail('sub-agent.exec', 'DISPATCH_RECORD_NO_TOOL_CALL',
          'Dispatch record has no `toolCall` field. The record may be from a pre-toolCall era; re-run `peaks sub-agent dispatch` to create a fresh record.',
          { dispatchRecord: options.dispatchRecord },
          [
            'Re-run `peaks sub-agent dispatch` to create a fresh record with a `toolCall` envelope.'
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // Sanity check: the record's sessionId / rid / batchId / role
    // should match the CLI flags (if the caller passed them). This
    // is defensive: a mismatch usually means the operator is
    // running the wrong script. We surface a warning but still
    // re-emit the envelope (do not block — the dispatch record
    // is the canonical source of truth).
    const warnings: string[] = [];
    if (options.sessionId !== undefined && record.sessionId !== undefined && record.sessionId !== options.sessionId) {
      warnings.push(`session-id mismatch: record=${record.sessionId} vs --session-id=${options.sessionId}; using the record's value as the canonical source.`);
    }
    if (options.requestId !== undefined && record.rid !== undefined && record.rid !== options.requestId) {
      warnings.push(`request-id mismatch: record=${record.rid} vs --request-id=${options.requestId}; using the record's value.`);
    }
    if (options.batchId !== undefined && record.batchId !== undefined && record.batchId !== options.batchId) {
      warnings.push(`batch-id mismatch: record=${record.batchId} vs --batch-id=${options.batchId}; using the record's value.`);
    }
    if (options.role !== undefined && record.role !== undefined && record.role !== options.role) {
      warnings.push(`role mismatch: record=${record.role} vs --role=${options.role}; using the record's value.`);
    }

    const nextActions = [
      'This is a dry-run re-emit. Run the Task tool with the printed `toolCall.args` to actually dispatch the sub-agent.',
      `After dispatching, the sub-agent should call \`peaks sub-agent heartbeat --record ${options.dispatchRecord}\` periodically.`
    ];

    // Re-emit the same envelope shape as `peaks sub-agent dispatch`
    // so consumers (LLM or downstream tooling) can treat both CLIs
    // as the same surface. Slice 4.0.7-PR-meta-6: the envelope
    // version is bumped to 2.4.0 to mark the new `viaExec` field
    // (true here; false in dispatch CLI output).
    printResult(
      io,
      ok('sub-agent.exec', {
        envelopeVersion: '2.4.0',
        viaExec: true,
        sourceDispatchRecord: options.dispatchRecord,
        role: record.role ?? options.role,
        sessionId: record.sessionId ?? options.sessionId,
        rid: record.rid ?? options.requestId,
        batchId: record.batchId ?? options.batchId,
        promptSize: record.promptSize ?? 0,
        originalPromptSize: record.originalPromptSize ?? 0,
        toolCall: record.toolCall
      }, warnings, nextActions),
      options.json
    );
  });
}

// Helper export so tests can drive the underlying logic without
// invoking the action handler. The action handler is the
// integration path; the helper is the unit path.
export function readDispatchRecordForExec(dispatchRecordPath: string): DispatchRecord {
  if (!existsSync(dispatchRecordPath)) {
    throw new Error(`DISPATCH_RECORD_MISSING: ${dispatchRecordPath}`);
  }
  return JSON.parse(readFileSync(dispatchRecordPath, 'utf8')) as DispatchRecord;
}
void dirname;
