import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/doctor-service.js';
import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import { fail, ok } from '../../../shared/result.js';

// Slice 021/022: the on-disk home a `peaks session info --active` lookup
// resolved the binding from. `canonical` = .peaks/_runtime/session.json (the
// post-slice-006 home); `legacy` = .peaks/.session.json (read-only back-compat).
// Callers / migration tooling detect pre-migration trees by `source === 'legacy'`.
export type BindingSource = 'canonical' | 'legacy';

export type DoctorLogsSection = {
  logDir: string;
  todayFile: string;
  sizeBytes: number;
  retentionDays: number;
  level: string;
};

// Slice 2026-06-16-cli-logging (AC6) — `peaks doctor --log` section.
//
// `buildDoctorLogsSection` reads the on-disk log dir and returns the
// metadata the doctor needs to render the "logs" block. It is
// extracted from the inline `peaks doctor --log` action so the
// command stays small and the helper is unit-testable without
// spinning up the full program.
async function buildDoctorLogsSection(): Promise<DoctorLogsSection> {
  // Lazy imports to avoid a circular dep at module-load time
  // (core-artifact-commands is imported very early in program.ts).
  const { resolveLogDir, buildLogFileName } = await import('../../../services/log/logger.js');
  const { statSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const logDir = resolveLogDir();
  const todayFile = buildLogFileName(new Date());
  const fullPath = join(logDir, todayFile);
  let sizeBytes = 0;
  if (existsSync(fullPath)) {
    try {
      sizeBytes = statSync(fullPath).size;
    } catch {
      sizeBytes = 0;
    }
  }
  return {
    logDir,
    todayFile,
    sizeBytes,
    retentionDays: 7,
    level: process.env.PEAKS_LOG_LEVEL ?? 'info'
  };
}

// Slice 2026-06-16-cli-logging (AC6): `peaks doctor --log` adds a
// "logs" section to the doctor output (logDir, today's file name,
// size, retention policy, level). Useful for the user when they
// want to attach a quick log snapshot to a bug report without
// running `peaks log tail` first. The flag is opt-in so the
// existing doctor output is preserved (P4).
export function registerDoctorCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('doctor')
      .description('Run repository doctor checks')
      .option('--log', 'include a "logs" section in the doctor output (slice 2026-06-16-cli-logging, AC6)')
  ).action(async (options: { json?: boolean; log?: boolean }) => {
    const report = await runDoctor();
    let logsSection: DoctorLogsSection | null = null;
    if (options.log === true) {
      logsSection = await buildDoctorLogsSection();
    }
    const data = logsSection === null
      ? report
      : { ...report, logs: logsSection };
    const result = report.summary.ok
      ? ok('doctor', data)
      : fail('doctor', 'DOCTOR_FAILED', 'One or more doctor checks failed', data, ['Fix failed checks and rerun peaks doctor']);
    if (options.json === true) {
      printResult(io, result, true);
    } else {
      // Human-readable: one line per check, green/red indicators, no JSON.
      for (const check of report.checks) {
        const icon = check.ok ? '+' : '×';
        io.stdout(`  ${icon}  ${check.message}`);
      }
      if (logsSection !== null) {
        io.stdout('\n  logs:');
        io.stdout(`    logDir:        ${logsSection.logDir}`);
        io.stdout(`    todayFile:     ${logsSection.todayFile}`);
        io.stdout(`    sizeBytes:     ${logsSection.sizeBytes}`);
        io.stdout(`    retentionDays: ${logsSection.retentionDays}`);
        io.stdout(`    level:         ${logsSection.level}`);
      }
      io.stdout(`\n  ${report.summary.passed} passed, ${report.summary.failed} failed`);
      if (!report.summary.ok) {
        io.stderr(`\nDOCTOR_FAILED: ${report.summary.failed} check(s) failed. Fix them and rerun peaks doctor.`);
      }
    }
    if (!report.summary.ok) {
      process.exitCode = 1;
    }
  });
}
