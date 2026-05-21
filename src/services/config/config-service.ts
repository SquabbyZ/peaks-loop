import { closeSync, constants, existsSync, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ConfigGetOptions, ConfigLayer, ConfigSetOptions, MiniMaxProviderConfig, ModelPreference, ModelProviderConfig, PeaksConfig, ProxyConfig, TokenConfig, TokenRef, WorkspaceConfig } from './config-types.js';
import { DEFAULT_CONFIG } from './config-types.js';
import { stablePath } from '../../shared/path-utils.js';

function getUserConfigPath(): string {
  return resolve(homedir(), '.peaks', 'config.json');
}

function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function isSafeProjectConfigMarker(projectRoot: string): boolean {
  const peaksPath = resolve(projectRoot, '.peaks');
  const markerPath = resolve(peaksPath, 'config.json');
  try {
    const projectRootReal = realpathSync(projectRoot);
    const peaksReal = realpathSync(peaksPath);
    const markerReal = realpathSync(markerPath);
    if (!isInsidePath(peaksReal, projectRootReal)) return false;
    if (!isInsidePath(markerReal, projectRootReal)) return false;
    return isInsidePath(markerReal, peaksReal);
  } catch {
    return false;
  }
}

function normalizeBoundaryPath(path: string): string {
  const resolved = resolve(path);
  let realPath = resolved;
  try {
    realPath = existsSync(resolved) ? realpathSync.native(resolved) : resolved;
  } catch {
    realPath = resolved;
  }
  return process.platform === 'win32' || process.platform === 'darwin' ? realPath.toLowerCase() : realPath;
}

function getHomeBoundaryPaths(): Set<string> {
  return new Set([homedir(), process.env.HOME, process.env.USERPROFILE].filter((path): path is string => typeof path === 'string' && path.length > 0).map(normalizeBoundaryPath));
}

function findProjectRoot(startPath: string): string | null {
  const homeBoundaryPaths = getHomeBoundaryPaths();
  let current = resolve(startPath);
  let parent = dirname(current);

  while (current !== parent && !homeBoundaryPaths.has(normalizeBoundaryPath(current))) {
    if (existsSync(resolve(current, '.peaks', 'config.json')) && isSafeProjectConfigMarker(current)) {
      return current;
    }
    parent = current;
    current = dirname(parent);
  }

  return null;
}

export function resolveProjectRootForConfig(startPath: string): string {
  const start = resolve(startPath);
  const homeBoundaryPaths = getHomeBoundaryPaths();
  let current = start;
  let parent = dirname(current);

  while (current !== parent && !homeBoundaryPaths.has(normalizeBoundaryPath(current))) {
    if (existsSync(resolve(current, '.peaks', 'config.json')) && isSafeProjectConfigMarker(current)) {
      return current;
    }
    if (existsSync(resolve(current, 'package.json')) || existsSync(resolve(current, '.git'))) {
      return current;
    }
    parent = current;
    current = dirname(parent);
  }

  return start;
}

function getProjectConfigPath(projectRoot: string | null): string | null {
  if (!projectRoot) return null;
  if (!isSafeProjectConfigMarker(projectRoot)) return null;
  return resolve(projectRoot, '.peaks', 'config.json');
}

function getProjectBootstrapConfigPath(projectRoot: string): string {
  const projectRootPath = resolve(projectRoot);
  const peaksPath = resolve(projectRootPath, '.peaks');
  const configPath = resolve(peaksPath, 'config.json');
  if (!isInsidePath(configPath, projectRootPath)) {
    throw new Error('Project config path must stay inside the project root');
  }

  if (!existsSync(peaksPath)) {
    mkdirSync(peaksPath, { recursive: true });
  }

  validateProjectBootstrapConfigPath(projectRootPath, peaksPath, configPath);
  return configPath;
}

