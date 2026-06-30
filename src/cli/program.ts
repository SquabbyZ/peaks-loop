import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { skillsDir } from '../shared/paths.js';
import { CLI_VERSION } from '../shared/version.js';
import { registerCoreAndArtifactCommands } from './commands/core-artifact-commands.js';
import { registerWorkflowCommands } from './commands/workflow-commands.js';
import { registerCapabilityWorkerConfigAndSCCommands } from './commands/capability-worker-config-sc-commands.js';
import { registerCodegraphCommands } from './commands/codegraph-commands.js';
import { registerOpenSpecCommands } from './commands/openspec-commands.js';
import { registerPerfCommands } from './commands/perf-commands.js';
import { registerPreferencesCommands } from './commands/preferences-commands.js';
// Slice #014: peaks progress * CLI surface deleted (replaced by sub-agent
// dispatch + heartbeat, slice #009 + #010). Sub-agent progress is
// surfaced via `peaks sub-agent dispatch|heartbeat|share`.
import { registerProjectCommands } from './commands/project-commands.js';
import { registerPrdCommands } from './commands/prd-commands.js';
import { registerRequestCommands } from './commands/request-commands.js';
import { registerRetrospectiveCommands } from './commands/retrospective-commands.js';
import { registerScanCommands } from './commands/scan-commands.js';
import { registerSliceCommands } from './commands/slice-commands.js';
import { registerSopCommands } from './commands/sop-commands.js';
// v2.15.0 slice 002 AC-3: feedback-promotion CLI (`peaks feedback promote`
// + `peaks feedback check-unpromoted`). See
// `sops/feedback-promotion-sop.md`.
import { registerFeedbackCommands } from './commands/feedback-commands.js';
import { registerForkCommands } from './commands/fork-commands.js';
import { registerImpactCommands } from './commands/impact-commands.js';
import { registerSmokeCommands } from './commands/smoke-commands.js';
import { registerReleaseCommands } from './commands/release-commands.js';
import { registerPrdBlocksCommands } from './commands/prd-blocks-commands.js';
import { registerUserTouchpointCommands } from './commands/user-touchpoint-commands.js';
import { registerSliceReviewCommands } from './commands/slice-review-commands.js';
import { registerQaBusinessReviewCommands } from './commands/qa-business-review-commands.js';
import { registerSliceIntegrateCommands } from './commands/slice-integrate-commands.js';
import { registerDocCommands } from './commands/doc-commands.js';
import { registerLegacyCommands } from './commands/legacy-commands.js';
import { registerRoleCommands } from './commands/role-commands.js';
import { registerComplexityCommands } from './commands/complexity-commands.js';
import { registerSubAgentCommands } from './commands/sub-agent-commands.js';
import { registerSubAgentDispatchGuard } from './commands/sub-agent-dispatch-guard.js';
import { registerGateCommands } from './commands/gate-commands.js';
import { registerHookHandleCommand } from './commands/hook-handle.js';
import { registerHooksCommands } from './commands/hooks-commands.js';
import { registerStatusLineCommands } from './commands/statusline-commands.js';
import { registerUnderstandCommands } from './commands/understand-commands.js';
import { registerWorkspaceCommands } from './commands/workspace-commands.js';
import { registerWorkflowPlanCommands } from './commands/workflow-plan-commands.js';
import { registerAuditCommands } from './commands/audit-commands.js';
import { registerFinalReviewCommands } from './commands/final-review-commands.js';
import { registerClassifyCommands } from './commands/classify-classify-commands.js';
import { registerContextCommands } from './commands/context-commands.js';
import { registerContractCommands } from './commands/contract-commands.js';
import { registerSkillConformanceCommands } from './commands/skill-conformance-commands.js';
import { registerLoopCommands } from './commands/loop-commands.js';
import { registerWorkflowEvalCommands } from './commands/loop-eval-commands.js';
import { registerAgentCommands } from './commands/agent-commands.js';
import { registerUpgradeCommands } from './commands/upgrade-commands.js';
import { registerCodeReviewCommands } from './commands/code-review-commands.js';
import { registerSecurityAuditCommands } from './commands/security-audit-commands.js';
import { registerPerfAuditCommands } from './commands/perf-audit-commands.js';
import { registerVerdictAggregateCommands } from './commands/verdict-aggregate-command.js';
import { registerLogCommands } from './commands/log-commands.js';
import { registerQaCommands } from './commands/qa-commands.js';
import { registerTestCommands } from './commands/test-commands.js';
import { registerPlaywrightCommands } from './commands/playwright-commands.js';
import { registerSoloCommands } from './commands/solo-commands.js';
import { registerMutCommands } from './commands/mut-commands.js';
import { registerFixtureCommands } from './commands/fixture-commands.js';
import { registerReviewerCommands } from './commands/reviewer-commands.js';
import { registerObservabilityCommands } from './commands/observability-commands.js';
import { applyRetention } from '../services/log/retention.js';
import { writeLogEntry, maybeWriteStderr } from '../services/log/logger.js';
import type { ProgramIO } from './cli-helpers.js';

