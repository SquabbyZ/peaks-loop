import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readConfigFileSafely, validateUserConfigPathForWrite, writeConfigFileSafely } from './config-safety.js';

/**
 * Sidecar storage for `~/.peaks/config.json` (the slim 2.0 file).
 * The on-disk `~/.peaks/config.json` is strictly `{ version, ocr.llm.* }`.
 * LIVE runtime data (provider configs, proxy, workspace state) lives in
 * dedicated sidecar files under the same `~/.peaks/` directory so the
 * user has one discoverable location for all global peaks state, while
 * `config.json` itself remains a minimal, schema-validatable artifact.
 *
 * Each sidecar has its own `version` field (`"2.0.0"`) for future migrations.
 * All reads/writes use the same hardened-fs primitives as the main
 * config file (symlink / hardlink / HTTPS guards via
 * `validateUserConfigPathForWrite`).
 */

export const SIDECAR_SCHEMA_VERSION = '2.0.0';
const SIDECAR_DIR_NAME = '.peaks';
const PROVIDERS_FILENAME = 'providers.json';
const PROXY_FILENAME = 'proxy.json';
const WORKSPACES_FILENAME = 'workspaces.json';
const SIDECAR_ERROR_MESSAGE = 'Sidecar config path must stay inside the user root';

function peaksHomeDir(home?: string): string {
  return join(home ?? homedir(), SIDECAR_DIR_NAME);
}

export function providersConfigPath(home?: string): string {
  return join(peaksHomeDir(home), PROVIDERS_FILENAME);
}

export function proxyConfigPath(home?: string): string {
  return join(peaksHomeDir(home), PROXY_FILENAME);
}

export function workspacesConfigPath(home?: string): string {
  return join(peaksHomeDir(home), WORKSPACES_FILENAME);
}

export function sidecarExists(path: string): boolean {
  return existsSync(path);
}

export function readSidecarJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  const content = readConfigFileSafely(path, SIDECAR_ERROR_MESSAGE);
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== 'object') return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

export function writeSidecarJson(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const serialized = JSON.stringify(content, null, 2) + '\n';
  writeConfigFileSafely(path, serialized, () => validateUserConfigPathForWrite(path), SIDECAR_ERROR_MESSAGE);
}

export function ensureSidecarVersion(content: { version?: unknown }): { version: string } {
  const raw = typeof content.version === 'string' ? content.version : SIDECAR_SCHEMA_VERSION;
  return { version: raw };
}