function validateProjectBootstrapConfigPath(projectRootPath: string, peaksPath: string, configPath: string): void {
  const projectRootReal = realpathSync(projectRootPath);
  const peaksStats = lstatSync(peaksPath);
  const peaksReal = realpathSync(peaksPath);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(projectRootReal, '.peaks')) {
    throw new Error('Project config path must stay inside the project root');
  }

  try {
    const markerStats = lstatSync(configPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error('Project config path must stay inside the project root');
    }
    const markerReal = realpathSync(configPath);
    if (!isInsidePath(markerReal, projectRootReal) || !isInsidePath(markerReal, peaksReal)) {
      throw new Error('Project config path must stay inside the project root');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function validateProjectBootstrapConfigPathForWrite(projectRoot: string, configPath: string): void {
  const projectRootPath = resolve(projectRoot);
  validateProjectBootstrapConfigPath(projectRootPath, resolve(projectRootPath, '.peaks'), configPath);
}

function validateUserConfigPathForWrite(configPath: string): void {
  const userRoot = resolve(homedir());
  const peaksPath = resolve(userRoot, '.peaks');
  const userRootReal = realpathSync(userRoot);
  const peaksStats = lstatSync(peaksPath);
  const peaksReal = realpathSync(peaksPath);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(userRootReal, '.peaks')) {
    throw new Error('User config path must stay inside the user root');
  }

  try {
    const markerStats = lstatSync(configPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error('User config path must stay inside the user root');
    }
    const markerReal = realpathSync(configPath);
    if (!isInsidePath(markerReal, userRootReal) || !isInsidePath(markerReal, peaksReal)) {
      throw new Error('User config path must stay inside the user root');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function validateArtifactWorkspaceRoot(artifactRoot: string, workspaceRoot: string): void {
  const artifactStats = lstatSync(artifactRoot);
  if (!artifactStats.isDirectory() || artifactStats.isSymbolicLink()) {
    throw new Error('Artifact workspace marker must stay inside the artifact workspace');
  }
  const artifactRootReal = realpathSync(artifactRoot);
  const workspaceRootReal = realpathSync(workspaceRoot);
  if (isInsidePath(artifactRootReal, workspaceRootReal)) {
    throw new Error('Artifact workspace must stay outside the project root');
  }
}

function validateArtifactWorkspaceMarkerPath(artifactRoot: string, peaksPath: string, markerPath: string): void {
  const artifactStats = lstatSync(artifactRoot);
  if (!artifactStats.isDirectory() || artifactStats.isSymbolicLink()) {
    throw new Error('Artifact workspace marker must stay inside the artifact workspace');
  }
  const artifactRootReal = realpathSync(artifactRoot);
  const peaksStats = lstatSync(peaksPath);
  const peaksReal = realpathSync(peaksPath);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(artifactRootReal, '.peaks')) {
    throw new Error('Artifact workspace marker must stay inside the artifact workspace');
  }

  try {
    const markerStats = lstatSync(markerPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error('Artifact workspace marker must stay inside the artifact workspace');
    }
    if (markerStats.nlink !== 1) {
      throw new Error('Config path must not be hardlinked');
    }
    const markerReal = realpathSync(markerPath);
    if (!isInsidePath(markerReal, artifactRootReal) || !isInsidePath(markerReal, peaksReal)) {
      throw new Error('Artifact workspace marker must stay inside the artifact workspace');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function validateOpenConfigFile(fd: number, configPath: string, errorMessage: string): void {
  const fdStats = fstatSync(fd);
  const pathStats = lstatSync(configPath);
  if (!fdStats.isFile() || !pathStats.isFile() || fdStats.dev !== pathStats.dev || fdStats.ino !== pathStats.ino) {
    throw new Error(errorMessage);
  }
  if (fdStats.nlink !== 1 || pathStats.nlink !== 1) {
    throw new Error('Config path must not be hardlinked');
  }
}

function writeConfigFileSafely(configPath: string, content: string, validateBeforeWrite: () => void, errorMessage: string): void {
  validateBeforeWrite();
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new Error('Safe config writes require O_NOFOLLOW support');
  }

  const fd = openSync(configPath, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    validateBeforeWrite();
    validateOpenConfigFile(fd, configPath, errorMessage);
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, content, 'utf-8');
  } finally {
    closeSync(fd);
  }
}

function writeProjectConfigFile(projectRoot: string, configPath: string, content: string): void {
  writeConfigFileSafely(configPath, content, () => validateProjectBootstrapConfigPathForWrite(projectRoot, configPath), 'Project config path must stay inside the project root');
}

function writeUserConfigFile(configPath: string, content: string): void {
  writeConfigFileSafely(configPath, content, () => validateUserConfigPathForWrite(configPath), 'User config path must stay inside the user root');
}

function readJsonFile(path: string | null): Partial<PeaksConfig> | null {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Partial<PeaksConfig>;
  } catch {
    return null;
  }
}

function readExistingJsonFile(path: string, errorMessage: string): Partial<PeaksConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Partial<PeaksConfig>;
  } catch {
    throw new Error(errorMessage);
  }
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

function toSafeConfigSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/\.+$/g, '');
  return isSafeConfigSegment(normalized) ? normalized : 'workspace';
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

function mergeWorkspaceConfigs(userWorkspaces: WorkspaceConfig[], projectWorkspaces: WorkspaceConfig[]): WorkspaceConfig[] {
  const merged = new Map(userWorkspaces.map((workspace) => [workspace.workspaceId, workspace]));
  for (const workspace of projectWorkspaces) {
    if (!merged.has(workspace.workspaceId)) {
      merged.set(workspace.workspaceId, workspace);
    }
  }
  return [...merged.values()];
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

function getProjectWritePath(): string {
  return getProjectWriteTarget().configPath;
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
  return toMiniMaxProviderConfig(readJsonFile(getUserConfigPath())?.providers?.minimax);
}

export function getMiniMaxProviderStatus(): MiniMaxProviderStatus {
  return createMiniMaxProviderStatus(getMiniMaxProviderConfig());
}

export function setMiniMaxProviderConfig(input: MiniMaxProviderConfig): MiniMaxProviderStatus {
  validateMiniMaxBaseUrl(input.baseUrl);
  const userConfig = readJsonFile(getUserConfigPath()) ?? {};
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
    ...(typeof value.currentWorkspace === 'string' ? { currentWorkspace: value.currentWorkspace } : {}),
    ...(Array.isArray(value.workspaces) ? { workspaces: toWorkspaceConfigs(value.workspaces) } : {}),
    ...(typeof value.language === 'string' ? { language: value.language } : {}),
    ...(typeof value.model === 'string' && ['haiku', 'sonnet', 'opus', 'minimax'].includes(value.model) ? { model: value.model as ModelPreference } : {}),
    ...(typeof value.economyMode === 'boolean' ? { economyMode: value.economyMode } : {}),
    ...(typeof value.swarmMode === 'boolean' ? { swarmMode: value.swarmMode } : {}),
    ...(isRecord(value.tokens) ? { tokens: toTokenConfig(value.tokens) } : {}),
    ...(isRecord(value.providers) ? { providers: toModelProviderConfig(value.providers) } : {}),
    ...(proxy ? { proxy } : {})
  };
}

export function bootstrapProjectLanguageConfig(projectRoot: string, language: string): void {
  const inferredLanguage = inferHumanLanguage(language);
  const projectPath = getProjectBootstrapConfigPath(projectRoot);
  const existing = readExistingJsonFile(projectPath, 'Project config must contain valid JSON') ?? {};
  if (typeof existing.language === 'string' && existing.language.trim().length > 0) {
    return;
  }
  writeProjectConfigFile(projectRoot, projectPath, JSON.stringify({ ...existing, language: inferredLanguage }, null, 2));
}

export function readConfig(projectRoot?: string | null): PeaksConfig {
  const detectedRoot = projectRoot ?? findProjectRoot(process.cwd());
  const userPath = getUserConfigPath();
  const projectPath = getProjectConfigPath(detectedRoot);

  const userConfig = toPeaksConfig(readJsonFile(userPath));
  const projectConfig = removeProjectSensitiveConfig(toPeaksConfig(readJsonFile(projectPath)));
  const { proxy: projectProxy, workspaces: projectWorkspaces, ...projectConfigWithoutProxy } = projectConfig;
  const userWorkspaces = userConfig.workspaces ?? [];

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    ...projectConfigWithoutProxy,
    workspaces: mergeWorkspaceConfigs(userWorkspaces, projectWorkspaces ?? [])
  } as PeaksConfig;
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
    const existing = readJsonFile(configPath) ?? {};
    const merged = { ...existing, ...partial };
    writeProjectConfigFile(projectRoot, configPath, JSON.stringify(merged, null, 2));
    return;
  }

  const userPath = getUserConfigPath();
  ensureDir(dirname(userPath));
  const existing = readJsonFile(userPath) ?? {};
  const merged = { ...existing, ...partial };
  writeUserConfigFile(userPath, JSON.stringify(merged, null, 2));
}