export { printResult, type ProgramIO } from './cli-helpers.js';

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

export function createProgram(io: ProgramIO = { stdout: (text) => console.log(text), stderr: (text) => console.error(text) }): Command { // TODO(g2): legacy console.error without envelope — grace: 1 minor release (v2.14.0)
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

 // Count bundled skills by reading the skills dir directly (synchronous so
 // the quickstart renders instantly — no import/async overhead on startup).
 let skillCount =0;
 const skillsPath = skillsDir;
 try {
 if (existsSync(skillsPath)) {
 skillCount = readdirSync(skillsPath, { withFileTypes: true })
 .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
 .filter((entry) => existsSync(join(skillsPath, entry.name, 'SKILL.md')))
 .length;
 }
 } catch { /* disk read is best-effort; zero skills is still truthful */ } // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)

 io.stdout(`Peaks Loop ${CLI_VERSION} · ${skillCount} skills ready

 Peaks is a loop-engineering CLI + skill family for Claude Code.
 It turns "don't skip steps" into hard enforcement — gates that block
 advancement in-conversation, un-bypassably.

 Before diving into a project, two things worth doing now:

 peaks doctor check your environment in one glance
 peaks-sop <<< ask this skill to author your first SOP

 Or jump straight in:
 peaks sop init --id my-flow --apply && peaks hooks install
`);
 })
 .exitOverride();

 registerCoreAndArtifactCommands(program, io);
 registerWorkflowCommands(program, io);
 registerCapabilityWorkerConfigAndSCCommands(program, io);
 registerCodegraphCommands(program, io);
 registerOpenSpecCommands(program, io);
 registerPerfCommands(program, io);
 registerPreferencesCommands(program);
 registerProjectCommands(program, io);
 registerPrdCommands(program, io);
 registerRequestCommands(program, io);
 registerRetrospectiveCommands(program, io);
 registerScanCommands(program, io);
 registerSliceCommands(program, io);
 registerSopCommands(program, io);
 // v2.15.0 slice 002 AC-3: feedback promotion CLI.
 registerFeedbackCommands(program, io);
 // v2.15.0 follow-up G11: fork sync CLI (status / upstream-check / sync-plan / sync / sync-verify).
 registerForkCommands(program, io);
 // v2.15.0 follow-up G13: impact scan CLI (scan / must-check).
 registerImpactCommands(program, io);
 // v2.15.0 follow-up G14: smoke regression CLI (define / run / run-and-repair / add-path).
 registerSmokeCommands(program, io);
 // v2.15.0 follow-up G15: release / hotfix CLI (plan / canary / promote / watch / done / rollback / hotfix).
 registerReleaseCommands(program, io);
 // v2.15.0 follow-up G3: prd 4 必填块 CLI (check-blocks).
 registerPrdBlocksCommands(program, io);
 // v2.15.0 follow-up G4: user touchpoint CLI (gate-classify / user-touchpoints / commit-boundary-actions).
 registerUserTouchpointCommands(program, io);
 // v2.15.0 follow-up G1: slice business review CLI (review / score / accept / reject).
 registerSliceReviewCommands(program, io);
 // v2.15.0 follow-up G5: QA business review CLI (business-review / score / accept / reject).
 registerQaBusinessReviewCommands(program, io);
 // v2.15.0 follow-up G6: slice cross-integration verifier (slice-integrate).
 registerSliceIntegrateCommands(program, io);
 // v2.15.0 follow-up G7: doc auto-generation (generate-skill / changelog-suggest).
 registerDocCommands(program, io);
 // v2.15.0 follow-up G8: legacy code smell detector (legacy-detect).
 registerLegacyCommands(program, io);
 // v2.15.0 follow-up G9: lightweight role registry (role list/add/grant/check).
 registerRoleCommands(program, io);
 // v2.15.0 follow-up G10: complexity estimator (complexity-estimate).
 registerComplexityCommands(program, io);
 registerSubAgentCommands(program, io);
  registerContractCommands(program, io);
 // Slice #010 G9.5: register the hook-only internal atom. Hidden from
 // `peaks --help` (no description text); used by `peaks hooks install`
 // to wire the PreToolUse hook chain.
 registerSubAgentDispatchGuard(program);
 registerGateCommands(program, io);
 registerHookHandleCommand(program, io);
 registerHooksCommands(program, io);
 registerStatusLineCommands(program, io);
 registerUnderstandCommands(program, io);
 registerWorkspaceCommands(program, io);
 registerWorkflowPlanCommands(program, io);
 // Slice L2.1: peaks audit * — red-line audit framework.
 registerAuditCommands(program, io);
 // Slice 2026-06-25-slice-topology-multipass (Fix M2): peaks prepare-final-review CLI wrapper.
 registerFinalReviewCommands(program, io);
 // Slice #2: peaks classify * — L1a task classification + L1b per-level gate sets.
 registerClassifyCommands(program, io);
 // Slice #3: peaks context * — L1c context 4-layer loader.
 registerContextCommands(program, io);
 // Slice #12: peaks skills:audit-conformance — skill family alignment pass.
 registerSkillConformanceCommands(program, io);
 // Slice #13: peaks swarm * — additional subcommands (pipeline /
 // dispatch / verify / loop) are added inline in workflow-commands.ts
 // alongside the existing swarm.plan. This avoids the duplicate top-level
 // command conflict (peaks-cli-when-adding-a-new-subcommand-check-for-existing-top-level-first).
 // Slice #14: peaks loop * + peaks goal compose — L4 Agent Loop sub-features.
 registerLoopCommands(program, io);
  // Slice v3.0.0 loop-eng-native-solo-a-b: peaks workflow run|plan|lint
  // + peaks loop eval. Wraps the existing workflow + loop groups so the
  // add-a-new-subcommand-check-for-existing-top-level-first rule is honoured.
  registerWorkflowEvalCommands(program, io);
 // Slice: ECC 64 agents soft-optional (per spec §7.2 line 818).
 registerAgentCommands(program, io);
 // Slice: 1.x → 2.0 umbrella (per "one-key completion" + "minimal-user-operation" tenets).
 registerUpgradeCommands(program, io);
 // Slice: ocr soft-optional integration (peaks-rd Gate B3 augmentation).
 registerCodeReviewCommands(program, io);
 // Slice v2.12.0 Group A Tier 2: `peaks security-audit` (independent security audit skill driver).
 registerSecurityAuditCommands(program, io);
 // Slice v2.12.0 Group A Tier 3: `peaks perf-audit` (independent perf audit skill driver).
 registerPerfAuditCommands(program, io);
 // Slice v2.13.2 AC-2: `peaks verdict aggregate` (cross-source verdict aggregator CLI surface).
 registerVerdictAggregateCommands(program, io);
 // Slice 2026-06-16-cli-logging (G4): `peaks log tail` / `peaks log ls`.
 registerLogCommands(program, io);
 // Slice 2026-06-16-playwright-restart-loop (G5 + AC4): `peaks qa run`.
 registerQaCommands(program, io);
 // Slice 2026-06-17-2.5.0-sub-fix-B: `peaks test` (user-invoked, smart
 // fingerprint-cache wrapper around jest/vitest/mocha).
 registerTestCommands(program, io);
 // Slice 2026-06-17-2.5.0-sub-fix-C: `peaks playwright start|ls|stop`
 // (multi-terminal Playwright MCP lifecycle).
 registerPlaywrightCommands(program, io);
 // Slice 2 (peaks-solo fast mode): `peaks solo plan [--fast] <change-id>`
 // v2.11.0 Group F (D5 + D7): also registers `peaks solo should-pause` and
 // `peaks solo post-compact-detect` for runtime-friction probes.
 registerSoloCommands(program, io);
 // Plan 2 / Task 6: `peaks mut run|mutants|asserts|report` — mutation
 // testing + assertion validity scan (spec §4.2 / §7). The
 // production Stryker invoker is wired here; tests use the
 // `createMutCommands({ invokeStryker })` factory directly with a
 // mock to keep @stryker-mutator/core out of the unit-test path.
 registerMutCommands(program, io);

 // Slice v2.14.0 G1 AC-1.4: `peaks fixture capture` — fixture-replay
 // anti-fake-green test suite producer. Sanitizes + checksums the
 // captured envelope and writes a co-located fixture.meta.json.
 registerFixtureCommands(program, io);

 // Slice v2.14.0 G4 AC-4.1: `peaks reviewer run|status` — third-party
 // reviewer CLI. The reviewer modelFamily MUST differ from the
 // karpathy-reviewer modelFamily (AC-4.4); see
 // src/services/reviewer/model-family.ts. The THIRD_PARTY_REVIEW prereq
 // is wired into src/services/artifacts/artifact-prerequisites.ts.
 registerReviewerCommands(program, io);

  // Slice B of v2.11.1: `peaks observability status|slices|fanout|repair-cycles`
  // (read-only queries over the JSONL metrics emitted from the
  // peaks request transition hook in Slice A).
  registerObservabilityCommands(program, io);

 return program;
}
