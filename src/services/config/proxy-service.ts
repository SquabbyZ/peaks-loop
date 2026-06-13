import { SIDECAR_SCHEMA_VERSION, ensureSidecarVersion, proxyConfigPath, readSidecarJson, writeSidecarJson } from './sidecar-store.js';

/**
 * Proxy config (`httpProxy`) lives in `~/.peaks/proxy.json` — NOT in
 * the slim `~/.peaks/config.json`. The slim config only carries
 * `version` + `ocr.llm.*`; the HTTP/HTTPS proxy the CLI uses for
 * outbound requests lives here in a dedicated sidecar.
 *
 * This module is the only owner of proxy.json. Back-compat reads
 * from `~/.peaks/config.json.proxy.httpProxy` are tolerated for
 * legacy configs (1.x); the next `setHttpProxy` call promotes the
 * value into `~/.peaks/proxy.json` and the legacy config.json field
 * is stripped by `loadGlobalConfig` governance.
 */

export type ProxySidecar = {
  version: string;
  httpProxy: string | null;
};

const EMPTY_PROXY: ProxySidecar = { version: SIDECAR_SCHEMA_VERSION, httpProxy: null };

export function isValidProxyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username.length === 0 && url.password.length === 0 && url.pathname === '/' && url.search.length === 0 && url.hash.length === 0;
  } catch {
    return false;
  }
}

export function validateProxyUrl(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !isValidProxyUrl(value)) {
    throw new Error('Proxy URL must be an HTTP or HTTPS URL without embedded credentials');
  }
}

function loadProxySidecar(): ProxySidecar {
  const raw = readSidecarJson<Partial<ProxySidecar>>(proxyConfigPath(), EMPTY_PROXY);
  const version = ensureSidecarVersion(raw).version;
  const httpProxy = typeof raw.httpProxy === 'string' && isValidProxyUrl(raw.httpProxy) ? raw.httpProxy : null;
  return { version, httpProxy };
}

function saveProxySidecar(httpProxy: string | null): void {
  writeSidecarJson(proxyConfigPath(), {
    version: SIDECAR_SCHEMA_VERSION,
    httpProxy
  });
}

export function getHttpProxy(): string | null {
  return loadProxySidecar().httpProxy;
}

export function setHttpProxy(httpProxy: string | null): void {
  if (httpProxy === null) {
    saveProxySidecar(null);
    return;
  }
  validateProxyUrl(httpProxy);
  saveProxySidecar(httpProxy);
}

export function clearHttpProxy(): void {
  saveProxySidecar(null);
}