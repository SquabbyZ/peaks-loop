/**
 * `peaks workspace init` — the registrar.
 *
 * Extracted from `src/cli/commands/workspace-commands.ts` (slice
 * 800-line Karpathy cap). Split further by responsibility.
 * The option/outcome shapes, the first-time hooks
 * decision, project-root + session resolution, the nextAction/warning
 * collectors, the codegraph stake, the envelope builder and the typed failure
 * arms each live in their own module under `./`. This file wires them up.
 *
 * Imports the shared hooks-decision marker helpers from `./helpers.ts`.
 */

import type { Command } from 'commander';
import { ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../../cli-helpers.js';
import {
  bootstrapProjectScanForInit,
  resolveInitTarget,
  runInitWorkspace,
  type WorkspaceInitContext
} from './init-context.js';
import { collectInitEnvelope } from './init-actions.js';
import { buildInitEnvelopeData } from './init-envelope.js';
import { reportWorkspaceInitFailure } from './init-failures.js';
import type { WorkspaceInitOptions } from './init-options.js';

// Published import paths preserved: `workspace-commands.ts` (and tests) import
// the hooks-decision primitive and its two types from this module.
export { resolveFirstTimeHooksInstall } from './init-hooks-decision.js';
export type {
  FirstTimeHooksInstallOutcome,
  ResolveFirstTimeHooksInstallOptions,
  WorkspaceInitOptions
} from './init-options.js';

const INIT_DESCRIPTION =
  'Create the .peaks/_runtime/<session-id>/ directory with ONLY the session.json metadata file (slice 006: role subdirs prd/ui/rd/qa/sc/txt and the system/ subdir are created lazily by writers, not pre-created at init). Pass --session-id to use a specific id, or omit it to auto-generate one (and adopt an existing binding if present). On the first call for a project, also handles the one-time "install peaks hooks" decision (sticky-marker stored in .peaks/.peaks-init-hooks-decision.json).';
const INIT_PROJECT_HELP = 'target project root';
const INIT_SESSION_HELP =
  'optional session id in YYYY-MM-DD-<kebab-slug> format. When omitted, the CLI is the single source of truth: an existing binding is reused, otherwise a fresh id is auto-generated.';
const INIT_REBIND_HELP =
  'overwrite an existing session binding when the requested session id differs from the project current one';
const INIT_NO_ROTATE_HELP =
  'suppress the auto-rotation of the project session binding when the outer (Claude / harness) session id has changed. Default rotates on mismatch.';
const INIT_INSTALL_HOOKS_HELP =
  'first-time hooks install behaviour: ask (default in TTY, prompt once + sticky-marker), auto (default in --json / non-TTY, install silently + sticky-marker), skip (sticky-marker skipped, do not install)';
const INIT_NO_CLAUDE_HOOKS_HELP =
  'do NOT materialize .claude/settings.local.json (slice 2.0.1-bug3 fact-forcing bypass). Default: hooks installed so tool calls inside .peaks/** are not blocked by the [Fact-Forcing Gate].';
const INIT_INIT_STANDARDS_HELP =
  "slice 2026-06-16-peaks-code-auto-scaffold: when the consumer project's .claude/rules/ is missing or empty, auto-apply `peaks standards init --project <path> --apply` after emitting the diagnostic. Default: diagnostic only (no write).";
const INIT_NO_PROJECT_SCAN_HELP =
  'slice 2026-07-15-project-scan-bootstrap: skip the bootstrap of .peaks/project-scan/{project-scan.md + 4 audit/business templates} that runs after init succeeds. Default: bootstrap runs (idempotent: existing files are kept unless --force-project-scan-templates is also passed).';
const INIT_FORCE_TEMPLATES_HELP =
  'slice 2026-07-15-project-scan-bootstrap (AC10): overwrite the 4 audit/business templates under .peaks/project-scan/ (business-knowledge.md, security-template.md, perf-template.md, audit-output-schema.md) even when they already exist. Default: skip existing files (sediment-preserved).';

function parseInstallHooks(value: string): string {
  if (value !== 'ask' && value !== 'auto' && value !== 'skip') {
    throw new Error(`--install-hooks must be one of: ask, auto, skip (got "${value}")`);
  }
  return value;
}

async function runWorkspaceInit(options: WorkspaceInitOptions, io: ProgramIO): Promise<void> {
  try {
    const { projectRoot, sessionId, rotation } = await resolveInitTarget(options);
    const report = await runInitWorkspace(options, projectRoot, sessionId);
    const scan = await bootstrapProjectScanForInit(options, projectRoot);
    const ctx: WorkspaceInitContext = {
      options,
      projectRoot,
      sessionId,
      rotation,
      report,
      projectScanEnvelope: scan.envelope,
      projectScanError: scan.error
    };
    const parts = await collectInitEnvelope(ctx);
    printResult(
      io,
      ok(
        'workspace.init',
        buildInitEnvelopeData(ctx, parts.hooksOutcome, parts.codegraphAutoOutcome),
        parts.warnings,
        parts.nextActions
      ),
      options.json
    );
  } catch (error) {
    reportWorkspaceInitFailure(io, error, options);
  }
}

export function registerWorkspaceInitCommand(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('init')
      .description(INIT_DESCRIPTION)
      .requiredOption('--project <path>', INIT_PROJECT_HELP)
      .option('--session-id <id>', INIT_SESSION_HELP)
      .option('--allow-session-rebind', INIT_REBIND_HELP, false)
      .option('--no-rotate-on-outer-mismatch', INIT_NO_ROTATE_HELP)
      .option('--install-hooks <mode>', INIT_INSTALL_HOOKS_HELP, parseInstallHooks)
      .option('--no-claude-hooks', INIT_NO_CLAUDE_HOOKS_HELP)
      .option('--init-standards', INIT_INIT_STANDARDS_HELP)
      .option('--no-project-scan-bootstrap', INIT_NO_PROJECT_SCAN_HELP)
      .option('--force-project-scan-templates', INIT_FORCE_TEMPLATES_HELP, false)
  ).action((options: WorkspaceInitOptions) => runWorkspaceInit(options, io));
}
