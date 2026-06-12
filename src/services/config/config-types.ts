import { CLI_VERSION } from '../../shared/version.js';
import { CONFIG_SCHEMA_VERSION_V2 } from './config-migration.js';

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

/**
 * Open Code Review (ocr) LLM endpoint config. Stored under
 * `peaksConfig.ocr.llm` so the user has a single, discoverable
 * place to declare their LLM endpoint for the ocr second-opinion
 * review. peaks-cli never auto-writes these values; the user pastes
 * the template (printed by `peaks code-review config-template`) into
 * their `~/.peaks/config.json` themselves.
 *
 * The field names map onto the OCR package's own env-var surface
 * (the highest-priority config path for the ocr subprocess):
 *
 *   peaksConfig.ocr.llm.url          → OCR_LLM_URL
 *   peaksConfig.ocr.llm.authToken    → OCR_LLM_TOKEN
 *   peaksConfig.ocr.llm.model        → OCR_LLM_MODEL
 *   peaksConfig.ocr.llm.useAnthropic → OCR_USE_ANTHROPIC
 *   peaksConfig.ocr.llm.authHeader   → OCR_LLM_AUTH_HEADER
 *
 * All fields are optional at the type level so the user can fill
 * them in one at a time; the 5-state detector treats the
 * `url + authToken + model` triple as the minimum for a `ready`
 * state and reports the missing keys in `nextActions`.
 */
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
  /**
   * Open Code Review (ocr) second-opinion config. Source of truth
   * for the LLM endpoint that the ocr subprocess consumes via env
   * vars (`OCR_LLM_URL` / `OCR_LLM_TOKEN` / ...). peaks-cli does
   * NOT auto-write this — the user populates it by pasting the
   * `peaks code-review config-template` output into their
   * `~/.peaks/config.json`. See `OcrLlmConfig` for the field map.
   */
  ocr?: OcrConfig;
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
 * 2.0.1 slim runtime default. The on-disk `~/.peaks/config.json`
 * only carries `version` + `ocr.llm.*` placeholders. Legacy fields
 * (language / model / economyMode / swarmMode / tokens / providers /
 * proxy) live in `<project>/.peaks/preferences.json` (per spec
 * §10.4) and are NOT synthesised here — `readConfig()` merges the
 * user file over this default, and any legacy field that the user
 * file still carries (1.x file) is exposed via `getConfig` for
 * backward compatibility.
 *
 * Cast to `PeaksConfig` because the type still declares the legacy
 * fields as required (they are part of the `readConfig()` contract
 * for tolerant loading of pre-2.0.1 files); the runtime default
 * itself does not supply them.
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

/**
 * Slim 2.0 schema for `~/.peaks/config.json`. After migration,
 * the only meaningful field is `version`; everything else
 * (language, model, economyMode, swarmMode, tokens, providers,
 * proxy, workspaces, currentWorkspace) is stored elsewhere
 * (`.peaks/preferences.json`, `.peaks/_state/`, or `.bak`).
 *
 * The type is intentionally minimal: extra keys are ignored at
 * runtime, not rejected, so a hand-written or partially-migrated
 * file does not fail the loader.
 */
export interface ConfigV2 {
  readonly version: typeof CONFIG_SCHEMA_VERSION_V2;
}

export function isConfigV2(raw: unknown): raw is ConfigV2 {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).version === CONFIG_SCHEMA_VERSION_V2
  );
}