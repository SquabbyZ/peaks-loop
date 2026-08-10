import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { skillsDir, repoRoot } from 'peaks-loop-shared/paths';

import { CLI_VERSION } from 'peaks-loop-shared/version';

import { autoRegisterAllCommands } from './commands/_register.js';
import { registerSuperCommands } from './commands/_super.js';
import { registerCoreAndArtifactCommands } from './commands/core-artifact-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './commands/capability-worker-config-sc-commands.js';
import { registerSubAgentCommands } from './commands/sub-agent-commands.js';
import { registerLeaseMetricsCommand } from './commands/lease-metrics-commands.js';
import { registerLeaseStatsCommand } from './commands/lease-stats-commands.js';
import { registerContainerCommand } from './commands/container-commands.js';
import { registerVmCommand } from './commands/vm-commands.js';
import { registerCronCommand } from './commands/cron-commands.js';
import { registerCronSchedulerCommand } from './commands/cron-scheduler-commands.js';
import { registerWorkspaceCommands } from './commands/workspace-commands.js';
import { registerSopCommands } from './commands/sop-commands.js';
import { registerSkillVisibilityCommand } from './commands/skill-visibility.js';
import { registerPrimerCommand } from './commands/primer-command.js';
import { applyRetention, cleanupEccCache } from '../services/log/retention.js';
import { writeLogEntry, maybeWriteStderr } from '../services/log/logger.js';
import { printErrorEnvelope, printSuperCommandCatalog, type ProgramIO } from './cli-helpers.js';

export { printErrorEnvelope, printResult, type ProgramIO } from './cli-helpers.js';

// Slice rid-001 (P0-1 envelope closure, fix #4): the prior default
// `ProgramIO` funneled Commander's `configureOutput().writeErr` callback
// through raw `console.error`, which bypassed the canonical envelope
// path and left a `// TODO(g2): legacy console.error without envelope`
// grace comment. Default io now routes stdout through `process.stdout`
// and stderr through `process.stderr` (matching the `defaultIo` built
// in `src/cli/index.ts`). When a caller passes its own `ProgramIO`
// (vitest, programmatic dispatch) the closure-side `printErrorEnvelope`
// helper in `src/cli/cli-helpers.ts` mints a real `fail()` envelope,
// so the canonical shape is preserved end-to-end.
function defaultStderrSink(text: string): void {
  process.stderr.write(`${text}\n`);
}
function defaultStdoutSink(text: string): void {
  process.stdout.write(`${text}\n`);
}

/**
 * Slice 2026-06-16-cli-logging (G1, G2, G3, G7). One structured
 * `peaks-loop start` entry per CLI invocation, plus a 7-day
 * retention sweep. Wired into the global program so EVERY
 * peaks-loop command — even a bare `peaks` quickstart — writes
 * a log line.
 *
 * The logger NEVER writes to stdout; it touches only the log
 * file (always) and stderr (when `verbose` is true or
 * `PEAKS_LOG_LEVEL=debug`). JSON envelopes stay parseable.
 */
function bootstrapLogger(verbose: boolean): void {
  try {
    applyRetention({ retentionDays: 7 });
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* best-effort retention sweep; never block the CLI */
  }
  // Slice 3 (on-demand-ecc): 7-day TTL sweep over ecc-<sha>/ cache dirs.
  try {
    cleanupEccCache({ retentionDays: 7, nowMs: Date.now() });
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* best-effort ECC retention sweep; never block the CLI */
  }
  const dateOverride = process.env.PEAKS_LOG_DATE_OVERRIDE;
  const entry = {
    ts: new Date().toISOString(),
    level: 'info' as const,
    command: 'main',
    msg: 'peaks-loop start',
    version: CLI_VERSION
  };
  try {
    writeLogEntry(entry, dateOverride !== undefined ? { dateOverride } : {});
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* best-effort */
  }
  if (verbose || process.env.PEAKS_LOG_LEVEL === 'debug') {
    maybeWriteStderr(entry, { verbose: true });
  }
}

// Slice 2026-06-16-cli-logging (AC1 regression fix, repair cycle 1):
// Process-scoped guard so the bootstrap log line is written AT MOST
// once per process, regardless of whether it fires from the
// `preAction` hook (subcommand path) or from the version action
// (`-v` / `--version` / `-V` path). Reset between test invocations
// via `__resetBootstrapForTests`.
let bootstrapRan = false;
export function __resetBootstrapForTests(): void {
  bootstrapRan = false;
}

