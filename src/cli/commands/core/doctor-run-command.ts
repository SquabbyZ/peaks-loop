import type { Command } from 'commander';
import { runDoctor } from '../../../services/doctor/index.js';
import { dropStale, rebuildBindingFromLegacy } from '../../../services/session/binding-store.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { loadSkillRegistry } from '../../../services/skills/skill-registry.js';
import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

import {
  listStaleInstances,
  staleBindingSection,
  STALE_TTL_MS,
  type StaleInstance
} from './doctor-bindings.js';
import { buildDoctorLogsSection, type DoctorLogsSection } from './doctor-logs.js';
import { doctorIsValidSessionId, doctorStatusLineInstalledProbe } from './doctor-probes.js';
import { buildDoctorSummary } from './doctor-summary.js';

export type DoctorOptions = {
  json?: boolean;
  log?: boolean;
  cleanupStale?: boolean;
  staleTtlMs?: string;
  rebuildBinding?: boolean;
  project?: string;
  summary?: boolean;
};

type DoctorReport = Awaited<ReturnType<typeof runDoctor>>;
type RebuildResult = ReturnType<typeof rebuildBindingFromLegacy>;

/** v2.18.2 cycle 2: `--rebuild-binding` and `--cleanup-stale` both mutate the
 * binding, so running them together is ambiguous. Hard-reject the combination
 * so the user gets an actionable error instead of a silent short-circuit. */
function emitConflictingFlags(io: ProgramIO, options: DoctorOptions): void {
  const envelope = fail(
    'doctor.rebuild-binding',
    'CONFLICTING_FLAGS',
    '--rebuild-binding and --cleanup-stale are mutually exclusive',
    { rebuildBinding: true, cleanupStale: true },
    ['Run them in separate `peaks doctor` invocations']
  );
  printResult(io, envelope, options.json === true);
  process.exitCode = 1;
}

/** The `--rebuild-binding` envelope. A rewrite is reported as `fail` when the
 * rebuild was an observable no-op, so the two outcomes stay distinguishable. */
function rebuildEnvelope(result: RebuildResult, data: Record<string, unknown>) {
  if (result.rewritten !== 0) {
    return fail(
      'doctor.rebuild-binding',
      result.noop ? 'BINDING_REBUILD_NOOP' : 'BINDING_REBUILD_OK',
      result.noop
        ? 'No legacy callerId entries to rewrite'
        : `Rewrote ${result.rewritten} legacy callerId entry/entries (preserved ${result.preserved})`,
      data,
      ['Re-run `peaks binding status` to verify the rewritten entries']
    );
  }
  return ok(
    'doctor.rebuild-binding',
    data,
    [],
    result.noop ? ['no legacy callerId entries found — nothing to rewrite'] : []
  );
}

/** `--rebuild-binding`: a single targeted migration, no doctor checks run. */
function runRebuildBinding(io: ProgramIO, options: DoctorOptions, projectRoot: string): void {
  const result = rebuildBindingFromLegacy(projectRoot);
  for (const err of result.errors) {
    io.stderr(`  warning: ${err}`);
  }
  const data = {
    rebuilt: !result.noop,
    rewritten: result.rewritten,
    preserved: result.preserved,
    errors: result.errors,
    projectRoot
  };
  printResult(io, rebuildEnvelope(result, data), options.json === true);
  if (result.errors.length > 0 && result.rewritten === 0) {
    process.exitCode = 1;
  }
}

/** `report.summary.ok` already factors in severity-aware aggregation (warnings
 * do NOT flip `ok`); the stale-binding count escalates independently. */
