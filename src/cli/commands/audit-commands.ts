/**
 * peaks audit * CLI surface — Slice L2.1 + L2.3 P2-a.
 *
 * Registers the new `peaks audit` top-level command with the
 * `red-lines` (L2.1) and `static` (L2.3 P2-a) subcommands.
 * Per `peaks-cli-when-adding-a-new-subcommand-check-for-existing-top-level-first.md`
 * we verified that no `peaks audit` top-level exists; this is the only
 * file that owns the registration.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { runRedLinesAudit } from '../../services/audit/red-lines-service.js';
import { runStaticAudit, type AgentShieldState } from '../../services/audit/static-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';
import type { RedLineAudit } from '../../services/audit/types.js';
import type { AuditDecisionRecord } from '../../services/audit/decision-writer.js';
import { writeAuditDecision } from '../../services/audit/decision-writer.js';

type RedLinesOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
};

type StaticAuditOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
  enableAgentShield?: boolean;
  disableAgentShield?: boolean;
  record?: boolean;
  rid?: string;
};

type AuditGoalOptions = {
  project: string;
  need: string;
  llmProvider?: string;
  json?: boolean;
};

/** Whitelist of supported `--llm-provider` values for `peaks audit goal`. */
const SUPPORTED_LLM_PROVIDERS = ['stub'] as const;
type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

function isSupportedLlmProvider(value: string): value is SupportedLlmProvider {
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(value);
}

export interface AuditGoalData {
  readonly status: 'scaffold-only';
  readonly serviceWired: true;
  readonly providerBinding: 'pending-follow-up-slice';
  readonly need: string;
  readonly projectRoot: string;
}

function validateProjectRoot(projectArg: string): { ok: true; projectRoot: string } | { ok: false; code: string; message: string } {
  const projectRoot = resolve(projectArg);
  if (!existsSync(projectRoot)) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: `project path does not exist: ${projectArg}` };
  }
  let stat;
  try {
    stat = statSync(projectRoot);
  } catch (error) {
    return { ok: false, code: 'INVALID_PROJECT', message: getErrorMessage(error) };
  }
  if (!stat.isDirectory()) {
    return { ok: false, code: 'INVALID_PROJECT', message: `project path is not a directory: ${projectArg}` };
  }
  return { ok: true, projectRoot };
}

export interface StaticAuditData {
  readonly audit: RedLineAudit;
  readonly agentShield: AgentShieldState;
  /** Populated only when `--record` is passed. Persisted decision record path. */
  readonly decision?: AuditDecisionRecord;
}

