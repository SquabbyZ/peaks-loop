// src/cli/commands/batch-report-command.ts
//
// `peaks batch report` — landing a diagnosis report on disk and reading
// back the summary the orchestrator's window may hold.
//
// WHY THIS EXISTS. A batch produces one diagnosis report per item, and the
// orchestrator's window cannot hold all of them: twenty sub-agent reports
// cost ≈60 KB ≈15K tokens, and a batch produces N at once. So the report
// lands on disk, and the orchestrator's context keeps only the ≤2 KB
// summary — the conclusion, the MEASURED file set (the topology stage's
// only input), and a one-line sketch. The full report is read back on
// demand, when a phase needs the detail the summary left out.
//
// WHY THE ORCHESTRATOR WRITES THE REPORT RATHER THAN THE DIAGNOSTICIAN.
// The diagnosis phase is read-only on purpose: a diagnostician that also
// wrote files would be reporting a guess about what it changed, and the
// whole measurement premise of the batch would be gone. The report is the
// diagnostician's own words, so the party that HOLDS those words — the
// orchestrator — is the party that lands them.
//
// THE TWO ACTIONS. `write` lands a report and answers with its summary;
// `read` answers with the summary again, or with the whole report when the
// caller asks for it (`--full`).

import { readFileSync } from 'node:fs';

import { fail, ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import {
  readBatchDiagnosisReport,
  readBatchDiagnosisSummary,
  writeBatchDiagnosisReport,
  type BatchDiagnosisReportRef
} from '../../services/batch/batch-diagnosis-report-store.js';
import { REQUEST_ID_PATTERN } from '../../services/artifacts/request-artifact-service.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

/** The options both actions read. */
export interface BatchReportOptions {
  readonly rid?: string;
  readonly item?: string;
  readonly file?: string;
  readonly full?: boolean;
  readonly project?: string;
  readonly json?: boolean;
}

/** A refusal: the command did not run, and why. */
interface ReportRefusal {
  readonly kind: 'refused';
  readonly code: string;
  readonly message: string;
  readonly data: Record<string, unknown>;
  readonly nextActions: readonly string[];
}

/** Everything the action needs, resolved. */
interface ReportReady {
  readonly kind: 'ready';
  readonly ref: BatchDiagnosisReportRef;
}

/**
 * Resolve the preconditions.
 *
 * The rid names the batch and the item names the report; both become path
 * segments, so both are checked here rather than deeper in the store.
 */
function resolveReport(options: BatchReportOptions): ReportReady | ReportRefusal {
  const projectRoot = options.project ?? process.cwd();
  const rid = options.rid;
  if (typeof rid !== 'string' || rid === '') {
    return {
      kind: 'refused',
      code: 'MISSING_RID',
      message: 'a batch belongs to a request, so --rid is required',
      data: { rid: null, itemId: null },
      nextActions: ['Re-run with --rid <rid> naming the request this batch belongs to.']
    };
  }
  if (!REQUEST_ID_PATTERN.test(rid)) {
    return {
      kind: 'refused',
      code: 'INVALID_RID',
      message: `the request id "${rid}" is not a valid request id`,
      data: { rid, itemId: null },
      nextActions: [
        'A request id is letters, digits, dots, dashes and underscores (see REQUEST_ID_PATTERN).'
      ]
    };
  }
  const item = options.item;
  if (typeof item !== 'string' || item === '') {
    return {
      kind: 'refused',
      code: 'MISSING_ITEM',
      message: 'a report belongs to an item, so --item is required',
      data: { rid, itemId: null },
      nextActions: ['Re-run with --item <id> naming the item this report is about.']
    };
  }
  const sessionId = getCurrentSessionId(projectRoot);
  if (sessionId === null) {
    return {
      kind: 'refused',
      code: 'NO_SESSION',
      message: `no peaks session is bound to ${projectRoot}, so the report cannot be stored`,
      data: { rid, itemId: item },
      nextActions: ['Run `peaks workspace init --project .` first, then re-run this command.']
    };
  }
  return { kind: 'ready', ref: { projectRoot, sessionId, batchId: rid, itemId: item } };
}

/**
 * The report text, or the reason it could not be read.
 */
function readReportFile(
  file: string
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly message: string } {
  try {
    return { ok: true, text: readFileSync(file, 'utf8') };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `cannot read the report file: ${detail}` };
  }
}

