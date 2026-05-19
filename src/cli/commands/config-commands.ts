import { Command } from 'commander';
import { addWorkspace, getConfig, getMiniMaxProviderConfig, getMiniMaxProviderStatus, isSensitiveConfigPath, readConfig, redactConfigSecrets, removeWorkspace, setConfig, setCurrentWorkspace, setMiniMaxProviderConfig, type ConfigLayer } from '../../services/config/config-service.js';
import type { ArtifactStorageConfig } from '../../services/config/config-types.js';
import { testMiniMaxProvider } from '../../services/providers/minimax-provider-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, isArtifactProvider, isArtifactRepoSegment, isMiniMaxHttpsUrl, parseConfigLayer, printInvalidConfigLayer, printResult, redactSensitiveErrorMessage, summarizeMiniMaxSmokeResult, type ProgramIO } from '../cli-helpers.js';

interface ArtifactRepoInput {
  provider?: string;
  repoOwner?: string;
  repoName?: string;
}

interface ArtifactRepoConfig {
  provider: 'github' | 'gitlab';
  owner: string;
  name: string;
}

export function registerConfigCommands(program: Command, io: ProgramIO): void {
  const config = program.command('config').description('Manage Peaks configuration');
  registerConfigGetSetCommands(config, io);
  registerMiniMaxProviderCommands(config, io);
  registerWorkspaceCommands(config, io);
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

function registerWorkspaceCommands(config: Command, io: ProgramIO): void {
  const configWorkspace = config.command('workspace').description('Manage workspaces');
  addJsonOption(configWorkspace.command('list').description('List all workspaces')).action((options: { json?: boolean }) => {
    const cfg = readConfig();
    printResult(io, ok('config.workspace.list', { currentWorkspace: cfg.currentWorkspace, workspaces: cfg.workspaces }), options.json);
  });

  addJsonOption(configWorkspace.command('add').description('Add a workspace').requiredOption('--id <id>', 'workspace identifier').requiredOption('--name <name>', 'workspace display name').requiredOption('--path <path>', 'workspace root path').option('--provider <provider>', 'artifact repo provider: github or gitlab').option('--repo-owner <owner>', 'artifact repo owner').option('--repo-name <name>', 'artifact repo name').option('--layer <layer>', 'user or project')).action((options: { id: string; name: string; path: string; provider?: string; repoOwner?: string; repoName?: string; layer?: string; json?: boolean }) => {
    const layer = parseConfigLayer(options.layer);
    if (layer === null) {
      printInvalidConfigLayer(io, 'config.workspace.add', options.json);
      return;
    }

    const artifactRepo = parseArtifactRepoInput(io, options, options.json);
    if (artifactRepo === null) return;

    const artifactStorage: ArtifactStorageConfig = artifactRepo ? { mode: 'local-with-remote-sync', remote: artifactRepo } : { mode: 'local' };
    const workspace = { workspaceId: options.id, name: options.name, rootPath: options.path, installedCapabilityIds: [] as string[], artifactStorage };
    const configLayer = layer ?? 'user';
    if (artifactRepo) {
      addWorkspace({ ...workspace, artifactRepo }, configLayer);
    } else {
      addWorkspace(workspace, configLayer);
    }
    printResult(io, ok('config.workspace.add', { workspaceId: options.id, name: options.name, rootPath: options.path, artifactRepo, artifactStorage }), options.json);
  });

  addJsonOption(configWorkspace.command('remove').description('Remove a workspace').requiredOption('--id <id>', 'workspace identifier').option('--layer <layer>', 'user or project')).action((options: { id: string; layer?: string; json?: boolean }) => {
    const layer = parseConfigLayer(options.layer);
    if (layer === null) {
      printInvalidConfigLayer(io, 'config.workspace.remove', options.json);
      return;
    }
    const configLayer = layer ?? 'user';
    const removed = removeWorkspace(options.id, configLayer);
    if (removed) {
      printResult(io, ok('config.workspace.remove', { workspaceId: options.id }), options.json);
    } else {
      printWorkspaceNotFound(io, 'config.workspace.remove', `Workspace ${options.id} not found`, options.json);
    }
  });

  addJsonOption(configWorkspace.command('switch').description('Switch current workspace').requiredOption('--id <id>', 'workspace identifier').option('--layer <layer>', 'user or project')).action((options: { id: string; layer?: string; json?: boolean }) => {
    const layer = parseConfigLayer(options.layer);
    if (layer === null) {
      printInvalidConfigLayer(io, 'config.workspace.switch', options.json);
      return;
    }
    const configLayer = layer ?? 'user';
    const switched = setCurrentWorkspace(options.id, configLayer);
    if (switched) {
      printResult(io, ok('config.workspace.switch', { currentWorkspace: options.id }), options.json);
    } else {
      printWorkspaceNotFound(io, 'config.workspace.switch', `Workspace ${options.id} not found`, options.json);
    }
  });
}

function parseArtifactRepoInput(io: ProgramIO, options: ArtifactRepoInput, asJson?: boolean): ArtifactRepoConfig | undefined | null {
  const hasArtifactRepoInput = options.provider !== undefined || options.repoOwner !== undefined || options.repoName !== undefined;
  if (!hasArtifactRepoInput) return undefined;
  if (!options.provider || !options.repoOwner || !options.repoName) {
    printResult(io, fail('config.workspace.add', 'INVALID_ARTIFACT_REPO_CONFIG', 'Artifact repo config requires --provider, --repo-owner, and --repo-name together', {}, ['Provide all three artifact repo options together, or omit them all']), asJson);
    process.exitCode = 1;
    return null;
  }
  if (!isArtifactProvider(options.provider)) {
    printResult(io, fail('config.workspace.add', 'UNSUPPORTED_ARTIFACT_PROVIDER', `Unsupported provider ${options.provider}`, {}, ['Use --provider github or --provider gitlab']), asJson);
    process.exitCode = 1;
    return null;
  }
  if (!isArtifactRepoSegment(options.repoOwner) || !isArtifactRepoSegment(options.repoName)) {
    printResult(io, fail('config.workspace.add', 'INVALID_ARTIFACT_REPO_CONFIG', 'Artifact repo owner and name must use safe GitHub/GitLab path segments', {}, ['Use letters, numbers, dots, underscores, or hyphens without path traversal']), asJson);
    process.exitCode = 1;
    return null;
  }

  return { provider: options.provider, owner: options.repoOwner, name: options.repoName };
}

function printWorkspaceNotFound(io: ProgramIO, command: string, message: string, asJson?: boolean): void {
  printResult(io, fail(command, 'WORKSPACE_NOT_FOUND', message, {}, ['List workspaces with: peaks config workspace list']), asJson);
  process.exitCode = 1;
}
