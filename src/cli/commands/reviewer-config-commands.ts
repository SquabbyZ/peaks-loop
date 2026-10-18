/**
 * `peaks reviewer config` — write the `reviewer` section on the user's behalf.
 * Split out of reviewer-commands.ts for the 300-line file-size cap.
 *
 * The LLM runs this; the user never hand-authors JSON (backlog §7.10 ①).
 */
import type { Command } from 'commander';
import {
  defaultReviewerConfigPath,
  loadReviewerConfig,
  MIN_REVIEWER_PROVIDERS,
  type ReviewerConfig,
  type ReviewerConfigStatus,
  type ReviewerFallbackMode,
  type ReviewerProviderConfig,
  type ReviewerSelectionMode
} from '../../services/reviewer/reviewer-config.js';
import {
  DISPATCHABLE_PROVIDER_NAMES,
  parseProviderSpec,
  validateReviewerSection,
  writeReviewerConfig
} from '../../services/reviewer/reviewer-config-write.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';

type ConfigOptions = {
  config?: string;
  json?: boolean;
  provider?: string[];
  selection?: string;
  requireDistinctModelFamily?: string;
  fallbackOnError?: string;
  rdProviderName?: string;
  schemaPath?: string;
};

type Modes = {
  selection: ReviewerSelectionMode;
  fallbackOnError: ReviewerFallbackMode;
  requireDistinctModelFamily: boolean;
};

type FlagFailure = { code: string; message: string; nextActions: string[] };

const SELECTIONS: ReadonlyArray<string> = ['round-robin', 'hash', 'random'];
const FALLBACKS: ReadonlyArray<string> = ['skip', 'error'];

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function isSelection(value: string): value is ReviewerSelectionMode {
  return SELECTIONS.includes(value);
}

function isFallback(value: string): value is ReviewerFallbackMode {
  return FALLBACKS.includes(value);
}

/** `undefined` when the flag was absent; `null` when it is not a boolean. */
function parseBooleanFlag(value: string | undefined): boolean | undefined | null {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function parseProviderFlags(
  options: ConfigOptions
): { providers: ReviewerProviderConfig[] } | FlagFailure {
  const providers: ReviewerProviderConfig[] = [];
  for (const spec of options.provider ?? []) {
    const parsed = parseProviderSpec(spec);
    if (parsed === null) {
      return {
        code: 'INVALID_PROVIDER_SPEC',
        message: `--provider expects <name:model>; got "${spec}"`,
        nextActions: [`Accepted providers: ${DISPATCHABLE_PROVIDER_NAMES.join(', ')}`]
      };
    }
    providers.push(parsed);
  }
  return { providers };
}

function parseModeFlags(options: ConfigOptions, status: ReviewerConfigStatus): Modes | FlagFailure {
  const selection = options.selection ?? (status.ok ? status.config.selection : 'round-robin');
  if (!isSelection(selection)) {
    return {
      code: 'INVALID_SELECTION',
      message: `--selection must be one of ${SELECTIONS.join(', ')}`,
      nextActions: []
    };
  }
  const fallbackOnError =
    options.fallbackOnError ?? (status.ok ? status.config.fallbackOnError : 'skip');
  if (!isFallback(fallbackOnError)) {
    return {
      code: 'INVALID_FALLBACK',
      message: `--fallback-on-error must be one of ${FALLBACKS.join(', ')}`,
      nextActions: []
    };
  }
  const distinct = parseBooleanFlag(options.requireDistinctModelFamily);
  if (distinct === null) {
    return {
      code: 'INVALID_DISTINCT_FLAG',
      message: '--require-distinct-model-family must be true or false',
      nextActions: []
    };
  }
  return {
    selection,
    fallbackOnError,
    requireDistinctModelFamily:
      distinct ?? (status.ok ? status.config.requireDistinctModelFamily : true)
  };
}

function buildSection(
  options: ConfigOptions,
  status: ReviewerConfigStatus,
  providers: ReviewerProviderConfig[],
  modes: Modes
): ReviewerConfig {
  return {
    providers: providers.length > 0 ? providers : status.ok ? [...status.config.providers] : [],
    selection: modes.selection,
    rdProviderName: options.rdProviderName ?? (status.ok ? status.config.rdProviderName : null),
    requireDistinctModelFamily: modes.requireDistinctModelFamily,
    fallbackOnError: modes.fallbackOnError,
    schemaPath:
      options.schemaPath ??
      (status.ok ? status.config.schemaPath : 'schemas/reviewer-envelope.schema.json')
  };
}

function printConfigFailure(
  io: ProgramIO,
  options: ConfigOptions,
  failure: FlagFailure,
  exitCode: number
): void {
  printResult(
    io,
    fail('reviewer.config', failure.code, failure.message, null, failure.nextActions),
    options.json === true
  );
  process.exitCode = exitCode;
}

function invalidSectionFailure(message: string): FlagFailure {
  return {
    code: 'REVIEWER_CONFIG_INVALID',
    message,
    nextActions: [
      'Add providers with: peaks reviewer config --provider <name:model> --provider <name:model>'
    ]
  };
}

function handleConfigAction(options: ConfigOptions, io: ProgramIO): void {
  const path = options.config ?? defaultReviewerConfigPath();
  const status = loadReviewerConfig(options.config !== undefined ? { path } : {});
  const providersResult = parseProviderFlags(options);
  if ('code' in providersResult) {
    printConfigFailure(io, options, providersResult, 2);
    return;
  }
  const modes = parseModeFlags(options, status);
  if ('code' in modes) {
    printConfigFailure(io, options, modes, 2);
    return;
  }
  const section = buildSection(options, status, providersResult.providers, modes);
  const invalid = validateReviewerSection(section);
  if (invalid !== null) {
    printConfigFailure(io, options, invalidSectionFailure(invalid), 2);
    return;
  }
  const written = writeReviewerConfig(section, options.config !== undefined ? { path } : {});
  if (!written.ok) {
    printConfigFailure(
      io,
      options,
      { code: 'REVIEWER_CONFIG_UNREADABLE', message: written.message, nextActions: [] },
      1
    );
    return;
  }
  printResult(
    io,
    ok(
      'reviewer.config',
      { path: written.path, reviewer: section },
      [],
      ['Run `peaks reviewer status` to confirm the section is active.']
    ),
    options.json === true
  );
}

export function registerReviewerConfigCommand(reviewer: Command, io: ProgramIO): void {
  addJsonOption(
    reviewer
      .command('config')
      .description(
        'Write the `reviewer` section to the user config without hand-authoring JSON (LLM-driven).'
      )
      .option(
        '--provider <name:model>',
        `provider entry, repeatable; at least ${MIN_REVIEWER_PROVIDERS} required (accepted: ${DISPATCHABLE_PROVIDER_NAMES.join(', ')})`,
        collect,
        []
      )
      .option('--selection <mode>', 'round-robin | hash | random')
      .option(
        '--require-distinct-model-family <true|false>',
        'require a family distinct from the RD model'
      )
      .option('--fallback-on-error <mode>', 'skip | error')
      .option('--rd-provider-name <name>', 'name of the RD-side provider, if any')
      .option('--schema-path <path>', 'path to the ReviewerEnvelope schema')
      .option('--config <path>', 'reviewer config path (defaults to ~/.peaks/config.json)')
  ).action((options: ConfigOptions) => handleConfigAction(options, io));
}
