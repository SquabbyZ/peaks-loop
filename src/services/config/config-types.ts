import { CLI_VERSION } from '../../shared/version.js';

// Provider types (consumed by provider-service.ts and config-service.ts legacy compat)
export type ModelPreference = 'haiku' | 'sonnet' | 'opus' | 'minimax';

export type ModelProviderId = 'minimax' | string;
export type ExecutionModelId = string;

export type ProviderModelConfig = {
  model?: ExecutionModelId;
  baseUrl?: string;
  apiKey?: string;
};

export type MiniMaxProviderConfig = ProviderModelConfig;

export type ModelProviderConfig = {
  minimax?: MiniMaxProviderConfig;
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

// OCR types (canonical home of ocr.llm config)
export type OcrAuthHeader = 'authorization' | 'x-api-key' | 'bearer';

export type OcrLlmConfig = {
  url?: string;
  authToken?: string;
  model?: string;
  useAnthropic?: boolean;
  authHeader?: OcrAuthHeader;
};

export type OcrConfig = {
  llm?: OcrLlmConfig;
};

/**
 * 2.0.1 slim `~/.peaks/config.json` schema. The on-disk file holds
 * ONLY `version` + `ocr.llm.*` placeholders. All other settings
 * (providers, proxy, workspaces, language/model/economy/swarm
 * toggles) live in sidecar files under the same `~/.peaks/`
 * directory or in per-project `preferences.json`.
 *
 * The slim shape is enforced on disk by `loadGlobalConfig`; any
 * unknown field on read is silently stripped and the file is
 * rewritten with the slim shape, so a hand-written or partially-
 * migrated file cannot grow stale fields.
 *
 * NOTE: legacy fields below are kept on the type as `@deprecated`
 * so existing consumers (`config-service.ts`, `workflow-commands.ts`,
 * etc.) continue to compile during the migration window. They are
 * written to / read from sidecar files at runtime; the slim
 * `~/.peaks/config.json` only persists `version` + `ocr`.
 */
export type PeaksConfig = {
  version: string;
  ocr?: OcrConfig;
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
  version: CLI_VERSION,
  ocr: {
    llm: {
      url: '',
      authToken: '',
      model: '',
      useAnthropic: false,
      authHeader: 'authorization'
    }
  }
} as PeaksConfig;

// Re-export schema-version types from config-migration for back-compat
export type { ConfigV2 } from './config-migration.js';
export { isConfigV2 } from './config-migration.js';