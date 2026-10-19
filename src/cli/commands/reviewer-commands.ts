/**
 * `peaks reviewer run|status` — CLI surface for the G4 third-party reviewer.
 * `peaks reviewer config` lives in reviewer-config-commands.ts (file-size cap).
 *
 *   peaks reviewer run    --rid <rid> [--write] [--session-id <id>] [--project <path>] [--json]
 *   peaks reviewer status [--project <path>] [--json]
 *
 * The CLI never silently prompts for API keys. When `~/.peaks/config.json`
 * has no usable `reviewer` section, `run` emits the skip envelope (which is
 * NOT a pass) and exits 0, consistent with fallbackOnError=skip.
 */
import type { Command } from 'commander';
import {
  runReviewer,
  type ReviewerEnvelope,
  type ReviewerRunOutput
} from '../../services/reviewer/reviewer-service.js';
import {
  defaultReviewerConfigPath,
  loadReviewerConfig,
  MIN_REVIEWER_PROVIDERS,
  resolveReviewerSchema,
  type ReviewerConfig,
  type ReviewerConfigStatus
} from '../../services/reviewer/reviewer-config.js';
import { DISPATCHABLE_PROVIDER_NAMES } from '../../services/reviewer/reviewer-config-write.js';
import { writeReviewerArtifacts } from '../../services/reviewer/reviewer-artifacts.js';
import { deriveModelFamily } from '../../services/reviewer/model-family.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { readActiveSid } from './code-runtime-session.js';
import { registerReviewerConfigCommand } from './reviewer-config-commands.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

type ConfigPathOptions = { config?: string; json?: boolean; project?: string };
type RunOptions = ConfigPathOptions & {
  rid?: string;
  write?: boolean;
  sessionId?: string;
};

function isJson(options: ConfigPathOptions): boolean {
  return options.json === true;
}

function printRunFailure(
  io: ProgramIO,
  options: ConfigPathOptions,
  code: string,
  message: string,
  nextActions: string[]
): void {
  printResult(io, fail('reviewer.run', code, message, null, nextActions), isJson(options));
}

async function handleRun(options: RunOptions, io: ProgramIO): Promise<void> {
  const rid = options.rid ?? '';
  if (rid.length === 0) {
    printRunFailure(io, options, 'MISSING_RID', '--rid is required', []);
    process.exitCode = 2;
    return;
  }
  const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
  const result = await runReviewer({
    rid,
    context: `rid=${rid}`,
    projectRoot,
    ...(options.config !== undefined ? { configPath: options.config } : {})
  });
  if (!result.ok) {
    if (result.reason === 'schema-missing') {
      printRunFailure(
        io,
        options,
        'SCHEMA_MISSING',
        `Reviewer schema not found; searched: ${(result.schemaCandidates ?? []).join(', ')}`,
        ['Fix the reviewer config schemaPath or place the schema at one of the searched paths.']
      );
      process.exitCode = 1;
      return;
    }
    printConfigSkip(result, options, io);
    return;
  }
  if (options.write !== true) {
    printResult(io, ok('reviewer.run', { envelope: result.envelope }), isJson(options));
    return;
  }
  if (result.skipped) {
    printResult(
      io,
      ok('reviewer.run', {
        envelope: result.envelope,
        written: false,
        writeSkippedReason: result.envelope.reason
      }),
      isJson(options)
    );
    return;
  }
  writeArtifacts(result.envelope, rid, { projectRoot, options }, io);
}

function printConfigSkip(
  result: Extract<ReviewerRunOutput, { ok: false }>,
  options: RunOptions,
  io: ProgramIO
): void {
  const data =
    options.write === true
      ? {
          envelope: result.envelope,
          reason: result.reason,
          written: false,
          writeSkippedReason: result.envelope.reason
        }
      : { envelope: result.envelope, reason: result.reason };
  printResult(
    io,
    ok(
      'reviewer.run',
      data,
      [],
      [
        `Configure the reviewer with: peaks reviewer config --provider <name:model> --provider <name:model>`
      ]
    ),
    isJson(options)
  );
}

type WriteContext = { projectRoot: string; options: RunOptions };

function writeArtifacts(
  envelope: ReviewerEnvelope,
  rid: string,
  context: WriteContext,
  io: ProgramIO
): void {
  const { projectRoot, options } = context;
  const sessionId = options.sessionId ?? readActiveSid(projectRoot) ?? '';
  if (sessionId.length === 0) {
    printResult(
      io,
      fail(
        'reviewer.run',
        'MISSING_SESSION_ID',
        '--write needs an active session id; pass --session-id <id>',
        { envelope },
        ['Re-run with --session-id <sessionId>']
      ),
      isJson(options)
    );
    process.exitCode = 1;
    return;
  }
  try {
    printResult(
      io,
      ok('reviewer.run', {
        envelope,
        written: true,
        artifacts: writeReviewerArtifacts({ projectRoot, sessionId, rid, envelope })
      }),
      isJson(options)
    );
  } catch (error) {
    printResult(
      io,
      fail('reviewer.run', 'ARTIFACT_WRITE_FAILED', getErrorMessage(error), { envelope }),
      isJson(options)
    );
    process.exitCode = 1;
  }
}

