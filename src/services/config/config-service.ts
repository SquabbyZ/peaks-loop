import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ConfigGetOptions, ConfigLayer, ConfigSetOptions, ConfigV2, MiniMaxProviderConfig, ModelPreference, ModelProviderConfig, OcrAuthHeader, OcrConfig, OcrLlmConfig, PeaksConfig, ProxyConfig, TokenConfig, TokenRef, WorkspaceConfig } from './config-types.js';
import { DEFAULT_CONFIG } from './config-types.js';
import { stablePath } from '../../shared/path-utils.js';
import { findProjectRoot, getProjectBootstrapConfigPath, getProjectConfigPath, getUserConfigPath, isInsidePath, readConfigFileSafely, resolveCanonicalProjectRoot, resolveProjectRootForConfig, validateArtifactWorkspaceMarkerPath, validateArtifactWorkspaceRoot, validateProjectBootstrapConfigPathForWrite, validateUserConfigPathForWrite, writeConfigFileSafely, writeProjectConfigFile, writeUserConfigFile } from './config-safety.js';
import { globalConfigPath, CONFIG_SCHEMA_VERSION_V2 } from './config-migration.js';
import { isConfigV2 } from './config-types.js';
import { providersConfigPath, proxyConfigPath, readSidecarJson, sidecarExists, workspacesConfigPath, writeSidecarJson } from './sidecar-store.js';
import { SIDECAR_SCHEMA_VERSION } from './sidecar-store.js';

// Re-export resolveProjectRootForConfig and resolveCanonicalProjectRoot for external consumers
export { resolveProjectRootForConfig, resolveCanonicalProjectRoot } from './config-safety.js';

/**
 * Load the slim 2.0 `~/.peaks/config.json` file. Returns the parsed
 * object when the file is at schema 2.0.0; returns null when the
 * file is absent (fresh install, no global config yet).
 *
 * Throws `CONFIG_LEGACY_VERSION` when the file exists at a 1.x
 * schema version — the caller is expected to run
 * `peaks config migrate --apply` to bring it forward before
 * continuing. This gate is intentional: a slim 2.0 reader must
 * not silently pass through a 1.x shape, because every field it
 * ignores is a field the caller is going to look for elsewhere
 * (preferences.json, .bak, _state/).
 */
export function loadGlobalConfig(): ConfigV2 | null {
  const path = globalConfigPath();
  if (!existsSync(path)) return null;
  const content = readConfigFileSafely(path, 'Global config path must stay inside the user root');
  const raw = JSON.parse(content) as Record<string, unknown>;
  if (isConfigV2(raw)) {
    if (hasLegacyGlobalFields(raw)) {
      promoteLegacyGlobalFieldsToSidecars(raw);
      rewriteSlimGlobalConfig();
    }
    return readSlimGlobalConfig();
  }
  const detected = typeof raw.version === 'string' ? raw.version : 'unknown';
  throw new Error(
    `CONFIG_LEGACY_VERSION: ~/.peaks/config.json is at version "${detected}", expected ${CONFIG_SCHEMA_VERSION_V2}. Run \`peaks config migrate --apply\`.`
  );
}

/**
 * Slim 2.0 schema allows `version` + `ocr` + `companion`. The
 * `companion` block was added in slice
 * 2026-06-14-cc-connect-weixin (change-1) so cc-connect settings
 * live in `~/.peaks/config.json` (the source of truth) instead of
 * being scattered between peaks config + a sidecar txt cache. Any
 * other top-level field is a legacy artifact that needs to be
 * promoted to a sidecar file.
 */
function hasLegacyGlobalFields(raw: Record<string, unknown>): boolean {
  const allowed = new Set(['version', 'ocr', 'companion']);
  return Object.keys(raw).some((k) => !allowed.has(k));
}

/**
 * One-shot promotion of legacy fields into their dedicated sidecar
 * files. Idempotent: if the sidecar already has the field, the
 * legacy value is dropped (sidecar is the new source of truth).
 */
function promoteLegacyGlobalFieldsToSidecars(raw: Record<string, unknown>): void {
  if (isRecord(raw.providers)) {
    const existing = readSidecarJson<Partial<ProvidersSidecarShape>>(providersConfigPath(), { version: SIDECAR_SCHEMA_VERSION, providers: {} });
    const mergedProviders = { ...(existing.providers ?? {}), ...(raw.providers as Record<string, unknown>) };
    writeSidecarJson(providersConfigPath(), { version: SIDECAR_SCHEMA_VERSION, providers: mergedProviders });
  }
  if (isRecord(raw.proxy) && typeof (raw.proxy as Record<string, unknown>).httpProxy === 'string') {
    const httpProxy = (raw.proxy as Record<string, unknown>).httpProxy as string;
    if (!sidecarExists(proxyConfigPath())) {
      writeSidecarJson(proxyConfigPath(), { version: SIDECAR_SCHEMA_VERSION, httpProxy });
    }
  }
  if (Array.isArray(raw.workspaces) || typeof raw.currentWorkspace === 'string') {
    if (!sidecarExists(workspacesConfigPath())) {
      writeSidecarJson(workspacesConfigPath(), {
        version: SIDECAR_SCHEMA_VERSION,
        workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
        currentWorkspace: typeof raw.currentWorkspace === 'string' ? raw.currentWorkspace : null
      });
    }
  }
}