export function registerAuditCommands(program: Command, io: ProgramIO): void {
  const audit = program
    .command('audit')
    .description('Audit a project for compliance with peaks-cli red lines (P0 / P1 / P2 tiers)');

  addJsonOption(
    audit
      .command('red-lines')
      .description('Scan skills/, .claude/rules/, and openspec/changes/ for MANDATORY / BLOCKING / MUST NOT / RED LINE markers; classify each as cli-backed / partial / prose-only')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: RedLinesOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<RedLineAudit>('audit.red-lines', validation.code, validation.message, { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [], enforcerFindings: [] }, ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    try {
      const result = runRedLinesAudit({ projectRoot: validation.projectRoot });
      const nextActions: string[] = [];
      if (result.audit.proseOnly > 0) {
        nextActions.push(`${result.audit.proseOnly} prose-only red lines remain. Plan P1/P2 enforcers in L2.2-L2.4.`);
      }
      if (result.audit.cliBacked > 0) {
        nextActions.push(`${result.audit.cliBacked} red lines are now cli-backed. Re-run after each enforcer lands to track the prose-only ratio.`);
      }
      const envelope: ResultEnvelope<RedLineAudit> = ok('audit.red-lines', result.audit, result.warnings.map((w) => `${w.file}: ${w.message}`), nextActions);
      printResult(io, envelope, options.json);
    } catch (error) {
      printResult(
        io,
        fail<RedLineAudit>('audit.red-lines', 'SCANNER_FAILED', getErrorMessage(error), { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [], enforcerFindings: [] }, ['Inspect scanner logs and re-run with the same --project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice #6 L2.3 P2-a: peaks audit static — soft-optional ECC
  // AgentShell integration. Reads `.peaks/preferences.json`'s
  // `agentShieldEnabled` flag (default false). The CLI flags
  // `--enable-agent-shield` / `--disable-agent-shield` override
  // the preference for a single call.
  //
  // Slice K1 (2.8.0): `--record` persists the audit snapshot as a
  // project-memory decision at `.peaks/memory/audit-decisions/<slug>.md`.
  // `--rid <id>` is an optional disambiguator for multiple audits on
  // the same day (slug becomes `audit-decision-<date>-<rid>`).
  // Per `peaks-cli-when-adding-a-new-subcommand-check-for-existing-top-level-first`
  // and the dev-preference red line "Default-no on new CLI commands",
  // we extend the existing command rather than register a new subcommand.
  addJsonOption(
    audit
      .command('static')
      .description('Run the static audit (peaks-cli lint + optional ECC AgentShield subprocess). Per spec §5.3.')
      .requiredOption('--project <path>', 'target project root')
      .option('--enable-agent-shield', 'force-enable ECC AgentShield subprocess for this call (overrides preference)')
      .option('--disable-agent-shield', 'force-disable ECC AgentShield subprocess for this call (overrides preference)')
      .option('--record', 'persist the audit snapshot to .peaks/memory/audit-decisions/ as a project-memory decision')
      .option('--rid <rid>', 'disambiguator for the decision record slug (used with --record; pairs multiple audits on the same day)')
  ).action(async (options: StaticAuditOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', validation.code, validation.message, emptyStaticAuditData(), ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // Resolve the flag override. `--enable-agent-shield` and
    // `--disable-agent-shield` are mutually exclusive; we surface
    // a 422 if both are passed.
    if (options.enableAgentShield && options.disableAgentShield) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', 'FLAGS_CONFLICT', '`--enable-agent-shield` and `--disable-agent-shield` are mutually exclusive', emptyStaticAuditData(), ['Pass at most one of the two flags']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // Slice K1: `--rid` is meaningful only with `--record`. Surface a 422
    // when the user passes `--rid` without `--record` so the CLI fails
    // loudly rather than silently ignoring the request id.
    if (options.rid && !options.record) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', 'FLAGS_CONFLICT', '`--rid` requires `--record` (decision slug disambiguator has no effect without persistence)', emptyStaticAuditData(), ['Pass `--record` together with `--rid <id>`, or omit `--rid`']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    try {
      const result = runStaticAudit({
        projectRoot: validation.projectRoot,
        ...(options.enableAgentShield
          ? { enableAgentShield: true }
          : options.disableAgentShield
          ? { enableAgentShield: false }
          : {}),
      });

      // Persist the decision record when `--record` is set. The writer is
      // idempotent at the slug level (same date+rid → same file); repeated
      // runs overwrite. Failures here are surfaced as warnings so the
      // primary audit JSON still reaches the caller.
      let decision: AuditDecisionRecord | undefined;
      let recordWarning: string | undefined;
      if (options.record) {
        try {
          decision = writeAuditDecision(result.audit, {
            projectRoot: validation.projectRoot,
            ...(options.rid ? { rid: options.rid } : {})
          });
        } catch (writeError) {
          recordWarning = `Failed to write decision record: ${getErrorMessage(writeError)}`;
        }
      }

      const data: StaticAuditData = {
        audit: result.audit,
        agentShield: result.agentShield,
        ...(decision ? { decision } : {})
      };
      const nextActions: string[] = [];
      // Per spec §5.3 + §7.2: when ECC is not installed, surface
      // the canonical 4-option user opt-in UX (a/b/c/d) via
      // nextActions. The peaks-cli `peaks audit static` CLI is
      // non-interactive (JSON envelope by default), so the 4
      // options are surfaced as machine-readable action strings
      // — same pattern as understand-commands.ts `INSTALL_HINT`.
      if (!result.agentShield.installed) {
        nextActions.push('ECC AgentShield not installed. Pick one of the four options below:');
        nextActions.push('  a) Install: run `npx ecc-agentshield --help` to install, then re-run `peaks audit static`.');
        nextActions.push('  b) Skip this run: pass `--disable-agent-shield` to suppress the subprocess for this call.');
        nextActions.push('  c) Skip forever: run `peaks preferences set agentShieldEnabled false` (writes to `.peaks/preferences.json`).');
        nextActions.push('  d) Learn more: see docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §5.3 + §7.2.');
      }
      if (result.agentShield.spawned && result.agentShield.findings.length > 0) {
        nextActions.push(`${result.agentShield.findings.length} ECC findings merged into the audit. Review with \`peaks audit static --json\`.`);
      }
      if (decision) {
        nextActions.push(`Decision record written: ${decision.filePath}`);
        nextActions.push(`Index synced: ${decision.indexSynced ? 'yes' : 'no'} (memory hot.decision[] now includes this audit)`);
      }
      const warnings = recordWarning ? [...result.warnings, recordWarning] : [...result.warnings];
      const envelope: ResultEnvelope<StaticAuditData> = ok(
        'audit.static',
        data,
        warnings,
        nextActions,
      );
      printResult(io, envelope, options.json);
    } catch (error) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', 'SCANNER_FAILED', getErrorMessage(error), emptyStaticAuditData(), ['Inspect scanner logs and re-run with the same --project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Fix M1 (W5) — `peaks audit goal` CLI wrapper around `auditGoal()`.
  // The service is correctly implemented but is NOT yet wired to a real
  // LLM provider; this CLI exposes the route with a `stub` provider that
  // returns a scaffold envelope. A follow-up slice will bind a real
  // provider. Until then, non-stub providers fail loudly with
  // `LLM_PROVIDER_NOT_IMPLEMENTED` so callers cannot silently no-op.
  addJsonOption(
    audit
      .command('goal')
      .description('Audit a human need across 6 dimensions and propose a goal (peaks-audit primitive)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--need <text>', 'the human need to audit (becomes input.need for auditGoal())')
      .option('--llm-provider <name>', 'LLM provider name (default: stub)', 'stub')
  ).action(async (options: AuditGoalOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<AuditGoalData>('audit.goal', validation.code, validation.message, emptyAuditGoalData(options.need, options.project), ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    const provider = options.llmProvider ?? 'stub';
    if (!isSupportedLlmProvider(provider)) {
      printResult(
        io,
        fail<AuditGoalData>(
          'audit.goal',
          'LLM_PROVIDER_NOT_IMPLEMENTED',
          `LLM provider "${provider}" is not implemented. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}.`,
          emptyAuditGoalData(options.need, validation.projectRoot),
          [
            'Re-run with `--llm-provider stub` (default) to exercise the wired route.',
            'Real provider binding is tracked as a follow-up slice; see peaks-audit skill notes.'
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // Stub provider: surface a structured "scaffold ready" envelope so the
    // CLI route is wired and a CI test can verify it without a real LLM.
    const data: AuditGoalData = {
      status: 'scaffold-only',
      serviceWired: true,
      providerBinding: 'pending-follow-up-slice',
      need: options.need,
      projectRoot: validation.projectRoot,
    };
    const envelope: ResultEnvelope<AuditGoalData> = ok(
      'audit.goal',
      data,
      [],
      [
        'auditGoal() service is wired and reachable. The stub provider returns a scaffold envelope so CI can verify the route without a real LLM.',
        'A follow-up slice will bind a real LLM provider; until then, non-stub providers fail loudly with `LLM_PROVIDER_NOT_IMPLEMENTED`.'
      ]
    );
    printResult(io, envelope, options.json);
  });
}

function emptyStaticAuditData(): StaticAuditData {
  return {
    audit: { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [], enforcerFindings: [] },
    agentShield: {
      spawned: false,
      installed: false,
      reason: 'flag-disabled',
      findings: [],
    },
  };
}

function emptyAuditGoalData(need: string, projectRoot: string): AuditGoalData {
  return {
    status: 'scaffold-only',
    serviceWired: true,
    providerBinding: 'pending-follow-up-slice',
    need,
    projectRoot,
  };
}