function registerRunCommand(reviewer: Command, io: ProgramIO): void {
  addJsonOption(
    reviewer
      .command('run')
      .description('Run the configured third-party reviewer on a slice.')
      .option('--rid <rid>', 'request id (slice) to review')
      .option('--write', 'write rd/third-party-review-<rid>.md + .json under the session runtime')
      .option('--session-id <id>', 'session id for --write (defaults to the active session)')
      .option(
        '--project <path>',
        'project root for schema resolution and --write (promotes to the git root)'
      )
      .option('--config <path>', 'reviewer config path (defaults to ~/.peaks/config.json)')
  ).action((options: RunOptions) => handleRun(options, io));
}

function unconfiguredData(
  status: Extract<ReviewerConfigStatus, { ok: false }>,
  path: string
): Record<string, unknown> {
  return {
    configured: false,
    state: status.reason === 'insufficient-providers' ? 'insufficient-providers' : 'no-section',
    reason: status.reason,
    configPath: path,
    providerCount: status.providerCount,
    requiredProviders: status.requiredProviders
  };
}

function unconfiguredActions(
  status: Extract<ReviewerConfigStatus, { ok: false }>,
  path: string
): string[] {
  const first =
    status.reason === 'insufficient-providers'
      ? `Only ${String(status.providerCount)} valid provider(s); at least ${String(status.requiredProviders)} are required. Add one with: peaks reviewer config --provider <name:model>`
      : `No reviewer section at ${path}. Write one with: peaks reviewer config --provider <name:model> --provider <name:model>`;
  return [first, `Accepted providers: ${DISPATCHABLE_PROVIDER_NAMES.join(', ')}.`];
}

function configuredData(
  config: ReviewerConfig,
  path: string,
  projectRoot: string
): Record<string, unknown> {
  const families = config.providers.map((p) => ({
    name: p.name,
    model: p.model,
    modelFamily: deriveModelFamily(p.model).modelFamily
  }));
  const schema = resolveReviewerSchema(projectRoot, config.schemaPath);
  return {
    configured: true,
    state: 'configured',
    configPath: path,
    providerCount: families.length,
    requiredProviders: MIN_REVIEWER_PROVIDERS,
    selection: config.selection,
    requireDistinctModelFamily: config.requireDistinctModelFamily,
    fallbackOnError: config.fallbackOnError,
    schemaPath: config.schemaPath,
    schemaPathExists: schema.ok,
    schemaPathSource: schema.ok ? schema.source : null,
    schemaPathResolved: schema.ok ? schema.path : null,
    rdProviderName: config.rdProviderName,
    providers: families
  };
}

function handleStatus(options: ConfigPathOptions, io: ProgramIO): void {
  const path = options.config ?? defaultReviewerConfigPath();
  // Same promotion as `run`: the diagnostic must agree with the run decision.
  const projectRoot = resolveCanonicalProjectRoot(options.project ?? process.cwd());
  const status = loadReviewerConfig(options.config !== undefined ? { path } : {});
  if (!status.ok) {
    printResult(
      io,
      ok('reviewer.status', unconfiguredData(status, path), [], unconfiguredActions(status, path)),
      isJson(options)
    );
    return;
  }
  printResult(
    io,
    ok('reviewer.status', configuredData(status.config, path, projectRoot)),
    isJson(options)
  );
}

function registerStatusCommand(reviewer: Command, io: ProgramIO): void {
  addJsonOption(
    reviewer
      .command('status')
      .description(
        'Show whether the reviewer is configured and which selection mode + provider families are active.'
      )
      .option('--config <path>', 'reviewer config path (defaults to ~/.peaks/config.json)')
      .option('--project <path>', 'project root for schema resolution (promotes to the git root)')
  ).action((options: ConfigPathOptions) => handleStatus(options, io));
}

export function registerReviewerCommands(program: Command, io: ProgramIO): void {
  const reviewer = program
    .command('reviewer')
    .description(
      'Third-party reviewer (v2.14.0 G4 anti-fake-green) — runs an out-of-band model on the slice and emits a schema-validated ReviewerEnvelope.'
    );
  registerReviewerConfigCommand(reviewer, io);
  registerRunCommand(reviewer, io);
  registerStatusCommand(reviewer, io);
}
