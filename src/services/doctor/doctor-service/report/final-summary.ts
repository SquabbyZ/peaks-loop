/**
 * Report aggregator: convert the accumulated `DoctorCheck[]` into the
 * public `DoctorReport` shape (checks + summary).
 *
 * The summary is a pure reduction over the checks — it counts the
 * passing and failing rows, derives `ok = failed === 0`, and
 * returns the `{ checks, summary }` tuple. Kept in its own module
 * so the dispatcher (`index.ts`) stays a thin orchestration loop
 * and the aggregation rule has a single test surface.
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
  const failed = checks.filter((check) => !check.ok).length;
  return {
    checks: [...checks],
    summary: {
      ok: failed === 0,
      passed: checks.length - failed,
      failed
    }
  };
}