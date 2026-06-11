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
};

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
  addJsonOption(
    audit
      .command('static')
      .description('Run the static audit (peaks-cli lint + optional ECC AgentShield subprocess). Per spec §5.3.')
      .requiredOption('--project <path>', 'target project root')
      .option('--enable-agent-shield', 'force-enable ECC AgentShield subprocess for this call (overrides preference)')
      .option('--disable-agent-shield', 'force-disable ECC AgentShield subprocess for this call (overrides preference)')
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

    try {
      const result = runStaticAudit({
        projectRoot: validation.projectRoot,
        ...(options.enableAgentShield
          ? { enableAgentShield: true }
          : options.disableAgentShield
          ? { enableAgentShield: false }
          : {}),
      });
      const data: StaticAuditData = {
        audit: result.audit,
        agentShield: result.agentShield,
      };
      const nextActions: string[] = [];
      if (!result.agentShield.installed) {
        nextActions.push('ECC AgentShield not installed. Run `npx ecc-agentshield --help` to install, or set `agentShieldEnabled: true` in `.peaks/preferences.json` after install.');
      }
      if (result.agentShield.spawned && result.agentShield.findings.length > 0) {
        nextActions.push(`${result.agentShield.findings.length} ECC findings merged into the audit. Review with \`peaks audit static --json\`.`);
      }
      const envelope: ResultEnvelope<StaticAuditData> = ok(
        'audit.static',
        data,
        [...result.warnings],
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
