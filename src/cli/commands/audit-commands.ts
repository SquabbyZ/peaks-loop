/**
 * peaks audit * CLI surface — Slice L2.1 + L2.3 P2-a.
 *
 * Registers the `peaks audit` top-level command with the `red-lines` (L2.1),
 * `static` (L2.3 P2-a), `prose-ratio`, `goal` and `artifact` subcommands.
 * Per `peaks-loop-when-adding-a-new-subcommand-check-for-existing-top-level-first.md`
 * we verified that no `peaks audit` top-level exists; this is the only
 * file that owns the registration.
 *
 * The action bodies live in `audit-<responsibility>-runners.ts` siblings; this
 * file only wires the commands and delegates. Each delegate preserves the
 * original callback's declared arity.
 */

import type { Command } from 'commander';
import { addJsonOption, type ProgramIO } from '../cli-helpers.js';
import {
  DEFAULT_LLM_PROVIDER,
  SUPPORTED_ARTIFACT_KINDS,
  SUPPORTED_LLM_PROVIDERS,
  type ArtifactWriteOptions,
  type AuditGoalOptions,
  type ProseRatioOptions,
  type RedLinesOptions,
  type StaticAuditOptions
} from './audit-command-shared.js';
import { RED_LINES_DESCRIPTION, runRedLines } from './audit-red-lines-runners.js';
import {
  PROSE_RATIO_DESCRIPTION,
  STATIC_AUDIT_DESCRIPTION,
  runProseRatio,
  runStaticAuditCommand
} from './audit-static-runners.js';
import { AUDIT_GOAL_DESCRIPTION, runAuditGoal } from './audit-goal-runners.js';
import {
  ARTIFACT_GROUP_DESCRIPTION,
  ARTIFACT_WRITE_DESCRIPTION,
  runArtifactWrite
} from './audit-artifact-runners.js';

export type { AuditGoalData, AuditGoalStatus, StaticAuditData } from './audit-command-shared.js';

const AUDIT_DESCRIPTION =
  'Audit a project for compliance with peaks-loop red lines (P0 / P1 / P2 tiers)';

function registerRedLinesCommand(audit: Command, io: ProgramIO): void {
  addJsonOption(
    audit
      .command('red-lines')
      .description(RED_LINES_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
  ).action((options: RedLinesOptions) => runRedLines(options, io));
}

// Slice K1 (2.8.0): `--record` persists the audit snapshot as a
// project-memory decision at `.peaks/memory/audit-decisions/<slug>.md`.
// `--rid <id>` is an optional disambiguator for multiple audits on
// the same day (slug becomes `audit-decision-<date>-<rid>`).
// Per `peaks-loop-when-adding-a-new-subcommand-check-for-existing-top-level-first`
// and the dev-preference red line "Default-no on new CLI commands",
// we extend the existing command rather than register a new subcommand.
//
// `--enable-agent-shield` / `--disable-agent-shield` flags were removed.
// `runStaticAudit`'s agentShield state is a frozen "always disabled" stub
// (Slice 3 of 4.0.0-beta.11 removed the subprocess), so the flags had no
// effect and the ECC opt-in prose misled users on every run.
function registerStaticCommand(audit: Command, io: ProgramIO): void {
  addJsonOption(
    audit
      .command('static')
      .description(STATIC_AUDIT_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option(
        '--record',
        'persist the audit snapshot to .peaks/memory/audit-decisions/ as a project-memory decision'
      )
      .option(
        '--rid <rid>',
        'disambiguator for the decision record slug (used with --record; pairs multiple audits on the same day)'
      )
  ).action((options: StaticAuditOptions) => runStaticAuditCommand(options, io));
}

// v2.14.0 Slice C Group G3: `peaks audit prose-ratio` — CI gate.
// Calls `peaks audit static --json` internally, parses the prose-only
// ratio, exits 1 if the ratio exceeds the target (default 5%).
// Rationale: a single CLI primitive for the CI gate; the underlying
// ratio lives in static-service.ts (computed via prose-ratio-calculator).
function registerProseRatioCommand(audit: Command, io: ProgramIO): void {
  addJsonOption(
    audit
      .command('prose-ratio')
      .description(PROSE_RATIO_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .option('--target <n>', 'maximum prose-only ratio (0-1, default 0.05)', '0.05')
  ).action((options: ProseRatioOptions) => runProseRatio(options, io));
}

// `anthropic` is now the default and reads the session's own environment
// (see `resolveAnthropicConfig`). `stub` stays for CI/tests but is
// reported as a scaffold, and a missing credential fails loudly — a silent
// fall back to the scaffold envelope would leave the gate exactly as fake
// as it was before this slice.
function registerGoalCommand(audit: Command, io: ProgramIO): void {
  addJsonOption(
    audit
      .command('goal')
      .description(AUDIT_GOAL_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .requiredOption(
        '--need <text>',
        'the human need to audit (becomes input.need for auditGoal())'
      )
      .option(
        '--llm-provider <name>',
        `LLM provider (${SUPPORTED_LLM_PROVIDERS.join(' | ')}); stub performs no audit`,
        DEFAULT_LLM_PROVIDER
      )
  ).action((options: AuditGoalOptions) => runAuditGoal(options, io));
}

function registerArtifactWriteCommand(artifact: Command, io: ProgramIO): void {
  addJsonOption(
    artifact
      .command('write')
      .description(ARTIFACT_WRITE_DESCRIPTION)
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--kind <kind>', `artifact kind (${SUPPORTED_ARTIFACT_KINDS.join(' | ')})`)
      .requiredOption(
        '--input <path>',
        'path to source file (markdown for prompt/narrative; JSON for machine-output and decision)'
      )
      .option('--name <name>', 'display name (H1 in body); defaults to file basename')
      .option(
        '--description <text>',
        'description field for frontmatter; defaults to a generic placeholder'
      )
      .option('--rid <id>', 'optional request id to disambiguate multiple writes on the same day')
      .option('--dry-run', 'render the markdown but do not write to disk', false)
  ).action((options: ArtifactWriteOptions) => runArtifactWrite(options, io));
}

function registerArtifactCommands(audit: Command, io: ProgramIO): void {
  const artifact = audit.command('artifact').description(ARTIFACT_GROUP_DESCRIPTION);
  registerArtifactWriteCommand(artifact, io);
}

export function registerAuditCommands(program: Command, io: ProgramIO): void {
  const audit = program.command('audit', { hidden: true }).description(AUDIT_DESCRIPTION);

  registerRedLinesCommand(audit, io);
  registerStaticCommand(audit, io);
  registerProseRatioCommand(audit, io);
  registerGoalCommand(audit, io);
  registerArtifactCommands(audit, io);
}
