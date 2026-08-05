/**
 * Report aggregator: convert the accumulated `DoctorCheck[]` into the
 * public `DoctorReport` shape (checks + summary).
 *
 * The summary is a pure reduction over the checks — it separates
 * `error`-severity findings from `warning`-severity findings, derives
 * `ok = errors === 0`, and returns the `{ checks, summary }` tuple.
 * Kept in its own module so the dispatcher (`index.ts`) stays a thin
 * orchestration loop and the aggregation rule has a single test surface.
 *
 * Severity-aware aggregation (slice
 * 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
 * repair cycle): a check with `severity: 'warning'` reports `ok: false`
 * (so operators see the finding in the JSON envelope) but does NOT
 * flip `summary.ok` and therefore does NOT flip the doctor exit code.
 * Genuine failures (severity omitted, or `severity: 'error'`) behave
 * the same as the pre-slice `failed === 0` rule.
 */

import type { DoctorCheck, DoctorReport } from '../types.js';

/**
 * Build the final report from the accumulated checks.
 *
 * Pure function — no I/O, no clock dependency. The dispatcher
 * passes the checks it accumulated across the registry run; this
 * function computes the summary in O(n) and returns the immutable
 * report shape the public API exposes.
 */
export function buildReport(checks: readonly DoctorCheck[]): DoctorReport {
  const errors = checks.filter((check) => !check.ok && check.severity !== 'warning').length;
  const warnings = checks.filter((check) => !check.ok && check.severity === 'warning').length;
  return {
    checks: [...checks],
    summary: {
      ok: errors === 0,
      passed: checks.length - errors - warnings,
      failed: errors,
      warnings
    }
  };
}