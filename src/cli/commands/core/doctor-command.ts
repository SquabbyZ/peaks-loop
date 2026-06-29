import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/doctor-service.js';
import { readBinding, dropStale } from '../../../services/session/binding-store.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
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

// Slice v2.16.0 AC-10: stale binding TTL is 5 minutes by default. The
// threshold is exposed as a CLI flag so users can tune it for
// long-running sessions.
const STALE_TTL_MS = 5 * 60 * 1000;

// Slice v2.16.0 AC-10: identify stale instances (lastHeartbeat > 5min)
// in the project-level binding. Used by `peaks doctor` and surfaced as
// a warning in the report. Returns the stale entry descriptors.
function listStaleInstances(projectRoot: string, ttlMs: number = STALE_TTL_MS): Array<{ sid: string; callerId: string; lastHeartbeat: string }> {
  const binding = readBinding(projectRoot);
  if (!binding) return [];
  const cutoff = Date.now() - ttlMs;
  const stale: Array<{ sid: string; callerId: string; lastHeartbeat: string }> = [];
  for (const [sid, inst] of Object.entries(binding.instances)) {
    const t = Date.parse(inst.lastHeartbeat);
    if (Number.isFinite(t) && t < cutoff) {
      stale.push({ sid, callerId: inst.callerId, lastHeartbeat: inst.lastHeartbeat });
    }
  }
  return stale;
}

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
      .option('--cleanup-stale', 'drop stale instance entries from the project-level binding (v2.16.0 AC-10)')
      .option('--stale-ttl-ms <ms>', 'stale-binding TTL in milliseconds (default 300000 = 5 minutes, v2.16.0 AC-10)')
  ).action(async (options: { json?: boolean; log?: boolean; cleanupStale?: boolean; staleTtlMs?: string }) => {
    const report = await runDoctor();
    let logsSection: DoctorLogsSection | null = null;
    if (options.log === true) {
      logsSection = await buildDoctorLogsSection();
    }

    // v2.16.0 AC-10: scan binding for stale instances.
    const projectRoot = findProjectRoot(process.cwd()) ?? process.cwd();
    const ttl = options.staleTtlMs !== undefined ? Number(options.staleTtlMs) : STALE_TTL_MS;
    const staleInstances = listStaleInstances(projectRoot, ttl);
    let droppedStale: string[] = [];
    if (options.cleanupStale === true) {
      const { dropped } = dropStale(projectRoot, ttl);
      droppedStale = dropped;
    }
    const staleBindingSection = {
      ttlMs: ttl,
      staleCount: staleInstances.length,
      staleInstances,
      droppedCount: droppedStale.length,
      droppedSids: droppedStale
    };

    const data = logsSection === null
      ? { ...report, staleBinding: staleBindingSection }
      : { ...report, logs: logsSection, staleBinding: staleBindingSection };
    const result = report.summary.ok && staleInstances.length === 0
      ? ok('doctor', data)
      : fail(
          'doctor',
          'DOCTOR_FAILED',
          staleInstances.length > 0
            ? `Found ${staleInstances.length} stale binding instance(s); rerun with --cleanup-stale to drop them`
            : 'One or more doctor checks failed',
          data,
          staleInstances.length > 0
            ? ['Run `peaks doctor --cleanup-stale` to drop stale entries']
            : ['Fix failed checks and rerun peaks doctor']
        );
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
      io.stdout('\n  stale-binding (v2.16.0 AC-10):');
      if (staleInstances.length === 0) {
        io.stdout('    + no stale instances');
      } else {
        io.stdout(`    × ${staleInstances.length} stale instance(s):`);
        for (const s of staleInstances) {
          io.stdout(`      - sid=${s.sid} caller=${s.callerId} lastSeen=${s.lastHeartbeat}`);
        }
        if (droppedStale.length > 0) {
          io.stdout(`    cleaned up: ${droppedStale.length}`);
        } else {
          io.stdout('    rerun with --cleanup-stale to drop them');
        }
      }
      io.stdout(`\n  ${report.summary.passed} passed, ${report.summary.failed} failed`);
      if (!report.summary.ok || staleInstances.length > 0) {
        io.stderr(`\nDOCTOR_FAILED: ${staleInstances.length > 0 ? 'stale binding present' : `${report.summary.failed} check(s) failed`}.`);
      }
    }
    if (!report.summary.ok || staleInstances.length > 0) {
      process.exitCode = 1;
    }
  });
}