type ProvidersSidecarShape = { version: string; providers: Record<string, unknown> };

function readSlimGlobalConfig(): ConfigV2 {
  const path = globalConfigPath();
  if (!existsSync(path)) {
    return { version: CONFIG_SCHEMA_VERSION_V2 };
  }
  const content = readConfigFileSafely(path, 'Global config path must stay inside the user root');
  return JSON.parse(content) as ConfigV2;
}

function rewriteSlimGlobalConfig(): void {
  const path = globalConfigPath();
  const ocr = readOcrFromRawConfigFile();
  const companion = readCompanionFromRawConfigFile();
  const slim: Record<string, unknown> = { version: CONFIG_SCHEMA_VERSION_V2 };
  if (ocr !== null) slim['ocr'] = ocr;
  if (companion !== null) slim['companion'] = companion;
  writeUserConfigFile(path, JSON.stringify(slim, null, 2) + '\n');
}

function readCompanionFromRawConfigFile(): Record<string, unknown> | null {
  const path = globalConfigPath();
  if (!existsSync(path)) return null;
  const content = readConfigFileSafely(path, 'Global config path must stay inside the user root');
  const raw = JSON.parse(content) as Record<string, unknown>;
  return isRecord(raw.companion) ? raw.companion : null;
}

function readOcrFromRawConfigFile(): Record<string, unknown> | null {
  const path = globalConfigPath();
  if (!existsSync(path)) return null;
  const content = readConfigFileSafely(path, 'Global config path must stay inside the user root');
  const raw = JSON.parse(content) as Record<string, unknown>;
  return isRecord(raw.ocr) ? raw.ocr : null;
}

function readJsonFile(path: string | null, validateBeforeRead?: () => void, errorMessage = 'Config path must stay inside the config root'): Partial<PeaksConfig> | null {
  if (!path || !existsSync(path)) return null;
  validateBeforeRead?.();
  const content = readConfigFileSafely(path, errorMessage);
  try {
    return JSON.parse(content) as Partial<PeaksConfig>;
  } catch {
    return null;
  }
}

function readExistingJsonFile(path: string, errorMessage: string, validateBeforeRead?: () => void): Partial<PeaksConfig> | null {
  if (!existsSync(path)) return null;
  validateBeforeRead?.();
  try {
    return JSON.parse(readConfigFileSafely(path, errorMessage)) as Partial<PeaksConfig>;
  } catch {
    throw new Error(errorMessage);
  }
}

function readUserJsonFile(): Partial<PeaksConfig> | null {
  const userPath = getUserConfigPath();
  return readJsonFile(userPath, () => validateUserConfigPathForWrite(userPath), 'User config path must stay inside the user root');
}

