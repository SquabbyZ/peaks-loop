import { Command } from 'commander';
import { executeMigration, planMigration } from '../../services/config/config-migration.js';
import { getConfig, getMiniMaxProviderConfig, getMiniMaxProviderStatus, isSensitiveConfigPath, redactConfigSecrets, setConfig, setMiniMaxProviderConfig, type ConfigLayer } from '../../services/config/config-service.js';
import { listAvailableFields, restoreField } from '../../services/config/config-restore.js';
import { executeRollback, planRollback } from '../../services/config/config-rollback.js';
import { testMiniMaxProvider } from '../../services/providers/minimax-provider-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, isMiniMaxHttpsUrl, parseConfigLayer, printInvalidConfigLayer, printResult, redactSensitiveErrorMessage, summarizeMiniMaxSmokeResult, type ProgramIO } from '../cli-helpers.js';

export function registerConfigCommands(program: Command, io: ProgramIO): void {
  const config = program.command('config').description('Manage Peaks configuration');
  registerConfigGetSetCommands(config, io);
  registerConfigMigrationCommands(config, io);
  registerMiniMaxProviderCommands(config, io);
}

function registerConfigGetSetCommands(config: Command, io: ProgramIO): void {
  addJsonOption(config.command('get').description('Get current config or a specific key').option('--key <path>', 'dot-notation key path').option('--layer <layer>', 'user or project')).action((options: { key?: string; layer?: string; json?: boolean }) => {
    const layer = parseConfigLayer(options.layer);
    if (layer === null) {
      printInvalidConfigLayer(io, 'config.get', options.json);
      return;
    }

    const getOpts: { key?: string; layer?: ConfigLayer } = { ...(layer !== undefined ? { layer } : {}), ...(options.key !== undefined ? { key: options.key } : {}) };
    const value = getConfig(getOpts);
    const isSensitiveKey = options.key !== undefined && isSensitiveConfigPath(options.key);
    printResult(io, ok('config.get', isSensitiveKey ? '***' : redactConfigSecrets(value, options.key ?? '')), options.json);
  });

  addJsonOption(config.command('set').description('Set a config value').requiredOption('--key <path>', 'dot-notation key path').requiredOption('--value <json>', 'JSON value').option('--layer <layer>', 'user or project')).action((options: { key: string; value: string; layer?: string; json?: boolean }) => {
    const parsedLayer = parseConfigLayer(options.layer);
    if (parsedLayer === null) {
      printInvalidConfigLayer(io, 'config.set', options.json);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(options.value);
    } catch {
      printResult(io, fail('config.set', 'INVALID_JSON', 'Could not parse value as JSON', {}, ['Use valid JSON: --value \'{"key":"value"}\'']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      setConfig({ key: options.key, value: parsed, layer: parsedLayer ?? 'user' });
      const value = isSensitiveConfigPath(options.key) ? '***' : redactConfigSecrets(parsed);
      printResult(io, ok('config.set', { key: options.key, value }), options.json);
    } catch (error) {
      printConfigSetError(io, error, options.json);
    }
  });
}

function registerConfigMigrationCommands(config: Command, io: ProgramIO): void {
  // Slice 0.5 Task 14 — peaks config {migrate,rollback,restore} subcommands.
  // Wires up the config-migration / config-rollback / config-restore services
  // from Tasks 10-12. The default mode is dry-run; --apply writes.
  config
    .command('migrate')
    .description('Migrate global config from 1.x to 2.0 (YAGNI slim + per-project fields)')
    .option('--project <path>', 'current project root (for migrating per-project fields)', process.cwd())
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--dry-run', 'plan only, do not write (default)')
    .option('--json', 'JSON envelope output')
    .action((options: { project: string; apply?: boolean; dryRun?: boolean; json?: boolean }) => {
      try {
        const apply = options.apply === true;
        if (apply) {
          const result = executeMigration({ currentProjectRoot: options.project, apply: true });
          printResult(io, ok('config.migrate', result), options.json);
          return;
        }
        const plan = planMigration({ currentProjectRoot: options.project });
        printResult(io, ok('config.migrate', { ...plan, applied: false }), options.json);
      } catch (error) {
        printResult(io, fail('config.migrate', 'CONFIG_MIGRATE_FAILED', getErrorMessage(error), {}, ['Inspect ~/.peaks/config.json and re-run with --apply']), options.json);
        process.exitCode = 1;
      }
    });

  config
    .command('rollback')
    .description('Rollback global config to 1.x from .bak')
    .option('--apply', 'actually write changes (default is dry-run)')
    .option('--dry-run', 'plan only, do not write (default)')
    .option('--json', 'JSON envelope output')
    .action((options: { apply?: boolean; dryRun?: boolean; json?: boolean }) => {
      try {
        const apply = options.apply === true;
        if (apply) {
          const result = executeRollback({ apply: true });
          printResult(io, ok('config.rollback', result), options.json);
          return;
        }
        const plan = planRollback();
        printResult(io, ok('config.rollback', { ...plan, applied: false }), options.json);
      } catch (error) {
        const message = getErrorMessage(error);
        const code = message.startsWith('NO_BACKUP') ? 'NO_BACKUP' : 'CONFIG_ROLLBACK_FAILED';
        io.stderr(`${code}: ${message}`);
        printResult(io, fail('config.rollback', code, message, {}, ['Re-run peaks config migrate --apply to recreate the .bak']), options.json);
        process.exitCode = 1;
      }
    });

  config
    .command('restore')
    .description('Restore a single archived field from .bak to a sidecar file')
    .option('--field <name>', 'field name to restore (e.g. language, currentWorkspace)')
    .option('--list', 'list all fields available in .bak')
    .option('--apply', 'actually write sidecar (default is dry-run)')
    .option('--dry-run', 'plan only, do not write (default)')
    .option('--json', 'JSON envelope output')
    .action((options: { field?: string; list?: boolean; apply?: boolean; dryRun?: boolean; json?: boolean }) => {
      try {
        if (options.list === true || !options.field) {
          const fields = listAvailableFields();
          printResult(io, ok('config.restore', { fields, applied: false }), options.json);
          return;
        }
        const apply = options.apply === true;
        const result = restoreField({ field: options.field, apply });
        printResult(io, ok('config.restore', result), options.json);
      } catch (error) {
        const message = getErrorMessage(error);
        let code = 'CONFIG_RESTORE_FAILED';
        if (message.startsWith('NO_BACKUP')) code = 'NO_BACKUP';
        else if (message.startsWith('RESTORE_GUARDED')) code = 'RESTORE_GUARDED';
        else if (message.startsWith('FIELD_NOT_FOUND')) code = 'FIELD_NOT_FOUND';
        io.stderr(`${code}: ${message}`);
        printResult(io, fail('config.restore', code, message, {}, ['Use --list to see available fields']), options.json);
        process.exitCode = 1;
      }
    });
}

function printConfigSetError(io: ProgramIO, error: unknown, asJson?: boolean): void {
  const message = getErrorMessage(error);
  if (message === 'Sensitive config keys must be stored in the user config layer') {
    printResult(io, fail('config.set', 'SECRET_CONFIG_REQUIRES_USER_LAYER', message, {}, ['Use --layer user or peaks config provider minimax set']), asJson);
    process.exitCode = 1;
    return;
  }
  if (message === 'Project config not found') {
    printResult(io, fail('config.set', 'PROJECT_CONFIG_NOT_FOUND', message, {}, ['Create a safe .peaks/config.json in the project or use --layer user']), asJson);
    process.exitCode = 1;
    return;
  }
  if (message === 'MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials') {
    printResult(io, fail('config.set', 'INVALID_MINIMAX_BASE_URL', message, {}, ['Use a MiniMax Anthropic-compatible HTTPS endpoint']), asJson);
    process.exitCode = 1;
    return;
  }

  printResult(io, fail('config.set', 'CONFIG_SET_FAILED', message, {}, ['Check the config key and layer, then retry']), asJson);
  process.exitCode = 1;
}

function registerMiniMaxProviderCommands(config: Command, io: ProgramIO): void {
  const minimaxProvider = config.command('provider').description('Manage model provider settings').command('minimax').description('Manage MiniMax provider settings');

  addJsonOption(minimaxProvider.command('set').description('Set MiniMax provider settings in user config').option('--base-url <url>', 'MiniMax Anthropic-compatible base URL')).action((options: { baseUrl?: string; json?: boolean }) => {
    const baseUrl = options.baseUrl?.trim();
    const apiKey = process.env.MINIMAX_API_KEY?.trim();
    if (!baseUrl && !apiKey) {
      printResult(io, fail('config.provider.minimax.set', 'MINIMAX_PROVIDER_NO_VALUES', 'Provide --base-url and set MINIMAX_API_KEY', {}, ['Export MINIMAX_API_KEY and rerun peaks config provider minimax set --base-url <url>']), options.json);
      process.exitCode = 1;
      return;
    }
    if (baseUrl && !isMiniMaxHttpsUrl(baseUrl)) {
      printResult(io, fail('config.provider.minimax.set', 'INVALID_MINIMAX_BASE_URL', 'MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials', {}, ['Use a MiniMax Anthropic-compatible HTTPS endpoint']), options.json);
      process.exitCode = 1;
      return;
    }

    try {
      const input: { baseUrl?: string; apiKey?: string } = {};
      if (baseUrl) input.baseUrl = baseUrl;
      if (apiKey) input.apiKey = apiKey;
      const status = setMiniMaxProviderConfig(input);
      printResult(io, ok('config.provider.minimax.set', status), options.json);
    } catch (error) {
      printMiniMaxProviderSetError(io, error, options.json);
    }
  });

  addJsonOption(minimaxProvider.command('get').description('Show redacted MiniMax provider settings')).action((options: { json?: boolean }) => {
    const configValue = getMiniMaxProviderConfig();
    const status = getMiniMaxProviderStatus();
    printResult(io, ok('config.provider.minimax.get', { ...(redactConfigSecrets(configValue, 'providers.minimax') as Record<string, unknown>), ...status }), options.json);
  });

  addJsonOption(minimaxProvider.command('status').description('Show MiniMax provider configuration status')).action((options: { json?: boolean }) => {
    printResult(io, ok('config.provider.minimax.status', getMiniMaxProviderStatus()), options.json);
  });

  addJsonOption(minimaxProvider.command('test').description('Run a redacted MiniMax provider smoke test').option('--model <model>', 'model name for the smoke test', 'MiniMax-M2.7')).action(async (options: { model: string; json?: boolean }) => {
    try {
      const result = await testMiniMaxProvider(getMiniMaxProviderConfig(), { model: options.model });
      const safeResult = summarizeMiniMaxSmokeResult(result);
      if (!result.configured) {
        printResult(io, fail('config.provider.minimax.test', 'MINIMAX_PROVIDER_NOT_CONFIGURED', 'MiniMax provider requires baseUrl and apiKey in user config', safeResult, ['Export MINIMAX_API_KEY or set MINIMAX_API_KEY']), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, result.ok ? ok('config.provider.minimax.test', safeResult) : fail('config.provider.minimax.test', 'MINIMAX_PROVIDER_TEST_FAILED', 'MiniMax provider smoke test failed', safeResult, ['Check the MiniMax base URL, API key, and model name']), options.json);
      if (!result.ok) process.exitCode = 1;
    } catch (error) {
      printResult(io, fail('config.provider.minimax.test', 'MINIMAX_PROVIDER_TEST_FAILED', redactSensitiveErrorMessage(getErrorMessage(error)), {}, ['Check network connectivity and MiniMax provider settings']), options.json);
      process.exitCode = 1;
    }
  });
}

function printMiniMaxProviderSetError(io: ProgramIO, error: unknown, asJson?: boolean): void {
  if (getErrorMessage(error) === 'MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials') {
    printResult(io, fail('config.provider.minimax.set', 'INVALID_MINIMAX_BASE_URL', 'MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials', {}, ['Use a MiniMax Anthropic-compatible HTTPS endpoint']), asJson);
    process.exitCode = 1;
    return;
  }

  printResult(io, fail('config.provider.minimax.set', 'MINIMAX_PROVIDER_SET_FAILED', getErrorMessage(error), {}, ['Check MiniMax provider settings and retry']), asJson);
  process.exitCode = 1;
}

