// scripts/lint/silent-warning-report.mjs
//
// How a run is rendered: the stable JSON envelope, or the human text.
//
// Both shapes are here rather than in the driver because the JSON envelope is a
// CONTRACT the gate leg parses (`SW_RULES` in `.husky/peaks-gate-silent-warning.mjs`
// reads `scannedFiles` and `byRule`) while the human text is what a developer reads —
// the two must be changed together or not at all.
//
// Split out of `scripts/lint/silent-warning-detector.mjs` (rid-043). This module is a
// REPORTER the gate runs; the split moved code and changed no detection logic.

/**
 * The two output shapes, over the same violations. Returns nothing: the exit status
 * is the driver's decision, not the renderer's.
 *
 * @param {{
 *   allViolations: Array<{ rule: string, file: string, line: number, column: number, message: string, snippet: string }>,
 *   scannedCount: number,
 *   jsonOut: boolean
 * }} run
 */
export function renderReport({ allViolations, scannedCount, jsonOut }) {
  // Group by rule for the summary table.
  const byRule = new Map();
  for (const v of allViolations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, []);
    byRule.get(v.rule).push(v);
  }

  if (jsonOut) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: allViolations.length === 0,
          scannedFiles: scannedCount,
          violationCount: allViolations.length,
          byRule: Object.fromEntries([...byRule.entries()].map(([k, v]) => [k, v.length])),
          violations: allViolations
        },
        null,
        2
      ) + '\n'
    );
  } else {
    process.stdout.write(`[silent-warning-detector] scanned ${scannedCount} files\n`);
    if (allViolations.length === 0) {
      process.stdout.write(
        `[silent-warning-detector] OK — no silent-warning anti-patterns detected\n`
      );
    } else {
      process.stdout.write(
        `[silent-warning-detector] FAIL — ${allViolations.length} violation(s):\n`
      );
      for (const v of allViolations) {
        process.stdout.write(`  ${v.file}:${v.line}:${v.column}  [${v.rule}]  ${v.message}\n`);
        process.stdout.write(`      | ${v.snippet}\n`);
      }
      const summary = [...byRule.entries()].map(([k, v]) => `${k}=${v.length}`).join(', ');
      process.stdout.write(`[silent-warning-detector] summary: ${summary}\n`);
    }
  }
}
