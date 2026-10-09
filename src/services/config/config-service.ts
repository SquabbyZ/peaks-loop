import { dirname } from 'node:path';
import {
  DEFAULT_CONFIG,
  type ConfigLayer,
  type ConfigSetOptions,
  type PeaksConfig,
  type TokenRef,
  type WorkspaceConfig
} from './config-types.js';
import {
  findProjectRoot,
  getProjectBootstrapConfigPath,
  getUserConfigPath,
  validateProjectBootstrapConfigPathForWrite,
  validateUserConfigPathForWrite,
  writeProjectConfigFile,
  writeUserConfigFile
} from './config-safety.js';
import { getNestedPathParts, getNestedValue, setNestedValue } from './config-nested-path.js';
import { isRecord, omitProxy } from './config-primitives.js';
import {
  inferHumanLanguage,
  toModelProviderConfig,
  toPeaksConfig,
  toProviderModelConfig,
  toWorkspaceConfigs
} from './config-coercion.js';
import {
  containsSensitiveConfigValue,
  getProxyUrlCandidate,
  isLegacyConfigKey,
  isProviderBaseUrlPath,
  isProviderConfigPath,
  isProxyConfigPath,
  isSensitiveConfigPath,
  redactConfigSecrets,
  validateModelProviderConfig,
  validateProviderBaseUrl,
  validateProviderConfig,
  validateProxyUrl,
  validateProxyConfig,
  type RedactedConfigValue
} from './config-validation.js';
import {
  ensureDir,
  getProjectWriteTarget,
  readExistingJsonFile,
  readJsonFile,
  readProjectJsonFile,
  readUserJsonFile,
  removeProjectSensitiveConfig
} from './config-file-io.js';

// Re-export resolveProjectRootForConfig and resolveCanonicalProjectRoot for external consumers
export { resolveProjectRootForConfig, resolveCanonicalProjectRoot } from './config-safety.js';

// Every name below moved into a sibling module for the file-size cap; the
// declarations are unchanged, so importers of this path are unaffected.
export { getConfig } from './config-get.js';
export { loadGlobalConfig } from './config-global-loader.js';
export {
  addWorkspace,
  ensureWorkspaceConfigForCurrentPath,
  ensureWorkspaceConfigForPath,
  getCurrentWorkspaceConfig,
  getWorkspaceConfig,
  getWorkspaceConfigForCurrentPath,
  getWorkspaceConfigForPath,
  removeWorkspace,
  setCurrentWorkspace
} from './config-workspace.js';
export {
  containsSensitiveConfigValue,
  isLegacyConfigKey,
  isSensitiveConfigPath,
  redactConfigSecrets
};
export type { RedactedConfigValue };

export function isConfigLayer(value: string): value is ConfigLayer {
  return value === 'user' || value === 'project';
}

/**
 * Machine-scoped context-window override key, the config twin of the
 * `PEAKS_CONTEXT_WINDOW_TOKENS` env var (slice
 * `peaks config set --key context.windowTokens --value <positive-int>`
 * (user layer) so the user pins it once instead of exporting an env var
 * in every shell.
 */
export const CONTEXT_WINDOW_TOKENS_CONFIG_KEY = 'context.windowTokens';

/**
 * Read the raw `context.windowTokens` value from the merged config, project
 * layer over user layer (most specific wins). Returns the RAW value —
 * validation lives in the context-window resolver so exactly one warning is
 * emitted per bad value. Returns `undefined` when absent or unreadable;
 * never throws (a corrupt config must not crash a context probe).
 */
export function readContextWindowTokensOverride(projectRoot?: string | null): unknown {
  try {
    const projectRaw = readProjectJsonFile(projectRoot ?? null);
    if (isRecord(projectRaw)) {
      const fromProject = getNestedValue(projectRaw, CONTEXT_WINDOW_TOKENS_CONFIG_KEY);
      if (fromProject !== undefined) return fromProject;
    }
    const userRaw = readUserJsonFile();
    if (isRecord(userRaw)) {
      return getNestedValue(userRaw, CONTEXT_WINDOW_TOKENS_CONFIG_KEY);
    }
    return undefined;
  } catch {
    // TODO(g2): legacy silent catch — never let config IO break a probe (grace: 1 minor release, v2.14.0)
    return undefined;
  }
}

