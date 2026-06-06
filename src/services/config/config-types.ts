import { CLI_VERSION } from '../../shared/version.js';

// Token reference types — tokens never stored raw, always via reference
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

export type ProxyConfig = {
  httpProxy?: string;
};

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

export type PeaksConfig = {
  version: string;
  language: string;
  model: ModelPreference;
  economyMode: boolean;
  swarmMode: boolean;
  tokens: TokenConfig;
  providers: ModelProviderConfig;
  proxy: ProxyConfig;
  /**
   * Sub-agent progress surfacing knobs. The `peaks progress watch`
   * CLI (intended to be run in a separate terminal tab while the
   * LLM is working) reads `.peaks/_sub_agents/<sid>/subagent-progress.json`
   * and renders elapsed / spinner / sub-step in real time. The
   * `enabled` flag is a kill-switch for users who find the watch
   * distracting; the `heartbeatIntervalMs` lets power users tune
   * the write cadence. Both default to sensible values so stock
   * projects get the feature out of the box.
   *
   * Optional on the type level so older test fixtures / hand-
   * written config files do not have to know about it; the
   * `DEFAULT_CONFIG.progress` block supplies the runtime defaults
   * and `config get` will surface a synthesised block when the
   * field is absent.
   */
  progress?: {
    enabled: boolean;
    heartbeatIntervalMs: number;
  };
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

export const DEFAULT_CONFIG: PeaksConfig = {
  version: CLI_VERSION,
  language: 'en',
  model: 'sonnet',
  economyMode: true,
  swarmMode: true,
  tokens: {},
  providers: {
    minimax: {
      model: 'minimax-2.7'
    }
  },
  proxy: {},
  progress: {
    enabled: true,
    heartbeatIntervalMs: 60000
  }
};