function buildDoctorResult(
  report: DoctorReport,
  staleInstances: readonly StaleInstance[],
  data: Record<string, unknown>
) {
  if (report.summary.ok && staleInstances.length === 0) return ok('doctor', data);
  return fail(
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
}

/** Human-readable: one line per check, green/red/warn indicators, no JSON. */
function renderChecks(io: ProgramIO, report: DoctorReport): void {
  for (const check of report.checks) {
    if (check.ok) io.stdout(`  +  ${check.message}`);
    else if (check.severity === 'warning') io.stdout(`  !  ${check.message}`);
    else io.stdout(`  ×  ${check.message}`);
  }
}

function renderLogsSection(io: ProgramIO, logs: DoctorLogsSection): void {
  io.stdout('\n  logs:');
  io.stdout(`    logDir:        ${logs.logDir}`);
  io.stdout(`    todayFile:     ${logs.todayFile}`);
  io.stdout(`    sizeBytes:     ${logs.sizeBytes}`);
  io.stdout(`    retentionDays: ${logs.retentionDays}`);
  io.stdout(`    level:         ${logs.level}`);
}

function renderStaleBinding(
  io: ProgramIO,
  staleInstances: readonly StaleInstance[],
  droppedStale: readonly string[]
): void {
  io.stdout('\n  stale-binding (v2.16.0 AC-10):');
  if (staleInstances.length === 0) {
    io.stdout('    + no stale instances');
    return;
  }
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

function renderDoctorFooter(
  io: ProgramIO,
  report: DoctorReport,
  staleInstances: readonly StaleInstance[]
): void {
  const { passed, failed, warnings } = report.summary;
  io.stdout(
    `\n  ${passed} passed, ${failed} failed${warnings > 0 ? `, ${warnings} warning(s)` : ''}`
  );
  if (!report.summary.ok || staleInstances.length > 0) {
    io.stderr(
      `\nDOCTOR_FAILED: ${staleInstances.length > 0 ? 'stale binding present' : `${failed} check(s) failed`}.`
    );
  } else if (warnings > 0) {
    io.stdout(`\n  ${warnings} warning(s) present — exit code 0 (warn-only).`);
  }
}

function renderDoctorHuman(
  io: ProgramIO,
  report: DoctorReport,
  sections: {
    logs: DoctorLogsSection | null;
    staleInstances: readonly StaleInstance[];
    droppedStale: readonly string[];
  }
): void {
  renderChecks(io, report);
  if (sections.logs !== null) renderLogsSection(io, sections.logs);
  renderStaleBinding(io, sections.staleInstances, sections.droppedStale);
  renderDoctorFooter(io, report, sections.staleInstances);
}

async function runDoctorReport(
  io: ProgramIO,
  options: DoctorOptions,
  projectRoot: string
): Promise<void> {
  const report = await runDoctor({
    loadSkills: loadSkillRegistry,
    projectRootResolver: () => findProjectRoot(process.cwd()),
    isValidSessionIdProbe: doctorIsValidSessionId,
    statusLineInstalledProbe: doctorStatusLineInstalledProbe
  });
  const logs = options.log === true ? await buildDoctorLogsSection() : null;
  const ttl = options.staleTtlMs !== undefined ? Number(options.staleTtlMs) : STALE_TTL_MS;
  const staleInstances = listStaleInstances(projectRoot, ttl);
  const droppedStale = options.cleanupStale === true ? dropStale(projectRoot, ttl).dropped : [];
  const staleBinding = staleBindingSection(ttl, staleInstances, droppedStale);
  const fullData = logs === null ? { ...report, staleBinding } : { ...report, logs, staleBinding };
  const data = options.summary === true ? buildDoctorSummary(fullData) : fullData;
  if (options.json === true) {
    printResult(io, buildDoctorResult(report, staleInstances, data), true);
  } else {
    renderDoctorHuman(io, report, { logs, staleInstances, droppedStale });
  }
  if (!report.summary.ok || staleInstances.length > 0) {
    process.exitCode = 1;
  }
}

async function runDoctorCommand(io: ProgramIO, options: DoctorOptions): Promise<void> {
  if (options.rebuildBinding === true && options.cleanupStale === true) {
    emitConflictingFlags(io, options);
    return;
  }
  // v2.18.2 cycle 2: --project override, applies to BOTH the
  // --rebuild-binding short-circuit AND the binding-stale scan.
  const projectRoot =
    options.project !== undefined
      ? options.project
      : (findProjectRoot(process.cwd()) ?? process.cwd());
  if (options.rebuildBinding === true) {
    runRebuildBinding(io, options, projectRoot);
    return;
  }
  await runDoctorReport(io, options, projectRoot);
}

export function registerDoctorCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('doctor')
      .description('Run repository doctor checks')
      .option(
        '--log',
        'include a "logs" section in the doctor output (slice 2026-06-16-cli-logging, AC6)'
      )
      .option(
        '--cleanup-stale',
        'drop stale instance entries from the project-level binding (v2.16.0 AC-10)'
      )
      .option(
        '--stale-ttl-ms <ms>',
        'stale-binding TTL in milliseconds (default 300000 = 5 minutes, v2.16.0 AC-10)'
      )
      // v2.18.2 PATCH scope (follow-up issue #1): rewrite legacy
      // v2.16.0 / v2.17.0 binding files in place so every existing
      // callerId gets the `${envSignal}#${pid}` suffix introduced in
      // v2.18.0. Mutually exclusive with --cleanup-stale to keep the
      // semantics unambiguous (rebuild = structural change,
      // cleanup-stale = TTL-based prune).
      .option(
        '--rebuild-binding',
        'rewrite legacy v2.16.0 / v2.17.0 callerId entries to the v2.18.0+ `#${pid}` format (v2.18.2, follow-up issue #1)'
      )
      // v2.18.2 cycle 2: --project makes the project-root-bound
      // flags (--rebuild-binding, --cleanup-stale, stale-binding
      // scan) addressable for non-current projects. The doctor was
      // hardcoded to findProjectRoot(process.cwd()) which is the
      // wrong default for users inspecting a sibling project.
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option(
        '--summary',
        'JSON envelope only: emit check counts + names-of-first-N (≤ 2 KB) instead of the full checks/stale-binding arrays; the default envelope is unchanged'
      )
  ).action((options: DoctorOptions) => runDoctorCommand(io, options));
}
