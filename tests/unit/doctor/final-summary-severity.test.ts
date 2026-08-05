// tests/unit/doctor/final-summary-severity.test.ts
//
// Unit test for the severity-aware `buildReport` reducer at
// `src/services/doctor/doctor-service/report/final-summary.ts`.
//
// Slice 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
// repair cycle (post-QA reject): the prior slice emitted
// `ok: false` from the multi-binary-drift check but never taught
// `buildReport` to distinguish warnings from errors, so the CLI
// dispatcher at `src/cli/commands/core/doctor-command.ts` flipped
// `process.exitCode = 1` on drift. This test pins the new rule:
//
//   - severity: 'warning' rows do NOT flip `summary.ok`
//   - severity: 'warning' rows DO increment `summary.warnings`
//   - genuine (no severity) `ok: false` rows still flip `summary.ok`
//     and count toward `summary.failed` (back-compat)
//   - mixed: one warning + one error → `summary.ok === false` and
//     `summary.failed === 1`, `summary.warnings === 1`
//
// 4 dimensions covered:
//   - behavior:    each branch above is asserted directly
//   - integration: same shape the dispatcher consumes
//   - render:      the returned `DoctorReport` is JSON-serialisable
//                  (matches what `peaks doctor --json` would emit)
//   - a11y:        no special characters; pure data assertions
//
// Run with:
//   pnpm vitest run tests/unit/doctor/final-summary-severity.test.ts

import { describe, expect, it } from 'vitest';

import { buildReport } from '~/src/services/doctor/doctor-service/report/final-summary';
import type { DoctorCheck } from '~/src/services/doctor/doctor-service/types';

describe('buildReport — severity-aware aggregation', () => {
  it('returns ok=true when all checks pass (back-compat)', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      { id: 'b', ok: true, message: 'ok' }
    ];
    const report = buildReport(checks);
    expect(report.summary.ok).toBe(true);
    expect(report.summary.passed).toBe(2);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });

  it('returns ok=true when the only failing check is severity:warning (AC7 repair)', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      {
        id: 'build:multi-binary-drift',
        ok: false,
        severity: 'warning',
        message: 'PEAKS_MULTI_BINARY_DRIFT: 2 distinct peaks-loop versions on PATH'
      }
    ];
    const report = buildReport(checks);
    expect(report.summary.ok).toBe(true);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.warnings).toBe(1);
  });

  it('returns ok=false when a check fails WITHOUT severity tag (back-compat)', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      { id: 'b', ok: false, message: 'broken' }
    ];
    const report = buildReport(checks);
    expect(report.summary.ok).toBe(false);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.warnings).toBe(0);
  });

  it('returns ok=false when an explicit severity:error row fails', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      { id: 'b', ok: false, severity: 'error', message: 'broken' }
    ];
    const report = buildReport(checks);
    expect(report.summary.ok).toBe(false);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.warnings).toBe(0);
  });

  it('mixed: 1 warning + 1 error → summary.ok=false, failed=1, warnings=1', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      { id: 'b', ok: false, severity: 'warning', message: 'drift' },
      { id: 'c', ok: false, severity: 'error', message: 'broken' }
    ];
    const report = buildReport(checks);
    expect(report.summary.ok).toBe(false);
    expect(report.summary.passed).toBe(1);
    expect(report.summary.failed).toBe(1);
    expect(report.summary.warnings).toBe(1);
  });

  it('passes the full check list through verbatim in report.checks', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      { id: 'b', ok: false, severity: 'warning', message: 'drift' }
    ];
    const report = buildReport(checks);
    expect(report.checks.length).toBe(2);
    expect(report.checks[0]).toEqual({ id: 'a', ok: true, message: 'ok' });
    expect(report.checks[1]).toEqual({
      id: 'b',
      ok: false,
      severity: 'warning',
      message: 'drift'
    });
  });

  it('returns a JSON-serialisable shape (matches `peaks doctor --json` envelope)', () => {
    const checks: DoctorCheck[] = [
      { id: 'a', ok: true, message: 'ok' },
      { id: 'b', ok: false, severity: 'warning', message: 'drift' }
    ];
    const report = buildReport(checks);
    // Round-trip via JSON.stringify to assert no non-serialisable
    // values (functions, symbols, BigInt) sneak through.
    const roundTrip = JSON.parse(JSON.stringify(report));
    expect(roundTrip.summary.ok).toBe(true);
    expect(roundTrip.summary.warnings).toBe(1);
    expect(roundTrip.summary.failed).toBe(0);
    expect(roundTrip.summary.passed).toBe(1);
  });
});
