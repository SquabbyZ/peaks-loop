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
  currentWorkspace: string | null;
  workspaces: WorkspaceConfig[];
  language: string;
  model: ModelPreference;
  economyMode: boolean;
  swarmMode: boolean;
  tokens: TokenConfig;
  providers: ModelProviderConfig;
  proxy: ProxyConfig;
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
  version: '0.1.0',
  currentWorkspace: null,
  workspaces: [],
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
  proxy: {}
};