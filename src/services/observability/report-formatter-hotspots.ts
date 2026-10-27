/**
 * `src/services/observability/report-formatter-hotspots.ts`
 *
 * The hotspot section of the markdown report.
 *
 * WHY IT IS ITS OWN MODULE. `report-formatter.ts` was already near its
 * 300-line cap, and the hotspot table does not fit beside the rest. The
 * split follows the precedent in this directory: `aggregation.ts` keeps its
 * readers in `aggregation-helpers.ts` for the same reason.
 *
 * WHY THE TABLES ARE SPLIT BY WHAT THE COUNT COUNTS. A hotspot row's count
 * means DIFFERENT THINGS depending on how the row was known: an `exact` row
 * counted the artifact being MISSING, and a reconstructed row counted the
 * artifact being one of the CANDIDATES — one real failure contributes to
 * every candidate the attribution could not narrow, so the number is candidate
 * mentions, not failures. A single column cannot carry both meanings, so a
 * reader of one column heading would have to know the rule to read the
 * number under it.
 *
 * So there is ONE TABLE PER MEANING, and each column heading names what it
 * counts: "times observed missing" and "candidate mentions". The confidence
 * column stays as it is, so a reader can still see WHICH tier a row came
 * from — the split makes the meaning visible without taking that away.
 *
 * WHY THE NOTE IS NOT THE WHOLE MECHANISM. The note says what the two
 * meanings are; the column headings say which one a reader is looking at. A
 * reader who skips the note still cannot take a candidate mention for a
 * missing artifact.
 */

import type { HotspotRow } from './hotspot-shared.js';

/** The markdown for the hotspot section, including its heading. */
export function markdownHotspotTables(hotspots: readonly HotspotRow[]): string {
  const lines: string[] = [];
  lines.push('## Hotspots');
  lines.push('');
  if (hotspots.length === 0) {
    lines.push('_No hotspot recorded for this period._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(
    '_`exact` rows are MEASURED — the artifact was seen missing. `inferred`/`ambiguous` ' +
      'rows are CANDIDATES recovered from a historical count: one real failure counts toward ' +
      'EVERY candidate it could not narrow, so those counts are candidate mentions, not ' +
      'failures._'
  );
  lines.push('');
  const measured = hotspots.filter((row) => row.countMeaning === 'observed-missing');
  const candidates = hotspots.filter((row) => row.countMeaning === 'candidate-mentions');
  table(lines, measured, 'Measured missing artifacts', 'times observed missing');
  table(lines, candidates, 'Candidate artifacts', 'candidate mentions');
  return lines.join('\n');
}

/** One table of rows, under a heading that names what its count counts. */
function table(
  lines: string[],
  rows: readonly HotspotRow[],
  heading: string,
  column: string
): void {
  lines.push(`### ${heading}`);
  lines.push('');
  if (rows.length === 0) {
    lines.push('_None._');
    lines.push('');
    return;
  }
  lines.push(`| artifact | owner skill | mode | confidence | ${column} |`);
  lines.push('|---|---|---|---|---|');
  for (const row of rows) {
    lines.push(
      `| ${row.artifact} | ${row.ownerSkill ?? '—'} | ${row.kind} | ${row.confidence} | ${row.count} |`
    );
  }
  lines.push('');
}
