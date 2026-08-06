import { CLI_VERSION } from 'peaks-loop-shared/version';

// Provider types (consumed by provider-service.ts and config-service.ts legacy compat)
export type ModelPreference = 'haiku' | 'sonnet' | 'opus';

export type ModelProviderId = string;
export type ExecutionModelId = string;

export type ProviderModelConfig = {
  model?: ExecutionModelId;
  baseUrl?: string;
  apiKey?: string;
};

export type ModelProviderConfig = {
  [providerId: string]: ProviderModelConfig | undefined;
};

// Proxy type (consumed by proxy-service.ts and config-service.ts legacy compat)
export type ProxyConfig = {
  httpProxy?: string;
};

// Token ref types (legacy, kept for back-compat reads)
export type TokenRef =
  | { env: string }
  | { keychain: string }
  | { ghCli: true };

export type TokenConfig = {
  AnthropicApiKey?: TokenRef;
  OpenAiApiKey?: TokenRef;
  GitHubToken?: TokenRef;
  GitLabToken?: TokenRef;
};

// Workspace + artifact types (consumed by workspace-state-service.ts)
export type ArtifactProvider = 'github' | 'gitlab';

export type ArtifactRemoteRepoConfig = {
  provider: ArtifactProvider;
  owner: string;
  name: string;
};

export type ArtifactStorageConfig =
  | {
      mode: 'local';
      localPath?: string;
    }
  | {
      mode: 'local-with-remote-sync';
      localPath?: string;
      remote: ArtifactRemoteRepoConfig;
    };

export type WorkspaceConfig = {
  workspaceId: string;
  name: string;
  rootPath: string;
  artifactRepo?: ArtifactRemoteRepoConfig;
  artifactStorage?: ArtifactStorageConfig;
  installedCapabilityIds: string[];
};

/**
 * 2.0.1 slim `~/.peaks/config.json` schema. Runtime settings live in
 * sidecar files under the same `~/.peaks/` directory or in per-project
 * `preferences.json`.
 *
 * NOTE: legacy fields below are kept on the type as `@deprecated`
 * so existing consumers (`config-service.ts`, `workflow-commands.ts`,
 * etc.) continue to compile during the migration window. They are
 * written to / read from sidecar files at runtime.
 */
export type PeaksConfig = {
  version: string;
  /** @deprecated Moved to `~/.peaks/providers.json` (provider-service.ts) */
  providers?: ModelProviderConfig;
  /** @deprecated Moved to `~/.peaks/proxy.json` (proxy-service.ts) */
  proxy?: ProxyConfig;
  /** @deprecated Removed in 2.0.1; canonical home is `<project>/.peaks/preferences.json` */
  language?: string;
  /** @deprecated Removed in 2.0.1; canonical home is preferences */
  model?: ModelPreference;
  /** @deprecated Removed in 2.0.1; canonical home is preferences */
  economyMode?: boolean;
  /** @deprecated Removed in 2.0.1; canonical home is preferences */
  swarmMode?: boolean;
  /** @deprecated Removed in 2.0.1; never read from this file */
  tokens?: TokenConfig;
  /** @deprecated Moved to `~/.peaks/workspaces.json` (workspace-state-service.ts) */
  workspaces?: WorkspaceConfig[];
  /** @deprecated Moved to `~/.peaks/workspaces.json` (workspace-state-service.ts) */
  currentWorkspace?: string | null;
};

export type ConfigLayer = 'user' | 'project';

export type ConfigGetOptions = {
  key?: string;
  layer?: ConfigLayer;
};

export type ConfigSetOptions = {
  key: string;
  value: unknown;
  layer?: ConfigLayer;
};

/**
 * 2.0.1 slim runtime default for `~/.peaks/config.json`. The on-disk
 * file only carries `version` + empty `ocr.llm.*` placeholders.
 */
export const DEFAULT_CONFIG = {
  version: CLI_VERSION
} as PeaksConfig;

// Re-export schema-version types from config-migration for back-compat
export type { ConfigV2 } from './config-migration.js';
export { isConfigV2 } from './config-migration.js';