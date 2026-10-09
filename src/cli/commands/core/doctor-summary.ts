import { boundedNames, fitSummaryToBytes } from '../../../services/context/summary-view.js';

/**
 * the doctor envelope. The `checks` array (one object per check, each with a
 * full message) and the stale-binding instance list collapse to counts +
 * names-of-first-N; the summary counters and log section are scalars and are
 * kept verbatim. ≤ 2 KB by construction.
 */
export function buildDoctorSummary(data: Record<string, unknown>): Record<string, unknown> {
  const checks = Array.isArray(data.checks)
    ? (data.checks as Array<{ id?: unknown; ok?: unknown; severity?: unknown; message?: unknown }>)
    : [];
  const label = (c: { id?: unknown; ok?: unknown; severity?: unknown }): string => {
    const id = typeof c.id === 'string' ? c.id : 'unknown';
    if (c.ok === true) return `ok ${id}`;
    return `${c.severity === 'warning' ? 'warn' : 'FAIL'} ${id}`;
  };
  const failed = checks.filter((c) => c.ok === false);
  const stale =
    typeof data.staleBinding === 'object' && data.staleBinding !== null
      ? (data.staleBinding as Record<string, unknown>)
      : null;
  const view: Record<string, unknown> = {
    view: 'summary',
    summary: data.summary,
    checks: boundedNames(checks.map(label)),
    failed: boundedNames(
      failed.map(
        (c) =>
          `${typeof c.id === 'string' ? c.id : 'unknown'}: ${typeof c.message === 'string' ? c.message : ''}`
      )
    )
  };
  if (stale !== null) {
    view.staleBinding = {
      ttlMs: stale.ttlMs,
      staleCount: stale.staleCount,
      droppedCount: stale.droppedCount,
      droppedSids: boundedNames(
        Array.isArray(stale.droppedSids) ? stale.droppedSids.map((s) => String(s)) : []
      )
    };
  }
  if (data.logs !== undefined) view.logs = data.logs;
  return fitSummaryToBytes(view);
}