/** A refusal from the write action. */
function refuseWrite(input: {
  readonly io: ProgramIO;
  readonly asJson: boolean;
  readonly ref: BatchDiagnosisReportRef;
  readonly code: string;
  readonly message: string;
  readonly nextActions: readonly string[];
}): void {
  const { io, asJson, ref, code, message, nextActions } = input;
  printResult(
    io,
    fail('batch.report.write', code, message, { rid: ref.batchId, itemId: ref.itemId } as never, [
      ...nextActions
    ]),
    asJson
  );
  process.exitCode = 1;
}

/** A refusal from the read action. */
function refuseRead(io: ProgramIO, asJson: boolean, ref: BatchDiagnosisReportRef): void {
  printResult(
    io,
    fail(
      'batch.report.read',
      'NO_REPORT',
      'this item has no diagnosis report yet',
      {
        rid: ref.batchId,
        itemId: ref.itemId
      } as never,
      ['Land it first with `peaks batch report write`.']
    ),
    asJson
  );
  process.exitCode = 1;
}

/**
 * The answer to a landed report: the summary, and the pointer to the rest.
 *
 * The full report is NOT in the answer — that is the whole point of the
 * command: the window keeps the bounded form, and the full text is on
 * disk for the phase that needs it.
 */
function printWrittenReport(
  io: ProgramIO,
  asJson: boolean,
  ref: BatchDiagnosisReportRef,
  report: string
): void {
  printResult(
    io,
    ok(
      'batch.report.write',
      {
        rid: ref.batchId,
        itemId: ref.itemId,
        bytes: Buffer.byteLength(report, 'utf8'),
        summary: readBatchDiagnosisSummary(ref)
      },
      [],
      [
        'The full report is on disk; the summary above is what the window keeps.',
        'Read the full report again with `peaks batch report read --full`.'
      ]
    ),
    asJson
  );
}

/**
 * Land a diagnosis report on disk and answer with its summary.
 *
 * The summary is what the orchestrator keeps; the full report is on disk
 * for the phase that needs the detail.
 */
export function runBatchReportWrite(options: BatchReportOptions, io: ProgramIO): void {
  const asJson = options.json === true;
  const resolved = resolveReport(options);
  if (resolved.kind === 'refused') {
    printResult(
      io,
      fail('batch.report.write', resolved.code, resolved.message, resolved.data as never, [
        ...resolved.nextActions
      ]),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  const file = options.file;
  if (typeof file !== 'string' || file === '') {
    refuseWrite({
      io,
      asJson,
      ref: resolved.ref,
      code: 'MISSING_FILE',
      message: 'the report text is read from a file',
      nextActions: ['Re-run with --file <path> naming the file that holds the report text.']
    });
    return;
  }
  const read = readReportFile(file);
  if (!read.ok) {
    refuseWrite({
      io,
      asJson,
      ref: resolved.ref,
      code: 'UNREADABLE_FILE',
      message: read.message,
      nextActions: ['Point --file at a readable file holding the report text.']
    });
    return;
  }
  const report = read.text;
  writeBatchDiagnosisReport(resolved.ref, report);
  printWrittenReport(io, asJson, resolved.ref, report);
}

/**
 * Read a diagnosis report back — the summary by default, the whole report
 * when the caller asks for it.
 */
export function runBatchReportRead(options: BatchReportOptions, io: ProgramIO): void {
  const asJson = options.json === true;
  const resolved = resolveReport(options);
  if (resolved.kind === 'refused') {
    printResult(
      io,
      fail('batch.report.read', resolved.code, resolved.message, resolved.data as never, [
        ...resolved.nextActions
      ]),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  const report = readBatchDiagnosisReport(resolved.ref);
  if (report === null) {
    refuseRead(io, asJson, resolved.ref);
    return;
  }
  const summary = readBatchDiagnosisSummary(resolved.ref);
  const full = options.full === true;
  printResult(
    io,
    ok(
      'batch.report.read',
      {
        rid: resolved.ref.batchId,
        itemId: resolved.ref.itemId,
        bytes: Buffer.byteLength(report, 'utf8'),
        summary,
        ...(full ? { report } : {})
      },
      [],
      full ? [] : ['The summary is the bounded form; add --full for the whole report.']
    ),
    asJson
  );
}