function readProjectJsonFile(projectRoot: string | null): Partial<PeaksConfig> | null {
  const projectPath = getProjectConfigPath(projectRoot);
  return readJsonFile(projectPath, projectRoot && projectPath ? () => validateProjectBootstrapConfigPathForWrite(projectRoot, projectPath) : undefined, 'Project config path must stay inside the project root');
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

const UNSAFE_NESTED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

function getNestedPathParts(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

function hasUnsafeNestedPathSegment(parts: string[]): boolean {
  return parts.some((part) => UNSAFE_NESTED_PATH_SEGMENTS.has(part));
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = getNestedPathParts(path);
  if (parts.length === 0 || hasUnsafeNestedPathSegment(parts)) {
    return undefined;
  }

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = getNestedPathParts(path);
  if (parts.length === 0 || hasUnsafeNestedPathSegment(parts)) {
    throw new Error('Unsafe config path');
  }

  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (!Object.prototype.hasOwnProperty.call(current, part) || typeof current[part] !== 'object' || current[part] === null || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] as string;
  current[last] = value;
}

function removeProjectSensitiveConfig(config: Partial<PeaksConfig>): Partial<PeaksConfig> {
  const { providers, proxy, tokens, ...safeConfig } = config;
  return Object.fromEntries(Object.entries(safeConfig).filter(([key, value]) => !isSecretKey(key) && !containsSensitiveConfigValue(value))) as Partial<PeaksConfig>;
}

export function isConfigLayer(value: string): value is ConfigLayer {
  return value === 'user' || value === 'project';
}

export function isSensitiveConfigPath(path: string): boolean {
  const normalized = path.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.includes('apikey') || normalized.includes('accesskey') || normalized.includes('privatekey') || normalized.includes('token') || normalized.includes('secret') || normalized.includes('password') || normalized.includes('bearer') || normalized.includes('credential') || normalized.includes('auth');
}

/**
 * 2.0.1 slim-config contract: `~/.peaks/config.json` only stores
 * `version` + `ocr.llm.*` placeholders. The 1.x → 2.0 migration
 * moved per-project fields (`language`, `model`, `economyMode`,
 * `swarmMode`) to `<project>/.peaks/preferences.json` (per spec
 * §10.4). `setConfig` rejects writes to those keys and points the
 * user to the preferences path; tokens / providers / proxy still
 * live in `~/.peaks/config.json` (the loader is tolerant of them
 * but does not synthesise defaults for them anymore).
 */
const LEGACY_CONFIG_KEYS: ReadonlySet<string> = new Set<string>([
  'language',
  'model',
  'economyMode',
  'swarmMode'
]);

export function isLegacyConfigKey(path: string): boolean {
  const topLevel = path.split(/[.[].*/, 1)[0] ?? '';
  return LEGACY_CONFIG_KEYS.has(topLevel);
}

function isProviderConfigPath(path: string): boolean {
  return path === 'providers' || path.startsWith('providers.');
}

function isSecretKey(key: string): boolean {
  return isSensitiveConfigPath(key);
}

function sanitizeBaseUrlForDisplay(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '[invalid-url-redacted]';
  }
}

const MINIMAX_API_HOST = 'api.minimaxi.com';

function isProviderBaseUrlPath(path: string): boolean {
  return /^providers\.[^.]+\.baseUrl$/.test(path);
}

function isValidProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0 && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

function isValidMiniMaxBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === MINIMAX_API_HOST && url.username.length === 0 && url.password.length === 0 && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

function getMiniMaxBaseUrlCandidate(key: string, value: unknown): unknown {
  if (key === 'providers.minimax.baseUrl') {
    return value;
  }
  if (key === 'providers.minimax' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Partial<MiniMaxProviderConfig>).baseUrl;
  }
  if (key === 'providers' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Partial<ModelProviderConfig>).minimax?.baseUrl;
  }
  return undefined;
}

function validateProviderBaseUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidProviderBaseUrl(value))) {
    throw new Error('Provider base URL must be HTTPS without embedded credentials, query, or fragment');
  }
}

function validateMiniMaxBaseUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidMiniMaxBaseUrl(value))) {
    throw new Error('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
  }
}

function getProxyUrlCandidate(key: string, value: unknown): unknown {
  if (key === 'proxy.httpProxy') {
    return value;
  }
  if (key === 'proxy' && isRecord(value)) {
    return value.httpProxy;
  }
  return undefined;
}

function isProxyConfigPath(path: string): boolean {
  return path === 'proxy' || path.startsWith('proxy.');
}

function validateModelProviderConfig(providers: ModelProviderConfig): void {
  validateMiniMaxBaseUrl(providers.minimax?.baseUrl);
  for (const [providerId, provider] of Object.entries(providers)) {
    if (providerId !== 'minimax') {
      validateProviderBaseUrl(provider?.baseUrl);
    }
  }
}

function validateProviderConfig(partial: Partial<PeaksConfig>): void {
  validateModelProviderConfig(partial.providers ?? {});
}

function isValidProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username.length === 0 && url.password.length === 0 && url.pathname === '/' && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

function validateProxyUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidProxyUrl(value))) {
    throw new Error('Proxy URL must be an HTTP or HTTPS URL without embedded credentials');
  }
}

