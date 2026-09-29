/**
 * `peaks mut` — pure helper module extracted from `mut-commands.ts`
 * (file-size cap campaign). Mechanical move only: the stub-report
 * factories and the summary emitter keep their original behavior.
 */
import { type AssertionsReport, type MutationReport } from 'peaks-loop-mut';

/**
 * Pure helper: a stub AssertionsReport used when only Stryker ran.
 * The mutants-only path does NOT touch the AST scanner; we still need
 * a structurally-valid `assertions` block so the Zod schema accepts
 * the assembled report.
 */
export function emptyAssertions(): AssertionsReport {
  return {
    totalAssertions: 0,
    weakAssertions: 0,
    weakRate: 0,
    weakPatterns: []
  };
}

/**
 * Pure helper: a stub MutationReport used when only the assertion
 * scan ran. Mirrors the asserts-only path's invariants (killRate = 0,
 * mutantsTotal = 0, tool = 'stryker' for forward compatibility).
 */
export function emptyMutation(): MutationReport {
  return {
    tool: 'stryker',
    mutantsTotal: 0,
    mutantsKilled: 0,
    mutantsSurvived: 0,
    mutantsTimeout: 0,
    killRate: 0,
    byFile: []
  };
}

/**
 * Emit a one-line JSON envelope describing the run's outcome. Used by
 * both `--json` and the human-readable branches so the `passed` /
 * `sha256` shape stays consistent regardless of TTY mode.
 */
export function emitSummary(
  json: boolean,
  payload: { ok: true; sha256: string; passed: boolean; path: string }
): void {
  if (json) {
    process.stdout.write(JSON.stringify(payload) + '\n');
  } else {
    process.stdout.write(
      `mut-report.json: ${payload.path}\nsha256: ${payload.sha256}\npassed: ${payload.passed}\n`
    );
  }
}
