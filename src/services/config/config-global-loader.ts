/**
 * The slim 2.0 `~/.peaks/config.json` loader and its legacy promotion.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
import { existsSync } from 'node:fs';
import { CONFIG_SCHEMA_VERSION_V2, globalConfigPath } from './config-migration.js';
import { readConfigFileSafely, writeUserConfigFile } from './config-safety.js';
import { isRecord } from './config-primitives.js';
import {
  SIDECAR_SCHEMA_VERSION,
  providersConfigPath,
  proxyConfigPath,
  readSidecarJson,
  sidecarExists,
  workspacesConfigPath,
  writeSidecarJson
} from './sidecar-store.js';
import { isConfigV2, type ConfigV2 } from './config-types.js';

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
 * Slim 2.0 schema allows `version` + `ocr`. Any other top-level
 * field is a legacy artifact that needs to be promoted to a
 * sidecar file.
 */
function hasLegacyGlobalFields(raw: Record<string, unknown>): boolean {
  const allowed = new Set(['version', 'ocr']);
  return Object.keys(raw).some((k) => !allowed.has(k));
}

/**
 * One-shot promotion of legacy fields into their dedicated sidecar
 * files. Idempotent: if the sidecar already has the field, the
 * legacy value is dropped (sidecar is the new source of truth).
 */
function promoteLegacyGlobalFieldsToSidecars(raw: Record<string, unknown>): void {
  if (isRecord(raw.providers)) {
    const existing = readSidecarJson<Partial<ProvidersSidecarShape>>(providersConfigPath(), {
      version: SIDECAR_SCHEMA_VERSION,
      providers: {}
    });
    const mergedProviders = {
      ...(existing.providers ?? {}),
      ...raw.providers
    };
    writeSidecarJson(providersConfigPath(), {
      version: SIDECAR_SCHEMA_VERSION,
      providers: mergedProviders
    });
  }
  if (isRecord(raw.proxy) && typeof raw.proxy.httpProxy === 'string') {
    const httpProxy = raw.proxy.httpProxy;
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
  const slim: Record<string, unknown> = { version: CONFIG_SCHEMA_VERSION_V2 };
  if (ocr !== null) slim['ocr'] = ocr;
  writeUserConfigFile(path, JSON.stringify(slim, null, 2) + '\n');
}

function readOcrFromRawConfigFile(): Record<string, unknown> | null {
  const path = globalConfigPath();
  if (!existsSync(path)) return null;
  const content = readConfigFileSafely(path, 'Global config path must stay inside the user root');
  const raw = JSON.parse(content) as Record<string, unknown>;
  return isRecord(raw.ocr) ? raw.ocr : null;
}
