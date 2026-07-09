import { DEFAULT_CONFIG, type ModelProviderConfig, type PeaksConfig } from './config-types.js';

/**
 * Slice 2026-07-09 add-zcode-adapter (A.3): replaces the legacy
 * `STRONGEST_MODEL_ID = 'claude-opus-4-7'` constant (removed) with a dynamic
 * resolver. The strongest planner/reviewer model is now derived
 * from the active config instead of being hardcoded to a specific
 * vendor. This unlocks running peaks-loop under non-Claude IDEs
 * (z-code, Cursor, Trae, ...).
 *
 * Resolution order:
 *   1. Explicit `config.model` (user override via `peaks config set model ...`)
 *   2. Stable fallback for back-compat (env-var override; defaults to
 *      `claude-opus-4-7` so legacy fixtures keep compiling per
 *      SC §3.4 strategy A)
 *
 * Vendor-neutrality note: the default `'claude-opus-4-7'` is a
 * *back-compat fallback*, NOT a hardcoded "the strongest model is
 * always Claude" assumption. Production callers should set
 * `config.model` (or override the env var) to declare their strongest
 * model. Adapter-level runtime probing will be wired in Slice C
 * (D-007 in discovery-issues.md).
 */
export function getStrongestModelId(config?: { model?: unknown }): string {
  const raw = config?.model;
  const fromConfig = typeof raw === 'string' ? raw.trim() : undefined;
  if (fromConfig) return fromConfig;
  // Slice 2026-07-09: back-compat fallback for test fixtures that
  // pre-date this slice (SC §3.4 strategy A env-var override).
  return process.env.PEAKS_STRONGEST_MODEL_DEFAULT ?? 'claude-opus-4-7';
}

export function getConfiguredExecutionModelId(providers: ModelProviderConfig | undefined): string {
  const providerConfigs = Object.values(providers ?? {});
  const configuredModel = providerConfigs
    .map((provider) => provider?.model?.trim())
    .find((model): model is string => typeof model === 'string' && model.length > 0);
  if (!configuredModel) {
    throw new Error('Execution model must be configured in providers');
  }
  return configuredModel;
}

export function getEconomyAwareExecutionModelId(config: Pick<PeaksConfig, 'economyMode' | 'providers'> & { model?: string }): string {
  // Slice 2.0.1-bug1 round 3: economy is the project default. Treat undefined as enabled
  // (matches the pre-slice implicit default from DEFAULT_CONFIG.economyMode = true). Only an
  // explicit `economyMode === false` switches execution to the strongest planner/reviewer
  // model (resolved dynamically per Slice 2026-07-09 add-zcode-adapter A.3).
  return config.economyMode !== false ? getConfiguredExecutionModelId(config.providers) : getStrongestModelId(config);
}
