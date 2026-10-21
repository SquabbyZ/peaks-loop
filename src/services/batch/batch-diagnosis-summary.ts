// src/services/batch/batch-diagnosis-summary.ts
//
// The bounded summary of one diagnosis report — the only form of that
// report the orchestrator's window may hold.
//
// WHY THE FULL REPORT MUST NOT ENTER THE WINDOW. Measured in this
// repository: twenty sub-agent reports cost ≈60 KB ≈15K tokens of the
// orchestrator's window. A batch produces N diagnosis reports at once, so
// the batch lane's window is hit by N reports arriving together —
// exactly the moment the orchestrator has to decide what to do next. So
// the report lands on disk (see `batch-diagnosis-report-store.ts`) and the
// window keeps only this summary: the conclusion, the file set, and a
// one-line sketch.
//
// WHY THE FILE SET IS MANDATORY IN THE SUMMARY. The topology stage plans
// the parallel waves from the MEASURED file sets and from nothing else
// (`planBatchTopology`). A summary without the file set would force the
// orchestrator to re-read N full reports to recover the one input it
// needs — which is the cost this module exists to remove. So the file set
// is the part of the summary that is never dropped.
//
// THE BUDGET IS SPENT IN A FIXED ORDER. The file set first, because it is
// the input the topology stage needs; the conclusion next; the sketch
// last, because it is the one the orchestrator can re-read from the full
// report if it must. What does not fit is cut — and what was cut is said
// out loud, because a summary that silently drops half a file set is
// worse than one that says it is partial.

import { collapse, type BatchDiagnosisFinding } from './batch-diagnosis-finding.js';
import { normalizeFileSet } from './batch-progress-store.js';

/**
 * The hard ceiling on the summary that may enter the orchestrator's
 * window. The same 2 KB the report cap sets for a sub-agent's own final
 * report: the orchestrator reads N of these, so the cap has to hold per
 * report and the N has to be small.
 */
export const BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES = 2048;

/**
 * The ceiling on the conclusion inside the summary.
 *
 * The conclusion is "a sentence or two" by the diagnosis prompt's own
 * wording; the cap keeps a chatty conclusion from eating the budget the
 * file set needs.
 */
const CONCLUSION_MAX_BYTES = 512;

/** The number of lines the summary renders, and so the newlines it costs. */
const SUMMARY_LINES = 4;

/** The top bits of a UTF-8 byte: set on every byte of a multi-byte character. */
const UTF8_LEAD_BITS = 0xc0;

/** The bit pattern of a UTF-8 continuation byte. */
const UTF8_CONTINUATION_BIT = 0x80;

/** The summary's input: which item it is about, and what was found. */
export interface BatchDiagnosisSummaryInput {
  readonly id: string;
  readonly label: string;
  readonly finding: BatchDiagnosisFinding;
}

/** The byte length of a string. The cap is a byte cap, not a character cap. */
function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Cut a string to a byte budget without splitting a character.
 *
 * A cut that lands inside a multi-byte character produces a replacement
 * character in the summary, which is a fact nobody asked for.
 */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return text;
  const ellipsis = '…';
  const room = maxBytes - bytes(ellipsis);
  if (room <= 0) return '';
  let end = room;
  while (end > 0 && ((buffer[end] ?? 0) & UTF8_LEAD_BITS) === UTF8_CONTINUATION_BIT) end -= 1;
  return `${buffer.subarray(0, end).toString('utf8')}${ellipsis}`;
}

/**
 * Fit as many paths as the budget allows, and say how many were left out.
 *
 * The file set is mandatory, so it is the last thing to be cut — but a
 * file set of a hundred paths does not fit in 2 KB, and a summary that
 * silently drops half of it is worse than one that says so. The full set
 * stays authoritative on disk.
 */
function fitFiles(files: readonly string[], budget: number): string {
  const kept: string[] = [];
  for (const file of files) {
    if (bytes([...kept, file].join(', ')) > budget) break;
    kept.push(file);
  }
  const omitted = files.length - kept.length;
  if (omitted === 0) return kept.join(', ');
  const marker = ` …(+${omitted})`;
  while (kept.length > 0 && bytes(kept.join(', ')) + bytes(marker) > budget) kept.pop();
  const room = budget - bytes(kept.join(', '));
  if (room <= 0) return kept.join(', ');
  return `${kept.join(', ')}${truncateToBytes(marker, room)}`;
}

/**
 * Render the summary the orchestrator's window may hold.
 *
 * The shape is three lines under one heading: the conclusion, the file
 * set, and the sketch.
 *
 * @param input - Which item the summary is about, and what was found.
 * @returns A summary of at most {@link BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES} bytes.
 */
export function buildBatchDiagnosisSummary(input: BatchDiagnosisSummaryInput): string {
  const header = `## ${input.id} · ${input.label}`;
  const files = normalizeFileSet(input.finding.files);
  const conclusion = collapse(input.finding.rootCause);
  const sketch = collapse(input.finding.sketch);

  const overhead =
    bytes(header) + bytes('结论：') + bytes('文件集：') + bytes('草图：') + SUMMARY_LINES;
  let budget = BATCH_DIAGNOSIS_SUMMARY_MAX_BYTES - overhead;

  let fileText = files.join(', ');
  if (bytes(fileText) > budget) {
    fileText = fitFiles(files, budget);
  }
  budget -= bytes(fileText);

  const conclusionText =
    bytes(conclusion) > budget
      ? truncateToBytes(conclusion, Math.min(budget, CONCLUSION_MAX_BYTES))
      : conclusion;
  budget -= bytes(conclusionText);

  const sketchText = bytes(sketch) > budget ? truncateToBytes(sketch, budget) : sketch;

  return `${header}\n结论：${conclusionText}\n文件集：${fileText}\n草图：${sketchText}\n`;
}
