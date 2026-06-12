import { DEFAULT_CONFIG, type ModelProviderConfig, type PeaksConfig } from './config-types.js';

export const STRONGEST_MODEL_ID = 'claude-opus-4-7' as const;

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

export function getEconomyAwareExecutionModelId(config: Pick<PeaksConfig, 'economyMode' | 'providers'>): string {
  // Slice 2.0.1-bug1 round 3: economy is the project default. Treat undefined as enabled
  // (matches the pre-slice implicit default from DEFAULT_CONFIG.economyMode = true). Only an
  // explicit `economyMode === false` switches execution to STRONGEST_MODEL_ID.
  return config.economyMode !== false ? getConfiguredExecutionModelId(config.providers) : STRONGEST_MODEL_ID;
}