export function getConfig(options: ConfigGetOptions = {}): unknown {
  const projectRoot = findProjectRoot(process.cwd());
  const userConfig = readJsonFile(getUserConfigPath()) ?? {};
  const projectConfig = removeProjectSensitiveConfig(readJsonFile(getProjectConfigPath(projectRoot)) ?? {});
  const { proxy: projectProxy, workspaces: projectWorkspaces, ...projectConfigWithoutProxy } = projectConfig;
  const source = options.layer === 'user'
    ? userConfig
    : options.layer === 'project'
      ? projectConfig
      : {
        ...userConfig,
        ...projectConfigWithoutProxy,
        workspaces: mergeWorkspaceConfigs(toWorkspaceConfigs(userConfig.workspaces), toWorkspaceConfigs(projectWorkspaces))
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
  const existing = readJsonFile(targetPath) ?? {};
  const updated = { ...existing };
  setNestedValue(updated, options.key, options.value);
  const content = JSON.stringify(updated, null, 2);
  if (projectTarget) {
    writeProjectConfigFile(projectTarget.projectRoot, targetPath, content);
  } else {
    writeUserConfigFile(targetPath, content);
  }
}

export function getWorkspaceConfig(workspaceId: string, projectRoot?: string | null): WorkspaceConfig | null {
  const config = readConfig(projectRoot ?? findProjectRoot(process.cwd()));
  return config.workspaces.find((w) => w.workspaceId === workspaceId) ?? null;
}

function readLayerConfig(layer: ConfigLayer): { currentWorkspace: string | null; workspaces: WorkspaceConfig[] } {
  const config = getConfig({ layer });
  return isRecord(config)
    ? {
      currentWorkspace: typeof config.currentWorkspace === 'string' ? config.currentWorkspace : null,
      workspaces: toWorkspaceConfigs(config.workspaces)
    }
    : { currentWorkspace: null, workspaces: [] };
}

export function addWorkspace(workspace: WorkspaceConfig, layer: ConfigLayer = 'user'): void {
  if (!isSafeConfigSegment(workspace.workspaceId)) {
    throw new Error('Workspace id must only contain letters, numbers, dots, underscores, or hyphens and must not contain path traversal');
  }
  const config = readLayerConfig(layer);
  const workspaces = config.workspaces;
  const existing = workspaces.findIndex((w) => w.workspaceId === workspace.workspaceId);
  const updatedWorkspaces = existing >= 0
    ? workspaces.map((existingWorkspace) => existingWorkspace.workspaceId === workspace.workspaceId ? workspace : existingWorkspace)
    : [...workspaces, workspace];
  writeConfig({ workspaces: updatedWorkspaces }, layer);
}

export function removeWorkspace(workspaceId: string, layer: ConfigLayer = 'user'): boolean {
  if (!isSafeConfigSegment(workspaceId)) return false;
  const config = readLayerConfig(layer);
  const workspaces = config.workspaces;
  const idx = workspaces.findIndex((w) => w.workspaceId === workspaceId);
  if (idx < 0) return false;

  const updatedWorkspaces = workspaces.filter((w) => w.workspaceId !== workspaceId);
  const currentWorkspace = config.currentWorkspace === workspaceId ? updatedWorkspaces[0]?.workspaceId ?? null : config.currentWorkspace ?? null;

  writeConfig({ workspaces: updatedWorkspaces, currentWorkspace }, layer);
  return true;
}

export function setCurrentWorkspace(workspaceId: string, layer: ConfigLayer = 'user'): boolean {
  if (!isSafeConfigSegment(workspaceId)) return false;
  const config = readLayerConfig(layer);
  const workspaces = config.workspaces;
  const exists = workspaces.some((w) => w.workspaceId === workspaceId);
  if (!exists) return false;

  writeConfig({ currentWorkspace: workspaceId }, layer);
  return true;
}

export function getCurrentWorkspaceConfig(): WorkspaceConfig | null {
  const config = readConfig();
  if (!config.currentWorkspace) return null;
  return getWorkspaceConfig(config.currentWorkspace);
}

export function getWorkspaceConfigForPath(path = process.cwd()): WorkspaceConfig | null {
  const config = readConfig(findProjectRoot(path));
  return findWorkspaceForPath(config.workspaces, path);
}

function createWorkspaceId(projectRoot: string, existingIds: Set<string>): string {
  const base = toSafeConfigSegment(basename(projectRoot));
  if (!existingIds.has(base)) return base;

  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
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
  return workspace.artifactStorage?.localPath ? resolve(workspace.artifactStorage.localPath) : resolve(homedir(), '.peaks', 'workspaces', workspace.workspaceId, 'artifacts');
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
    if (!config.currentWorkspace) {
      writeConfig({ currentWorkspace: existingWorkspace.workspaceId }, 'user');
    }
    return existingWorkspace;
  }

  const existingIds = new Set(config.workspaces.map((workspace) => workspace.workspaceId));
  const workspaceId = createWorkspaceId(projectRoot, existingIds);
  const workspace: WorkspaceConfig = {
    workspaceId,
    name: basename(projectRoot) || 'Workspace',
    rootPath: stablePath(projectRoot),
    artifactStorage: { mode: 'local', localPath: resolve(homedir(), '.peaks', 'workspaces', workspaceId, 'artifacts') },
    installedCapabilityIds: []
  };
  ensureArtifactWorkspaceMarker(workspace);
  const updatedWorkspaces = [...config.workspaces, workspace];
  writeConfig({ workspaces: updatedWorkspaces, ...(!config.currentWorkspace ? { currentWorkspace: workspace.workspaceId } : {}) }, 'user');
  return workspace;
}

export function getWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return getWorkspaceConfigForPath(process.cwd());
}

export function ensureWorkspaceConfigForCurrentPath(): WorkspaceConfig | null {
  return ensureWorkspaceConfigForPath(process.cwd());
}

export type { TokenRef, WorkspaceConfig, PeaksConfig, ConfigLayer };