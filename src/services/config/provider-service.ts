import { SIDECAR_SCHEMA_VERSION, ensureSidecarVersion, providersConfigPath, readSidecarJson, writeSidecarJson } from './sidecar-store.js';

/**
 * Provider configs (MiniMax and other custom providers) live in
 * `~/.peaks/providers.json` — NOT in the slim `~/.peaks/config.json`.
 * The slim config only carries `version` + `ocr.llm.*`; provider
 * model selection, base URLs, and API keys live here in a dedicated
 * sidecar so the user has one discoverable location for runtime
 * model-routing settings.
 *
 * This module is the only owner of the providers.json file. Reads
 * from `~/.peaks/config.json.providers` are tolerated as a one-time
 * back-compat fallback so an unmigrated 1.x-style config still
 * returns the user's existing MiniMax configuration; the next
 * `setMiniMaxProviderConfig` call promotes the value into
 * `~/.peaks/providers.json` and the legacy `~/.peaks/config.json`
 * field is stripped by `loadGlobalConfig` governance.
 */

export const MINIMAX_API_HOST = 'api.minimaxi.com';

export type MiniMaxProviderConfig = {
  model?: string;
  baseUrl?: string;
  apiKey?: string;
};

export type ProviderModelConfig = MiniMaxProviderConfig;

export type ModelProviderId = 'minimax' | string;
export type ExecutionModelId = string;
export type ModelPreference = 'haiku' | 'sonnet' | 'opus' | 'minimax';

export type ModelProviderConfig = {
  minimax?: MiniMaxProviderConfig;
  [providerId: string]: ProviderModelConfig | undefined;
};

type ProvidersSidecar = {
  version: string;
  providers: ModelProviderConfig;
};

function loadProvidersSidecar(): ProvidersSidecar {
  const fallback: ProvidersSidecar = { version: SIDECAR_SCHEMA_VERSION, providers: {} };
  const raw = readSidecarJson<Partial<ProvidersSidecar>>(providersConfigPath(), fallback);
  const version = ensureSidecarVersion(raw).version;
  const providers = sanitizeProviders(raw.providers);
  return { version, providers };
}

function saveProvidersSidecar(providers: ModelProviderConfig): void {
  writeSidecarJson(providersConfigPath(), {
    version: SIDECAR_SCHEMA_VERSION,
    providers
  });
}

function sanitizeProviders(value: unknown): ModelProviderConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: ModelProviderConfig = {};
  for (const [id, cfg] of Object.entries(value as Record<string, unknown>)) {
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
    const sanitized = sanitizeMiniMaxLike(cfg);
    if (Object.keys(sanitized).length > 0) {
      out[id] = sanitized;
    }
  }
  return out;
}

function sanitizeMiniMaxLike(value: unknown): ProviderModelConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const out: ProviderModelConfig = {};
  if (typeof v.model === 'string' && v.model.trim().length > 0) out.model = v.model.trim();
  if (typeof v.baseUrl === 'string' && v.baseUrl.length > 0) out.baseUrl = v.baseUrl;
  if (typeof v.apiKey === 'string' && v.apiKey.length > 0) out.apiKey = v.apiKey;
  return out;
}

export function isValidProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0 && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

export function isValidMiniMaxBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === MINIMAX_API_HOST && url.username.length === 0 && url.password.length === 0 && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

export function validateMiniMaxBaseUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidMiniMaxBaseUrl(value))) {
    throw new Error('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
  }
}

export function validateProviderBaseUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidProviderBaseUrl(value))) {
    throw new Error('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
  }
}

export function validateModelProviderConfig(providers: ModelProviderConfig): void {
  validateMiniMaxBaseUrl(providers.minimax?.baseUrl);
  for (const [providerId, provider] of Object.entries(providers)) {
    if (providerId !== 'minimax') {
      validateProviderBaseUrl(provider?.baseUrl);
    }
  }
}

export type MiniMaxProviderStatus = {
  provider: 'minimax';
  configured: boolean;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  storage: 'sidecar-v1';
  nextActions: string[];
};

function createMiniMaxProviderStatus(config: MiniMaxProviderConfig): MiniMaxProviderStatus {
  const baseUrl = config.baseUrl?.trim();
  const apiKey = config.apiKey?.trim();
  const baseUrlConfigured = typeof baseUrl === 'string' && baseUrl.length > 0 && isValidMiniMaxBaseUrl(baseUrl);
  const apiKeyConfigured = typeof apiKey === 'string' && apiKey.length > 0;
  return {
    provider: 'minimax',
    configured: baseUrlConfigured && apiKeyConfigured,
    baseUrlConfigured,
    apiKeyConfigured,
    storage: 'sidecar-v1',
    nextActions: baseUrlConfigured && apiKeyConfigured ? [] : ['Export MINIMAX_API_KEY and rerun peaks config provider minimax set --base-url <url>']
  };
}

export function getMiniMaxProviderConfig(): MiniMaxProviderConfig {
  return loadProvidersSidecar().providers.minimax ?? {};
}

export function getMiniMaxProviderStatus(): MiniMaxProviderStatus {
  return createMiniMaxProviderStatus(getMiniMaxProviderConfig());
}

export function setMiniMaxProviderConfig(input: MiniMaxProviderConfig): MiniMaxProviderStatus {
  validateMiniMaxBaseUrl(input.baseUrl);
  const current = loadProvidersSidecar().providers;
  const next: ModelProviderConfig = {
    ...current,
    minimax: {
      ...current.minimax,
      ...input
    }
  };
  validateMiniMaxBaseUrl(next.minimax?.baseUrl);
  saveProvidersSidecar(next);
  return createMiniMaxProviderStatus(next.minimax ?? {});
}

export function getAllProviders(): ModelProviderConfig {
  return loadProvidersSidecar().providers;
}

export function setProviderConfig(providerId: string, input: ProviderModelConfig): ModelProviderConfig {
  if (providerId === 'minimax') {
    throw new Error('Use setMiniMaxProviderConfig for the minimax provider');
  }
  validateProviderBaseUrl(input.baseUrl);
  const current = loadProvidersSidecar().providers;
  const sanitized = sanitizeMiniMaxLike(input);
  const next: ModelProviderConfig = { ...current, [providerId]: sanitized };
  validateProviderBaseUrl(sanitized.baseUrl);
  saveProvidersSidecar(next);
  return next;
}