export function createProgram(io: ProgramIO = { stdout: defaultStdoutSink, stderr: defaultStderrSink }): Command {
 const program = new Command();
 program
 .name('peaks')
 .description(`Peaks Loop ${CLI_VERSION} — loop engineering CLI: workflow primitive / loop guards / evaluators / slice orchestration

Run peaks (no arguments) for a quickstart. You likely want one of:
 peaks doctor check your environment
 peaks skill list or manage skills
 peaks slice boundary check (tsc + vitest +3-way + verify-pipeline)
 peaks workflow plan workflow routing dry-run graphs
 peaks sop author your own workflow gates
 peaks hooks install the un-bypassable gate-enforcement hook
 peaks gate enforce/bypass SOP gates on Bash commands`)
 .configureOutput({
 writeOut: (text) => io.stdout(text.trimEnd()),
 writeErr: (text) => io.stderr(text.trimEnd())
 })
 // Slice 2026-06-16-cli-logging (AC1 regression fix, repair cycle 1):
 // We DO NOT use Commander's built-in `.version()` here. Commander's
 // built-in version handler short-circuits the program BEFORE the
 // `preAction` hook fires, which means a bare `peaks --version`
 // invocation skips the JSONL bootstrap. Per PRD AC1 the log file
 // MUST be created on every CLI invocation, including `--version`.
 //
 // Instead we register `-V` and `-v, --version` as regular options
 // and handle them in the program-level action: run the log
 // bootstrap, print the version, and exit. The `preAction` hook
 // below still fires for subcommands; we deduplicate via a
 // `bootstrapRan` guard so the start line is written at most once
 // per process.
 .option('-v, --version', 'output the version number')
 .option('-V', 'output the version number')
 // Slice 2026-06-16-cli-logging (G3): global verbose flag. Mirrors
 // the PEAKS_LOG_LEVEL=debug env var; with this set, the logger
 // mirrors every entry to stderr IN ADDITION to the file.
 // Long-only: `-v` is already bound to `--version` by the
 // `.option()` call above, so we accept the env-var form
 // (PEAKS_LOG_LEVEL=debug) as the short-form equivalent.
 .option('--verbose', 'mirror log lines to stderr (also: PEAKS_LOG_LEVEL=debug)')
 .hook('preAction', () => {
   const opts = program.opts<{ verbose?: boolean }>();
   // Slice 2026-06-16-cli-logging (repair cycle 2): gate the bootstrap on
   // the same `bootstrapRan` guard the version action uses, so a single
   // process that invokes the program twice (vitest, programmatic) does
   // not emit duplicate `peaks-loop start` JSONL entries.
   if (!bootstrapRan) {
     bootstrapLogger(opts.verbose === true);
     bootstrapRan = true;
   }
 })
 .action(() => {
 // D-013 wrapper exit-code fix: when the user typed a command token but
 // it didn't match any registered subcommand, exit non-zero with a JSON
 // `COMMAND_NOT_FOUND` envelope. Without this check, Commander's root
 // `.action()` runs whenever no subcommand matches (including unknown
 // commands) and prints the help banner with exit 0 — which violates
 // the PRD AC3.9/AC3.10 contract for `peaks agent run/list` and any
 // other deleted/hidden command.
 //
 // Detection: use `program.args` (Commander's parsed argv) for the
 // first non-option token. If it's present and Commander didn't route
 // to a subcommand (we got here, so it didn't), the user typed an
 // unknown command. Exit 1. `program.args` works correctly under both
 // `parseAsync(['node', 'peaks', ...])` (real CLI) and direct in-process
 // calls (vitest integration tests), unlike `process.argv` which is
 // the test runner's argv.
 //
 // --help and --version bypass this path entirely (handled below).
 const firstNonOption = program.args.find((arg) => !arg.startsWith('-'));
 if (firstNonOption !== undefined) {
   // Commander reached this `.action()` despite a positional token,
   // which means the token was NOT routed to any subcommand. This is
   // the unknown-command path. Emit a JSON envelope + exit 1.
   io.stdout(JSON.stringify({
     ok: false,
     command: 'cli',
     code: 'COMMAND_NOT_FOUND',
     message: `Unknown command: ${firstNonOption}. Run \`peaks --help\` for available commands.`,
     data: { argv: firstNonOption },
     warnings: [],
     nextActions: ['Run `peaks --help` to list available commands.']
   }, null, 2));
   process.exitCode = 1;
   return;
 }

 const opts = program.opts<{ V?: boolean; version?: boolean; verbose?: boolean }>();
 if (opts.V || opts.version) {
 // AC1: write the peaks-loop start log line BEFORE printing the
 // version, so even a bare `--version` invocation creates the log
 // file. `bootstrapRan` dedupes when `preAction` already ran.
 if (!bootstrapRan) {
 bootstrapLogger(opts.verbose === true);
 bootstrapRan = true;
 }
 io.stdout(CLI_VERSION);
 return;
 }

 printSuperCommandCatalog(io);

 })
 .exitOverride();

 registerCoreAndArtifactCommands(program, io);
 registerWorkflowCommands(program, io);
 registerCapabilityWorkerConfigAndSCCommands(program, io);
 registerSubAgentCommands(program, io);
 registerWorkspaceCommands(program, io);
 registerSopCommands(program, io);
 registerSuperCommands(program, io);
 registerLeaseMetricsCommand(program, io);
 registerLeaseStatsCommand(program, io);
 registerContainerCommand(program, io);
 registerVmCommand(program, io);
 registerCronCommand(program, io);
 registerCronSchedulerCommand(program, io);
 // Auto-route the remaining 60+ commands after the orchestrators so the
 // lazy `skill` parent (used by adapter-commands / sediment-commands)
 // finds the existing `peaks skill` group registered by
 // registerCoreAndArtifactCommands instead of being created twice.
 autoRegisterAllCommands(program, io);
 registerSkillVisibilityCommand(program, repoRoot);
 // Slice rid-statusline-stale-ux AC-2: register `peaks session primer`
 // so it appears in `peaks session --help` for LLM `<TAB>`-discovery.
 // Mounted as a CHILD of the existing `session` commander group
 // (verified at src/cli/commands/core/session-command.ts:32). NOT
 // `program.command('session primer')` (that registers a single
 // literal command name, not a child of the session group).
 registerPrimerCommand(program, io);

 return program;
}
