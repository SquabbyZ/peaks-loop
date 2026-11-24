/**
 * The `fidelity.json` reader behind the G3a verdict.
 *
 * designlang's exit code is overloaded, so the artifact is the only signal: a
 * finite numeric `overall` is a score, and anything else — a missing file,
 * invalid JSON, a non-object, a null `overall` — is "no evidence". This module
 * only reads; the trust boundary, the spawn and the threshold live in
 * `fidelity.ts`.
 */
import { readFile } from 'node:fs/promises';

export const REPORT_FILE = 'fidelity.json';

/** The fields one run persists; every score field may be absent in the report. */
export type ParsedReport = {
  score: number;
  visual: number | null;
  motion: number | null;
  grade: string | null;
  generatedAt: string | null;
};

export type ReportRead = { ok: true; report: ParsedReport } | { ok: false; detail: string };

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

export async function readFidelityReport(reportPath: string): Promise<ReportRead> {
  let text: string;
  try {
    text = await readFile(reportPath, 'utf8');
  } catch {
    return { ok: false, detail: `${REPORT_FILE} was not written` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, detail: `${REPORT_FILE} is not valid JSON` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, detail: `${REPORT_FILE} is not a JSON object` };
  }
  const report = parsed as Record<string, unknown>;
  const score = numberOrNull(report.overall);
  if (score === null) return { ok: false, detail: `${REPORT_FILE} carries no numeric overall` };
  return {
    ok: true,
    report: {
      score,
      visual: numberOrNull(report.visual),
      motion: numberOrNull(report.motion),
      grade: textOrNull(report.grade),
      generatedAt: textOrNull(report.generatedAt)
    }
  };
}