function validateProxyConfig(partial: Partial<PeaksConfig>): void {
  validateProxyUrl(partial.proxy?.httpProxy);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeConfigSegment(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..') && !value.endsWith('.');
}

function toArtifactRemoteRepoConfig(value: unknown): WorkspaceConfig['artifactRepo'] | null {
  if (!isRecord(value) || (value.provider !== 'github' && value.provider !== 'gitlab') || typeof value.owner !== 'string' || typeof value.name !== 'string') {
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
  if (typeof workspaceId !== 'string' || !isSafeConfigSegment(workspaceId) || typeof name !== 'string' || typeof rootPath !== 'string' || !Array.isArray(installedCapabilityIds) || !installedCapabilityIds.every((id) => typeof id === 'string')) {
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

function toWorkspaceConfigs(value: unknown): WorkspaceConfig[] {
  return Array.isArray(value) ? value.map(toWorkspaceConfig).filter((workspace): workspace is WorkspaceConfig => workspace !== null) : [];
}

function toProviderModelConfig(value: unknown): MiniMaxProviderConfig {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.model === 'string' && value.model.trim().length > 0 ? { model: value.model.trim() } : {}),
    ...(typeof value.baseUrl === 'string' ? { baseUrl: value.baseUrl } : {}),
    ...(typeof value.apiKey === 'string' ? { apiKey: value.apiKey } : {})
  };
}

function toMiniMaxProviderConfig(value: unknown): MiniMaxProviderConfig {
  return toProviderModelConfig(value);
}

const TOKEN_CONFIG_KEYS = new Set<keyof TokenConfig>(['AnthropicApiKey', 'OpenAiApiKey', 'GitHubToken', 'GitLabToken']);

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

function toTokenConfig(value: unknown): TokenConfig {
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

function toModelProviderConfig(value: unknown): ModelProviderConfig {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([providerId, providerConfig]) => [providerId, toProviderModelConfig(providerConfig)]));
}

function toProxyConfig(value: unknown): ProxyConfig | null {
  if (!isRecord(value)) return null;
  return typeof value.httpProxy === 'string' && isValidProxyUrl(value.httpProxy) ? { httpProxy: value.httpProxy } : null;
}

function getProjectWriteTarget(): { projectRoot: string; configPath: string } {
  const projectRoot = findProjectRoot(process.cwd());
  const configPath = getProjectConfigPath(projectRoot);
  if (!projectRoot || !configPath) {
    throw new Error('Project config not found');
  }
  return { projectRoot, configPath };
}

export function containsSensitiveConfigValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSensitiveConfigValue);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(([key, entry]) => isSecretKey(key) || containsSensitiveConfigValue(entry));
}

export type RedactedConfigValue = string | number | boolean | null | RedactedConfigValue[] | { [key: string]: RedactedConfigValue };

export function redactConfigSecrets(value: unknown, path = ''): RedactedConfigValue {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactConfigSecrets(item, `${path}[${index}]`));
  }
  if (value === null || typeof value !== 'object') {
    if (isProviderBaseUrlPath(path) && typeof value === 'string') {
      return sanitizeBaseUrlForDisplay(value);
    }
    return value as RedactedConfigValue;
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    const nextPath = path ? `${path}.${key}` : key;
    if (isSecretKey(key)) {
      return [key, '***'];
    }
    if (isProviderBaseUrlPath(nextPath) && typeof entry === 'string') {
      return [key, sanitizeBaseUrlForDisplay(entry)];
    }
    return [key, redactConfigSecrets(entry, nextPath)];
  }));
}

export type MiniMaxProviderStatus = {
  provider: 'minimax';
  configured: boolean;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  storage: 'user-plaintext-v1';
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
    storage: 'user-plaintext-v1',
    nextActions: baseUrlConfigured && apiKeyConfigured ? [] : ['Export MINIMAX_API_KEY and rerun peaks config provider minimax set --base-url <url>']
  };
}

export function getMiniMaxProviderConfig(): MiniMaxProviderConfig {
  return toMiniMaxProviderConfig(readUserJsonFile()?.providers?.minimax);
}

export function getMiniMaxProviderStatus(): MiniMaxProviderStatus {
  return createMiniMaxProviderStatus(getMiniMaxProviderConfig());
}

export function setMiniMaxProviderConfig(input: MiniMaxProviderConfig): MiniMaxProviderStatus {
  validateMiniMaxBaseUrl(input.baseUrl);
  const userConfig = readUserJsonFile() ?? {};
  const existingProviders = toModelProviderConfig(userConfig.providers);
  const providers: ModelProviderConfig = {
    ...existingProviders,
    minimax: {
      ...existingProviders.minimax,
      ...input
    }
  };
  validateMiniMaxBaseUrl(providers.minimax?.baseUrl);
  writeConfig({ providers }, 'user');
  return createMiniMaxProviderStatus(providers.minimax ?? {});
}

const OCR_AUTH_HEADERS: ReadonlySet<OcrAuthHeader> = new Set<OcrAuthHeader>(['authorization', 'x-api-key', 'bearer']);

