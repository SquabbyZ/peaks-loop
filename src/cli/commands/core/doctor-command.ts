import type { Command } from 'commander';
import { runDoctor } from 'peaks-loop-doctor';
import { readBinding, dropStale, rebuildBindingFromLegacy } from '../../../services/session/binding-store.js';
import { findProjectRoot } from '../../../services/config/config-safety.js';
import { loadSkillRegistry } from '../../../services/skills/skill-registry.js';
import { planStatusLineInstall } from '../../../services/skills/statusline-settings-service.js';
import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

// slice-3b Option C: the doctor subpackage owns the check pipeline but
// does NOT import cross-domain utils from the main package (avoids
// circular deps). The CLI is the natural wiring point — every cross-
// domain util the doctor used to import directly is now injected as a
// probe on DoctorOptions at call-site:
//
//   loadSkills           ← loadSkillRegistry (main/services/skills/skill-registry.ts)
//   skillPresenceProbe   ← leave as-is; doctor-command does not own the presence probe
//   statusLineInstalledProbe ← defaults to a `planStatusLineInstall` wrapper below
//   projectRootResolver  ← findProjectRoot (main/services/config/config-safety.ts)
//   isValidSessionIdProbe ← the regex kept in main/services/workspace/sid-naming-guard.ts
//
// Inlining isValidSessionId via the doctor subpackage's default regex
// (which mirrors the upstream file byte-for-byte) keeps the L3 orphan
// check behaviour-identical without dragging sid-naming-guard into a
// workspace package. If sid-naming-guard is ever moved into
// peaks-loop-shared, swap this for a re-import.
function doctorIsValidSessionId(sid: string): boolean {
  return /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])-session-[0-9a-z]{3,6}$/.test(sid);
}

function statusLineAlreadyInstalledForScope(scope: 'project' | 'global', projectRoot?: string): boolean {
  try {
    if (scope === 'project') {
      if (projectRoot === undefined) return false;
      return planStatusLineInstall('project', projectRoot).alreadyInstalled;
    }
    return planStatusLineInstall('global').alreadyInstalled;
  } catch {
    return false;
  }
}

function doctorStatusLineInstalledProbe(): boolean {
  const projectRoot = findProjectRoot(process.cwd());
  // Check both scopes: a user may have installed the statusLine globally, which
  // the project-only check would miss and falsely report as "not installed".
  try {
    if (projectRoot !== null && statusLineAlreadyInstalledForScope('project', projectRoot)) {
      return true;
    }
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* fall through to global */
  }
  try {
    return statusLineAlreadyInstalledForScope('global');
  } catch {
    return false;
  }
}

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
      // v2.18.2 PATCH scope (follow-up issue #1): rewrite legacy
      // v2.16.0 / v2.17.0 binding files in place so every existing
      // callerId gets the `${envSignal}#${pid}` suffix introduced in
      // v2.18.0. Mutually exclusive with --cleanup-stale to keep the
      // semantics unambiguous (rebuild = structural change,
      // cleanup-stale = TTL-based prune).
      .option('--rebuild-binding', 'rewrite legacy v2.16.0 / v2.17.0 callerId entries to the v2.18.0+ `#${pid}` format (v2.18.2, follow-up issue #1)')
      // v2.18.2 cycle 2: --project makes the project-root-bound
      // flags (--rebuild-binding, --cleanup-stale, stale-binding
      // scan) addressable for non-current projects. The doctor was
      // hardcoded to findProjectRoot(process.cwd()) which is the
      // wrong default for users inspecting a sibling project.
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action(async (options: { json?: boolean; log?: boolean; cleanupStale?: boolean; staleTtlMs?: string; rebuildBinding?: boolean; project?: string }) => {
    // v2.18.2 cycle 2 (Q2 arbitration): --rebuild-binding and
    // --cleanup-stale BOTH mutate the binding file. Running them
    // together is ambiguous (rebuild rewrites callerIds; cleanup
    // prunes entries). Hard-reject the combination so the user
    // gets an actionable error instead of a silent short-circuit.
    if (options.rebuildBinding === true && options.cleanupStale === true) {
      const envelope = fail(
        'doctor.rebuild-binding',
        'CONFLICTING_FLAGS',
        '--rebuild-binding and --cleanup-stale are mutually exclusive',
        { rebuildBinding: true, cleanupStale: true },
        ['Run them in separate `peaks doctor` invocations']
      );
      printResult(io, envelope, options.json === true);
      process.exitCode = 1;
      return;
    }

    // v2.18.2 cycle 2: --project override, applies to BOTH the
    // --rebuild-binding short-circuit AND the binding-stale scan.
    const projectRoot = options.project !== undefined
      ? options.project
      : (findProjectRoot(process.cwd()) ?? process.cwd());

    // v2.18.2: short-circuit on --rebuild-binding so the doctor
    // checks don't run when the user is asking for a single targeted
    // migration. The rebuild is observable in its own right
    // (rewritten/preserved counts) and does not benefit from running
    // the full doctor surface first.
    if (options.rebuildBinding === true) {
      const result = rebuildBindingFromLegacy(projectRoot);
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          io.stderr(`  warning: ${err}`);
        }
      }
      const data = {
        rebuilt: !result.noop,
        rewritten: result.rewritten,
        preserved: result.preserved,
        errors: result.errors,
        projectRoot
      };
      const envelope = result.rewritten === 0
        ? ok('doctor.rebuild-binding', data, [], result.noop ? ['no legacy callerId entries found — nothing to rewrite'] : [])
        : fail(
            'doctor.rebuild-binding',
            result.noop ? 'BINDING_REBUILD_NOOP' : 'BINDING_REBUILD_OK',
            result.noop
              ? 'No legacy callerId entries to rewrite'
              : `Rewrote ${result.rewritten} legacy callerId entry/entries (preserved ${result.preserved})`,
            data,
            ['Re-run `peaks binding status` to verify the rewritten entries']
          );
      printResult(io, envelope, options.json === true);
      if (result.errors.length > 0 && result.rewritten === 0) {
        process.exitCode = 1;
      }
      return;
    }

    const report = await runDoctor({
      // slice-3b Option C: wire cross-domain probes at call-site.
      loadSkills: loadSkillRegistry,
      projectRootResolver: () => findProjectRoot(process.cwd()),
      isValidSessionIdProbe: doctorIsValidSessionId,
      statusLineInstalledProbe: doctorStatusLineInstalledProbe
    });
    let logsSection: DoctorLogsSection | null = null;
    if (options.log === true) {
      logsSection = await buildDoctorLogsSection();
    }

    // v2.16.0 AC-10: scan binding for stale instances.
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
