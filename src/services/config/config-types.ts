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

// Companion types (slice 2026-06-14-cc-connect-weixin change-1)
// Peaks config is the single source of truth for cc-connect settings.
// The legacy `~/.cc-connect/config.toml` write path stays, but peaks
// builds the TOML from typed CompanionConfig + a CC-CONNECT template
// (not from user prompts re-asking).
export type CompanionChannel = 'weixin';
export type CompanionBinarySource = 'node-modules' | 'path';

export type CompanionWeixinConfig = {
  /** QR payload peaks renders for the iLink scan (default: 'ilink://peaks-cli?project=default'). */
  ilinkQrPayload: string;
  /** Pairing timeout in seconds (default 60). */
  loginTimeoutSec: number;
};

export type CompanionConfig = {
  /** Opt-in flag. When false, no cc-connect artifacts are written. Default false. */
  enabled: boolean;
  /** Channel lock — only 'weixin' is supported in this rid. */
  defaultChannel: CompanionChannel;
  /** Resolved absolute path to the cc-connect binary, or null when not yet resolved. */
  binaryPath: string | null;
  /** Source of the binary resolution, or null when not yet resolved. */
  binaryPathSource: CompanionBinarySource | null;
  /** Path peaks writes the cc-connect TOML to (default ~/.cc-connect/config.toml). */
  configPath: string;
  /** Weixin-only channel block. */
  weixin: CompanionWeixinConfig;
  /** Optional agent type override for the cc-connect `[projects.agent]` block.
   *  When unset, the renderer defaults to `"claudecode"` (the canonical
   *  type for an AI-agent-on-WeChat). See BUG 6 fix in
   *  config-template.ts for the rationale. */
  agentType?: string;
  /** Optional working directory override for `[projects.agent.options].work_dir`.
   *  When unset, the renderer uses `process.cwd()`. */
  agentWorkDir?: string;
  /** When true, `peaks companion start` runs on session resume. Out of scope to implement autoStart itself; just store the flag. */
  autoStart: boolean;
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
  /** Companion / cc-connect settings (slice 2026-06-14-cc-connect-weixin). */
  companion?: CompanionConfig;
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
  },
  companion: {
    enabled: false,
    defaultChannel: 'weixin',
    binaryPath: null,
    binaryPathSource: null,
    configPath: '~/.cc-connect/config.toml',
    weixin: {
      ilinkQrPayload: 'ilink://peaks-cli?project=default',
      loginTimeoutSec: 60
    },
    autoStart: false
  }
} as PeaksConfig;

// Re-export schema-version types from config-migration for back-compat
export type { ConfigV2 } from './config-migration.js';
export { isConfigV2 } from './config-migration.js';