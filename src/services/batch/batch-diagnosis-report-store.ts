// src/services/batch/batch-diagnosis-report-store.ts
//
// The diagnosis report's home on disk, next to the batch record it belongs
// to.
//
// WHY THE REPORT IS A FILE. A batch produces one diagnosis report per
// item, and the orchestrator's window cannot hold all of them — twenty
// reports cost ≈60 KB ≈15K tokens, and a batch produces N at once. So the
// report lands here, under the batch's own directory, and the orchestrator
// keeps only the bounded summary (see `batch-diagnosis-summary.ts`). The
// full report is read back on demand, when a phase needs the detail the
// summary left out.
//
// WHERE IT LIVES. `<sessionDir>/batch/<batchId>/diagnosis/<itemId>.md` —
// beside `progress.json`, one directory per batch, one file per item. The
// record and the reports are the same fact in two forms: the record says
// WHICH items are done, the reports say WHY.
//
// WHY THE WRITE IS ATOMIC. A reader that sees a half-written report reads
// it as a report with no sections, and the summary built from it carries
// no file set — so the topology stage would plan from an empty input
// rather than from a broken one. The write goes to a temp file in the same
// directory and is renamed over the target, the same pattern the progress
// record uses.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isUnsafePathInput } from '../../shared/path-safety.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { parseBatchDiagnosisFinding } from './batch-diagnosis-finding.js';
import { buildBatchDiagnosisSummary } from './batch-diagnosis-summary.js';
import { readBatchProgress } from './batch-progress-store.js';

const BATCH_DIR = 'batch';
const DIAGNOSIS_DIR = 'diagnosis';
const REPORT_EXTENSION = '.md';

/** Which report: the batch, the item, and where the session lives. */
export interface BatchDiagnosisReportRef {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly batchId: string;
  readonly itemId: string;
}

/**
 * A path segment the caller supplied, checked before it is joined.
 *
 * `batchId` and `itemId` both become path segments, so `..`, an absolute
 * path, and a nested `a/b` would each write outside the directory the
 * batch owns. The check is the same one the progress record uses.
 */
function requireSegment(value: string, what: string): string {
  if (isUnsafePathInput(value) || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${what}: ${value} (must be a single safe path segment)`);
  }
  return value;
}

/**
 * The directory one batch's diagnosis reports live in.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param sessionId - The session the batch belongs to.
 * @param batchId - The batch's id.
 */
export function batchDiagnosisReportDir(
  projectRoot: string,
  sessionId: string,
  batchId: string
): string {
  requireSegment(batchId, 'batch id');
  return join(getSessionDir(projectRoot, sessionId), BATCH_DIR, batchId, DIAGNOSIS_DIR);
}

/**
 * The report path for one item of one batch.
 *
 * @param ref - Which report: the project, the session, the batch, the item.
 */
export function batchDiagnosisReportPath(ref: BatchDiagnosisReportRef): string {
  const safeItemId = requireSegment(ref.itemId, 'item id');
  return join(
    batchDiagnosisReportDir(ref.projectRoot, ref.sessionId, ref.batchId),
    `${safeItemId}${REPORT_EXTENSION}`
  );
}

/**
 * The item's human name, from the batch record.
 *
 * The record is where the item's label lives; the report does not repeat
 * it. When the record has no such item — a report written before the
 * record caught up — the id stands in, so the summary still names the
 * item it is about.
 */
function readItemLabel(ref: BatchDiagnosisReportRef): string {
  const progress = readBatchProgress(ref.projectRoot, ref.sessionId, ref.batchId);
  const item = progress?.items.find((entry) => entry.id === ref.itemId);
  return item?.label ?? ref.itemId;
}

/**
 * Write one item's diagnosis report, atomically.
 *
 * The report is stored verbatim: it is the diagnostician's own words, and
 * the summary is derived from it rather than replacing it.
 *
 * @param ref - Which report: the project, the session, the batch, the item.
 * @param report - The report text, verbatim.
 */
export function writeBatchDiagnosisReport(ref: BatchDiagnosisReportRef, report: string): void {
  const path = batchDiagnosisReportPath(ref);
  mkdirSync(dirname(path), { recursive: true });
  // Temp file in the same directory, then rename: a write that fails
  // halfway leaves the previous report intact rather than a truncated one.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, report, 'utf8');
  renameSync(tmp, path);
}

/**
 * Read one item's diagnosis report.
 *
 * @returns The report text, or `null` when the item has no report yet.
 */
export function readBatchDiagnosisReport(ref: BatchDiagnosisReportRef): string | null {
  const path = batchDiagnosisReportPath(ref);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

/**
 * Read one item's diagnosis report AS THE SUMMARY the window may hold.
 *
 * The summary is derived from the stored report every time it is asked
 * for, so the two can never drift apart: there is no second copy of the
 * file set to fall out of date.
 *
 * @returns The summary, or `null` when there is no report, or when the
 *   report carries none of the sections the diagnosis prompt asks for — a
 *   report in another shape is read, not summarised.
 */
export function readBatchDiagnosisSummary(ref: BatchDiagnosisReportRef): string | null {
  const report = readBatchDiagnosisReport(ref);
  if (report === null) return null;
  const finding = parseBatchDiagnosisFinding(report);
  if (finding === null) return null;
  return buildBatchDiagnosisSummary({
    id: ref.itemId,
    label: readItemLabel(ref),
    finding
  });
}