function toOcrLlmConfig(value: unknown): OcrLlmConfig {
  if (!isRecord(value)) return {};
  const url = typeof value.url === 'string' && value.url.trim().length > 0 ? value.url.trim() : undefined;
  const authToken = typeof value.authToken === 'string' && value.authToken.length > 0 ? value.authToken : undefined;
  const model = typeof value.model === 'string' && value.model.trim().length > 0 ? value.model.trim() : undefined;
  const useAnthropic = typeof value.useAnthropic === 'boolean' ? value.useAnthropic : undefined;
  const rawAuthHeader = typeof value.authHeader === 'string' ? value.authHeader : undefined;
  const authHeader = rawAuthHeader !== undefined && OCR_AUTH_HEADERS.has(rawAuthHeader as OcrAuthHeader)
    ? (rawAuthHeader as OcrAuthHeader)
    : undefined;
  return {
    ...(url !== undefined ? { url } : {}),
    ...(authToken !== undefined ? { authToken } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(useAnthropic !== undefined ? { useAnthropic } : {}),
    ...(authHeader !== undefined ? { authHeader } : {})
  };
}

function toOcrConfig(value: unknown): OcrConfig {
  if (!isRecord(value)) return {};
  return {
    ...(isRecord(value.llm) ? { llm: toOcrLlmConfig(value.llm) } : {})
  };
}

/**
 * Read the ocr LLM endpoint config from the user-layer
 * `~/.peaks/config.json`. The user populates this themselves by
 * pasting the `peaks code-review config-template` output (or by
 * running `peaks config set --key ocr.llm.url --value '...'`).
 * peaks-cli never auto-writes these values.
 */
export function getOcrConfig(): OcrConfig {
  const userConfig = readUserJsonFile() ?? {};
  return toOcrConfig(userConfig.ocr);
}

/**
 * Return the resolved `OcrLlmConfig` block (`peaksConfig.ocr.llm`)
 * or `null` when the user has not populated the user config. The
 * 5-state OCR detector uses this as the source of truth; when the
 * returned block is missing required fields it produces a
 * `config-missing` state with a templated `nextActions` payload
 * the user can paste into their config.
 */
export function getOcrLlmConfig(): OcrLlmConfig | null {
  const ocr = getOcrConfig();
  if (!ocr.llm) return null;
  return ocr.llm;
}

function inferHumanLanguage(value: string): string {
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

function toPeaksConfig(value: unknown): Partial<PeaksConfig> {
  if (!isRecord(value)) return {};
  const proxy = toProxyConfig(value.proxy);
  return {
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    ...(typeof value.model === 'string' && ['haiku', 'sonnet', 'opus', 'minimax'].includes(value.model) ? { model: value.model as ModelPreference } : {}),
    ...(typeof value.economyMode === 'boolean' ? { economyMode: value.economyMode } : {}),
    ...(typeof value.swarmMode === 'boolean' ? { swarmMode: value.swarmMode } : {}),
    ...(isRecord(value.tokens) ? { tokens: toTokenConfig(value.tokens) } : {}),
    ...(isRecord(value.providers) ? { providers: toModelProviderConfig(value.providers) } : {}),
    ...(proxy ? { proxy } : {}),
    ...(isRecord(value.companion) ? { companion: toCompanionConfig(value.companion) } : {})
  };
}

const COMPANION_CHANNELS: ReadonlySet<string> = new Set(['weixin']);
const COMPANION_BINARY_SOURCES: ReadonlySet<string> = new Set(['node-modules', 'path']);

function toCompanionWeixinConfig(value: Record<string, unknown>): { ilinkQrPayload: string; loginTimeoutSec: number } {
  const ilinkQrPayload = typeof value.ilinkQrPayload === 'string' && value.ilinkQrPayload.trim().length > 0
    ? value.ilinkQrPayload.trim()
    : 'ilink://peaks-cli?project=default';
  const loginTimeoutSec = typeof value.loginTimeoutSec === 'number' && Number.isFinite(value.loginTimeoutSec) && value.loginTimeoutSec > 0
    ? Math.floor(value.loginTimeoutSec)
    : 60;
  return { ilinkQrPayload, loginTimeoutSec };
}

function toCompanionConfig(value: Record<string, unknown>): import('./config-types.js').CompanionConfig {
  const enabled = typeof value.enabled === 'boolean' ? value.enabled : false;
  const defaultChannel: 'weixin' = typeof value.defaultChannel === 'string' && COMPANION_CHANNELS.has(value.defaultChannel) ? (value.defaultChannel as 'weixin') : 'weixin';
  const binaryPath = typeof value.binaryPath === 'string' && value.binaryPath.trim().length > 0 ? value.binaryPath.trim() : null;
  const binaryPathSource: 'node-modules' | 'path' | null = typeof value.binaryPathSource === 'string' && COMPANION_BINARY_SOURCES.has(value.binaryPathSource) ? (value.binaryPathSource as 'node-modules' | 'path') : null;
  const configPath = typeof value.configPath === 'string' && value.configPath.trim().length > 0 ? value.configPath.trim() : '~/.cc-connect/config.toml';
  const autoStart = typeof value.autoStart === 'boolean' ? value.autoStart : false;
  const weixin = isRecord(value.weixin) ? toCompanionWeixinConfig(value.weixin as Record<string, unknown>) : { ilinkQrPayload: 'ilink://peaks-cli?project=default', loginTimeoutSec: 60 };
  return { enabled, defaultChannel, binaryPath, binaryPathSource, configPath, weixin, autoStart };
}

export function bootstrapProjectLanguageConfig(projectRoot: string, language: string): void {
  const inferredLanguage = inferHumanLanguage(language);
  const projectPath = getProjectBootstrapConfigPath(projectRoot);
  const existing = readExistingJsonFile(projectPath, 'Project config must contain valid JSON', () => validateProjectBootstrapConfigPathForWrite(projectRoot, projectPath)) ?? {};
  if (typeof existing.language === 'string' && existing.language.trim().length > 0) {
    return;
  }
  writeProjectConfigFile(projectRoot, projectPath, JSON.stringify({ ...existing, language: inferredLanguage }, null, 2));
}

export function readConfig(projectRoot?: string | null): PeaksConfig {
  const detectedRoot = projectRoot ?? findProjectRoot(process.cwd());
  const userConfig = toPeaksConfig(readUserJsonFile());
  const projectConfig = removeProjectSensitiveConfig(toPeaksConfig(readProjectJsonFile(detectedRoot)));
  const { proxy: projectProxy, ...projectConfigWithoutProxy } = projectConfig;

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    ...projectConfigWithoutProxy
  } as PeaksConfig;
}

function sanitizeWorkspacePartial(partial: Record<string, unknown>): Record<string, unknown> {
  const result = { ...partial };
  if (Array.isArray(result.workspaces)) {
    result.workspaces = toWorkspaceConfigs(result.workspaces);
  }
  if (typeof result.currentWorkspace !== 'string' && result.currentWorkspace !== null && result.currentWorkspace !== undefined) {
    delete result.currentWorkspace;
  }
  return result;
}

export function writeConfig(partial: Partial<PeaksConfig>, layer: ConfigLayer = 'user'): void {
  if (!isConfigLayer(layer)) {
    throw new Error('Invalid config layer');
  }
  if (layer === 'project' && (partial.providers !== undefined || partial.proxy !== undefined || containsSensitiveConfigValue(partial))) {
    throw new Error('Sensitive config keys must be stored in the user config layer');
  }
  validateProviderConfig(partial);
  validateProxyConfig(partial);

  if (layer === 'project') {
    const { projectRoot, configPath } = getProjectWriteTarget();
    ensureDir(dirname(configPath));
    const existing = readJsonFile(configPath, () => validateProjectBootstrapConfigPathForWrite(projectRoot, configPath)) ?? {};
    const merged = sanitizeWorkspacePartial({ ...existing, ...partial });
    writeProjectConfigFile(projectRoot, configPath, JSON.stringify(merged, null, 2));
    return;
  }

  const userPath = getUserConfigPath();
  ensureDir(dirname(userPath));
  const existing = readJsonFile(userPath, () => validateUserConfigPathForWrite(userPath)) ?? {};
  const merged = sanitizeWorkspacePartial({ ...existing, ...partial });
  writeUserConfigFile(userPath, JSON.stringify(merged, null, 2));
}

export function getConfig(options: ConfigGetOptions = {}): unknown {
  const projectRoot = findProjectRoot(process.cwd());
  const userConfig = readUserJsonFile() ?? {};
  const projectConfig = removeProjectSensitiveConfig(readProjectJsonFile(projectRoot) ?? {});
  const { proxy: projectProxy, ...projectConfigWithoutProxy } = projectConfig;
  const source = options.layer === 'user'
    ? userConfig
    : options.layer === 'project'
      ? projectConfig
      : {
        ...userConfig,
        ...projectConfigWithoutProxy
      };
  const config = isRecord(source) ? { ...source, ...(source.tokens !== undefined ? { tokens: toTokenConfig(source.tokens) } : {}) } : source;

  if (options.key !== undefined) {
    return getNestedValue(config as Record<string, unknown>, options.key);
  }

  return config;
}

export function setConfig(options: ConfigSetOptions): void {
  const layer = options.layer ?? 'user';
  if (!isConfigLayer(layer)) {
    throw new Error('Invalid config layer');
  }
  if (isLegacyConfigKey(options.key)) {
    throw new Error(
      `Legacy config key "${options.key}" is no longer stored in ~/.peaks/config.json. ` +
      'Set it under <project>/.peaks/preferences.json (e.g. `peaks preferences set --key <key> --value <value>`).'
    );
  }
  if (layer === 'project' && (isProviderConfigPath(options.key) || isProxyConfigPath(options.key) || isSensitiveConfigPath(options.key) || containsSensitiveConfigValue(options.value))) {
    throw new Error('Sensitive config keys must be stored in the user config layer');
  }
  validateMiniMaxBaseUrl(getMiniMaxBaseUrlCandidate(options.key, options.value));
  if (options.key === 'providers') {
    validateModelProviderConfig(toModelProviderConfig(options.value));
  } else if (options.key.startsWith('providers.') && !options.key.startsWith('providers.minimax.')) {
    const providerId = getNestedPathParts(options.key)[1];
    if (options.key === `providers.${providerId}`) {
      validateModelProviderConfig({ [providerId as string]: toProviderModelConfig(options.value) });
    } else if (isProviderBaseUrlPath(options.key)) {
      validateProviderBaseUrl(options.value);
    }
  }
  validateProxyUrl(getProxyUrlCandidate(options.key, options.value));

  const projectTarget = layer === 'project' ? getProjectWriteTarget() : null;
  const targetPath = projectTarget?.configPath ?? getUserConfigPath();

  ensureDir(dirname(targetPath));
  const existing = projectTarget
    ? readJsonFile(targetPath, () => validateProjectBootstrapConfigPathForWrite(projectTarget.projectRoot, targetPath)) ?? {}
    : readJsonFile(targetPath, () => validateUserConfigPathForWrite(targetPath)) ?? {};
  const updated = { ...existing };
  setNestedValue(updated, options.key, options.value);
  const content = JSON.stringify(updated, null, 2);
  if (projectTarget) {
    writeProjectConfigFile(projectTarget.projectRoot, targetPath, content);
  } else {
    writeUserConfigFile(targetPath, content);
  }
}

// Raw config helpers for workspace management functions that operate on
// fields (workspaces, currentWorkspace) no longer in the typed PeaksConfig schema.

interface RawWorkspaceData {
  currentWorkspace: string | null;
  workspaces: WorkspaceConfig[];
}

function readRawWorkspaceData(layer: ConfigLayer): RawWorkspaceData {
  const config = getConfig({ layer });
  return isRecord(config)
    ? {
      currentWorkspace: typeof config.currentWorkspace === 'string' ? config.currentWorkspace : null,
      workspaces: toWorkspaceConfigs(config.workspaces)
    }
    : { currentWorkspace: null, workspaces: [] };
}

function writeRawWorkspaceData(data: Partial<RawWorkspaceData>, layer: ConfigLayer): void {
  const projectTarget = layer === 'project' ? getProjectWriteTarget() : null;
  const targetPath = projectTarget?.configPath ?? getUserConfigPath();
  ensureDir(dirname(targetPath));
  const existing = projectTarget
    ? readJsonFile(targetPath, () => validateProjectBootstrapConfigPathForWrite(projectTarget.projectRoot, targetPath)) ?? {}
    : readJsonFile(targetPath, () => validateUserConfigPathForWrite(targetPath)) ?? {};
  const merged = { ...existing, ...data };
  const content = JSON.stringify(merged, null, 2);
  if (projectTarget) {
    writeProjectConfigFile(projectTarget.projectRoot, targetPath, content);
  } else {
    writeUserConfigFile(targetPath, content);
  }
}

function readAllWorkspaces(): { currentWorkspace: string | null; workspaces: WorkspaceConfig[] } {
  const userData = readRawWorkspaceData('user');
  const projectData = readRawWorkspaceData('project');
  const mergedWorkspaces = new Map<string, WorkspaceConfig>();
  for (const w of userData.workspaces) mergedWorkspaces.set(w.workspaceId, w);
  for (const w of projectData.workspaces) mergedWorkspaces.set(w.workspaceId, w);
  return {
    currentWorkspace: projectData.currentWorkspace ?? userData.currentWorkspace,
    workspaces: [...mergedWorkspaces.values()]
  };
}

export function getWorkspaceConfig(workspaceId: string, _projectRoot?: string | null): WorkspaceConfig | null {
  const { workspaces } = readAllWorkspaces();
  return workspaces.find((w) => w.workspaceId === workspaceId) ?? null;
}

function readLayerConfig(layer: ConfigLayer): { currentWorkspace: string | null; workspaces: WorkspaceConfig[] } {
  return readRawWorkspaceData(layer);
}

export function addWorkspace(workspace: WorkspaceConfig, layer: ConfigLayer = 'user'): void {
  if (!isSafeConfigSegment(workspace.workspaceId)) {
    throw new Error('Workspace id must only contain letters, numbers, dots, underscores, or hyphens and must not contain path traversal');
  }
  const config = readRawWorkspaceData(layer);
  const workspaces = config.workspaces;
  const existing = workspaces.findIndex((w) => w.workspaceId === workspace.workspaceId);
  const updatedWorkspaces = existing >= 0
    ? workspaces.map((existingWorkspace) => existingWorkspace.workspaceId === workspace.workspaceId ? workspace : existingWorkspace)
    : [...workspaces, workspace];
  writeRawWorkspaceData({ workspaces: updatedWorkspaces }, layer);
}

export function removeWorkspace(workspaceId: string, layer: ConfigLayer = 'user'): boolean {
  if (!isSafeConfigSegment(workspaceId)) return false;
  const config = readRawWorkspaceData(layer);
  const workspaces = config.workspaces;
  const idx = workspaces.findIndex((w) => w.workspaceId === workspaceId);
  if (idx < 0) return false;

  const updatedWorkspaces = workspaces.filter((w) => w.workspaceId !== workspaceId);
  const currentWorkspace = config.currentWorkspace === workspaceId ? updatedWorkspaces[0]?.workspaceId ?? null : config.currentWorkspace ?? null;

  writeRawWorkspaceData({ workspaces: updatedWorkspaces, currentWorkspace }, layer);
  return true;
}

export function setCurrentWorkspace(workspaceId: string, layer: ConfigLayer = 'user'): boolean {
  if (!isSafeConfigSegment(workspaceId)) return false;
  const config = readRawWorkspaceData(layer);
  const workspaces = config.workspaces;
  const exists = workspaces.some((w) => w.workspaceId === workspaceId);
  if (!exists) return false;

  writeRawWorkspaceData({ currentWorkspace: workspaceId }, layer);
  return true;
}

export function getCurrentWorkspaceConfig(): WorkspaceConfig | null {
  const { currentWorkspace, workspaces } = readAllWorkspaces();
  if (!currentWorkspace) return null;
  return workspaces.find((w) => w.workspaceId === currentWorkspace) ?? null;
}

export function getWorkspaceConfigForPath(path = process.cwd()): WorkspaceConfig | null {
  const { workspaces } = readAllWorkspaces();
  return findWorkspaceForPath(workspaces, path);
}

function findWorkspaceForPath(workspaces: WorkspaceConfig[], path: string): WorkspaceConfig | null {
  const targetPath = stablePath(path);
  const matches = workspaces.flatMap((workspace) => {
    if (!isAbsolute(workspace.rootPath) || !existsSync(workspace.rootPath)) return [];
    const rootPath = stablePath(workspace.rootPath);
    return isInsidePath(targetPath, rootPath) ? [{ workspace, rootPath }] : [];
  });
  if (matches.length === 0) return null;

  return matches.reduce((best, match) => match.rootPath.length > best.rootPath.length ? match : best).workspace;
}

function getWorkspaceArtifactRoot(workspace: WorkspaceConfig): string {
  return workspace.artifactStorage?.localPath ? resolve(workspace.artifactStorage.localPath) : resolve(workspace.rootPath, '.peaks', 'artifacts');
}

function ensureArtifactWorkspaceMarker(workspace: WorkspaceConfig): void {
  const artifactRoot = getWorkspaceArtifactRoot(workspace);
  const peaksPath = resolve(artifactRoot, '.peaks');
  const markerPath = resolve(peaksPath, 'config.json');
  ensureDir(artifactRoot);
  validateArtifactWorkspaceRoot(artifactRoot, workspace.rootPath);

  ensureDir(peaksPath);
  validateArtifactWorkspaceMarkerPath(artifactRoot, peaksPath, markerPath);
  if (!existsSync(markerPath)) {
    writeConfigFileSafely(markerPath, '{}\n', () => validateArtifactWorkspaceMarkerPath(artifactRoot, peaksPath, markerPath), 'Artifact workspace marker must stay inside the artifact workspace');
  }
}

export function ensureWorkspaceConfigForPath(path = process.cwd()): WorkspaceConfig | null {
  const projectRoot = resolveProjectRootForConfig(path);
  if (!isAbsolute(projectRoot) || !existsSync(projectRoot)) return null;

  const config = readLayerConfig('user');
  const existingWorkspace = findWorkspaceForPath(config.workspaces, path);
  if (existingWorkspace) {
    ensureArtifactWorkspaceMarker(existingWorkspace);
    return existingWorkspace;
  }

  return null;
}

export function getWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return getWorkspaceConfigForPath(process.cwd());
}

export function ensureWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return ensureWorkspaceConfigForPath(process.cwd());
}

export type { OcrAuthHeader, OcrConfig, OcrLlmConfig, TokenRef, WorkspaceConfig, PeaksConfig, ConfigLayer };
export { getUserConfigPath } from './config-safety.js';
export { globalConfigPath } from './config-migration.js';
