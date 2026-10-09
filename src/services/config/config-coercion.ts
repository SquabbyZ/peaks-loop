/**
 * Coercion of untrusted JSON into the typed config shapes.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
import { isRecord, isSafeConfigSegment } from './config-primitives.js';
import { isValidProxyUrl } from './config-validation.js';
import type {
  ModelPreference,
  ModelProviderConfig,
  PeaksConfig,
  ProviderModelConfig,
  ProxyConfig,
  TokenConfig,
  TokenRef,
  WorkspaceConfig
} from './config-types.js';

function toArtifactRemoteRepoConfig(value: unknown): WorkspaceConfig['artifactRepo'] | null {
  if (
    !isRecord(value) ||
    (value.provider !== 'github' && value.provider !== 'gitlab') ||
    typeof value.owner !== 'string' ||
    typeof value.name !== 'string'
  ) {
    return null;
  }
  if (!isSafeConfigSegment(value.owner) || !isSafeConfigSegment(value.name)) {
    return null;
  }
  return { provider: value.provider, owner: value.owner, name: value.name };
}

function toArtifactStorageConfig(value: unknown): WorkspaceConfig['artifactStorage'] | null {
  if (!isRecord(value)) return null;
  const localPath = typeof value.localPath === 'string' ? { localPath: value.localPath } : {};
  if (value.mode === 'local') {
    return { mode: 'local', ...localPath };
  }
  const remote = toArtifactRemoteRepoConfig(value.remote);
  if (value.mode === 'local-with-remote-sync' && remote) {
    return { mode: 'local-with-remote-sync', ...localPath, remote };
  }
  return null;
}

function toWorkspaceConfig(value: unknown): WorkspaceConfig | null {
  if (!isRecord(value)) return null;
  const { workspaceId, name, rootPath, installedCapabilityIds } = value;
  if (
    typeof workspaceId !== 'string' ||
    !isSafeConfigSegment(workspaceId) ||
    typeof name !== 'string' ||
    typeof rootPath !== 'string' ||
    !Array.isArray(installedCapabilityIds) ||
    !installedCapabilityIds.every((id) => typeof id === 'string')
  ) {
    return null;
  }
  const artifactRepo = toArtifactRemoteRepoConfig(value.artifactRepo);
  const artifactStorage = toArtifactStorageConfig(value.artifactStorage);
  return {
    workspaceId,
    name,
    rootPath,
    installedCapabilityIds,
    ...(artifactRepo ? { artifactRepo } : {}),
    ...(artifactStorage ? { artifactStorage } : {})
  };
}

export function toWorkspaceConfigs(value: unknown): WorkspaceConfig[] {
  return Array.isArray(value)
    ? value
        .map(toWorkspaceConfig)
        .filter((workspace): workspace is WorkspaceConfig => workspace !== null)
    : [];
}

export function toProviderModelConfig(value: unknown): ProviderModelConfig {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.model === 'string' && value.model.trim().length > 0
      ? { model: value.model.trim() }
      : {}),
    ...(typeof value.baseUrl === 'string' ? { baseUrl: value.baseUrl } : {}),
    ...(typeof value.apiKey === 'string' ? { apiKey: value.apiKey } : {})
  };
}
const TOKEN_CONFIG_KEYS = new Set<keyof TokenConfig>([
  'AnthropicApiKey',
  'OpenAiApiKey',
  'GitHubToken',
  'GitLabToken'
]);

function toTokenRef(value: unknown): TokenRef | null {
  if (!isRecord(value)) return null;
  const env = typeof value.env === 'string' ? value.env.trim() : '';
  const keychain = typeof value.keychain === 'string' ? value.keychain.trim() : '';
  if (env.length > 0) {
    return { env };
  }
  if (keychain.length > 0) {
    return { keychain };
  }
  if (value.ghCli === true) {
    return { ghCli: true };
  }
  return null;
}

export function toTokenConfig(value: unknown): TokenConfig {
  if (!isRecord(value)) return {};
  const tokens: TokenConfig = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!TOKEN_CONFIG_KEYS.has(key as keyof TokenConfig)) continue;
    const tokenRef = toTokenRef(entry);
    if (tokenRef) {
      tokens[key as keyof TokenConfig] = tokenRef;
    }
  }
  return tokens;
}

export function toModelProviderConfig(value: unknown): ModelProviderConfig {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([providerId, providerConfig]) => [
      providerId,
      toProviderModelConfig(providerConfig)
    ])
  );
}

function toProxyConfig(value: unknown): ProxyConfig | null {
  if (!isRecord(value)) return null;
  return typeof value.httpProxy === 'string' && isValidProxyUrl(value.httpProxy)
    ? { httpProxy: value.httpProxy }
    : null;
}
export function inferHumanLanguage(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Language must be non-empty');
  }
  if (/^zh(?:-|$)/i.test(normalized) || /[㐀-鿿]/u.test(normalized)) {
    return 'zh-CN';
  }
  if (/^en(?:-|$)/i.test(normalized)) {
    return 'en';
  }
  return 'en';
}

export function toPeaksConfig(value: unknown): Partial<PeaksConfig> {
  if (!isRecord(value)) return {};
  const proxy = toProxyConfig(value.proxy);
  return {
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    ...(typeof value.model === 'string' && ['haiku', 'sonnet', 'opus'].includes(value.model)
      ? { model: value.model as ModelPreference }
      : {}),
    ...(typeof value.economyMode === 'boolean' ? { economyMode: value.economyMode } : {}),
    ...(typeof value.swarmMode === 'boolean' ? { swarmMode: value.swarmMode } : {}),
    ...(isRecord(value.tokens) ? { tokens: toTokenConfig(value.tokens) } : {}),
    ...(isRecord(value.providers) ? { providers: toModelProviderConfig(value.providers) } : {}),
    ...(proxy ? { proxy } : {})
  };
}
