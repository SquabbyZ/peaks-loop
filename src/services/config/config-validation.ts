/**
 * Config key/URL validators and the secret-redaction surface.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
import { isRecord } from './config-primitives.js';
import type { ModelProviderConfig, PeaksConfig } from './config-types.js';

export function isSensitiveConfigPath(path: string): boolean {
  const normalized = path.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('privatekey') ||
    normalized.includes('token') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    normalized.includes('bearer') ||
    normalized.includes('credential') ||
    normalized.includes('auth')
  );
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
export function isProviderConfigPath(path: string): boolean {
  return path === 'providers' || path.startsWith('providers.');
}

export function isSecretKey(key: string): boolean {
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

export function isProviderBaseUrlPath(path: string): boolean {
  return /^providers\.[^.]+\.baseUrl$/.test(path);
}

function isValidProviderBaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function validateProviderBaseUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidProviderBaseUrl(value))) {
    throw new Error(
      'Provider base URL must be HTTPS without embedded credentials, query, or fragment'
    );
  }
}

export function getProxyUrlCandidate(key: string, value: unknown): unknown {
  if (key === 'proxy.httpProxy') {
    return value;
  }
  if (key === 'proxy' && isRecord(value)) {
    return value.httpProxy;
  }
  return undefined;
}

export function isProxyConfigPath(path: string): boolean {
  return path === 'proxy' || path.startsWith('proxy.');
}

export function validateModelProviderConfig(providers: ModelProviderConfig): void {
  for (const provider of Object.values(providers)) {
    validateProviderBaseUrl(provider?.baseUrl);
  }
}

export function validateProviderConfig(partial: Partial<PeaksConfig>): void {
  validateModelProviderConfig(partial.providers ?? {});
}

export function isValidProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.pathname === '/' &&
      url.search.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

export function validateProxyUrl(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !isValidProxyUrl(value))) {
    throw new Error('Proxy URL must be an HTTP or HTTPS URL without embedded credentials');
  }
}

export function validateProxyConfig(partial: Partial<PeaksConfig>): void {
  validateProxyUrl(partial.proxy?.httpProxy);
}
export function containsSensitiveConfigValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsSensitiveConfigValue);
  }
  if (value === null || typeof value !== 'object') {
    return false;
  }

  return Object.entries(value).some(
    ([key, entry]) => isSecretKey(key) || containsSensitiveConfigValue(entry)
  );
}

export type RedactedConfigValue =
  string | number | boolean | null | RedactedConfigValue[] | { [key: string]: RedactedConfigValue };

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

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const nextPath = path ? `${path}.${key}` : key;
      if (isSecretKey(key)) {
        return [key, '***'];
      }
      if (isProviderBaseUrlPath(nextPath) && typeof entry === 'string') {
        return [key, sanitizeBaseUrlForDisplay(entry)];
      }
      return [key, redactConfigSecrets(entry, nextPath)];
    })
  );
}