export function bootstrapProjectLanguageConfig(projectRoot: string, language: string): void {
  const inferredLanguage = inferHumanLanguage(language);
  const projectPath = getProjectBootstrapConfigPath(projectRoot);
  const existing =
    readExistingJsonFile(projectPath, 'Project config must contain valid JSON', () =>
      validateProjectBootstrapConfigPathForWrite(projectRoot, projectPath)
    ) ?? {};
  if (typeof existing.language === 'string' && existing.language.trim().length > 0) {
    return;
  }
  writeProjectConfigFile(
    projectRoot,
    projectPath,
    JSON.stringify({ ...existing, language: inferredLanguage }, null, 2)
  );
}

export function readConfig(projectRoot?: string | null): PeaksConfig {
  const detectedRoot = projectRoot ?? findProjectRoot(process.cwd());
  const userConfig = toPeaksConfig(readUserJsonFile());
  const projectConfig = removeProjectSensitiveConfig(
    toPeaksConfig(readProjectJsonFile(detectedRoot))
  );
  const projectConfigWithoutProxy = omitProxy(projectConfig);

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    ...projectConfigWithoutProxy
  };
}

function sanitizeWorkspacePartial(partial: Record<string, unknown>): Record<string, unknown> {
  const result = { ...partial };
  if (Array.isArray(result.workspaces)) {
    result.workspaces = toWorkspaceConfigs(result.workspaces);
  }
  if (
    typeof result.currentWorkspace !== 'string' &&
    result.currentWorkspace !== null &&
    result.currentWorkspace !== undefined
  ) {
    delete result.currentWorkspace;
  }
  return result;
}

export function writeConfig(partial: Partial<PeaksConfig>, layer: ConfigLayer = 'user'): void {
  if (!isConfigLayer(layer)) {
    throw new Error('Invalid config layer');
  }
  if (
    layer === 'project' &&
    (partial.providers !== undefined ||
      partial.proxy !== undefined ||
      containsSensitiveConfigValue(partial))
  ) {
    throw new Error('Sensitive config keys must be stored in the user config layer');
  }
  validateProviderConfig(partial);
  validateProxyConfig(partial);

  if (layer === 'project') {
    const { projectRoot, configPath } = getProjectWriteTarget();
    ensureDir(dirname(configPath));
    const existing =
      readJsonFile(configPath, () =>
        validateProjectBootstrapConfigPathForWrite(projectRoot, configPath)
      ) ?? {};
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
  if (
    layer === 'project' &&
    (isProviderConfigPath(options.key) ||
      isProxyConfigPath(options.key) ||
      isSensitiveConfigPath(options.key) ||
      containsSensitiveConfigValue(options.value))
  ) {
    throw new Error('Sensitive config keys must be stored in the user config layer');
  }
  if (options.key === 'providers') {
    validateModelProviderConfig(toModelProviderConfig(options.value));
  } else if (options.key.startsWith('providers.')) {
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
    ? (readJsonFile(targetPath, () =>
        validateProjectBootstrapConfigPathForWrite(projectTarget.projectRoot, targetPath)
      ) ?? {})
    : (readJsonFile(targetPath, () => validateUserConfigPathForWrite(targetPath)) ?? {});
  const updated = { ...existing };
  setNestedValue(updated, options.key, options.value);
  const content = JSON.stringify(updated, null, 2);
  if (projectTarget) {
    writeProjectConfigFile(projectTarget.projectRoot, targetPath, content);
  } else {
    writeUserConfigFile(targetPath, content);
  }
}

export type { TokenRef, WorkspaceConfig, PeaksConfig, ConfigLayer };
export { getUserConfigPath };
export { globalConfigPath } from './config-migration.js';
