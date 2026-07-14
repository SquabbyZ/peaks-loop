import { DEFAULT_CONFIG, type ModelProviderConfig, type PeaksConfig } from './config-types.js';
import { detectCurrentIdeModel } from '../ide/current-model-detector.js';

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
 * model. Adapter-level runtime probing is wired in Slice C
 * (`getStrongestModelIdAsync` below).
 */
export function getStrongestModelId(config?: { model?: unknown }): string {
  const raw = config?.model;
  const fromConfig = typeof raw === 'string' ? raw.trim() : undefined;
  if (fromConfig) return fromConfig;
  // Slice 2026-07-09: back-compat fallback for test fixtures that
  // pre-date this slice (SC §3.4 strategy A env-var override).
  return process.env.PEAKS_STRONGEST_MODEL_DEFAULT ?? 'claude-opus-4-7';
}

/**
 * Slice 2026-07-09 add-zcode-adapter (Slice C, C.4): async variant
 * of `getStrongestModelId`. Same precedence for layers 1 + 2, but
 * layer 2.5 is the IDE's runtime probe (`detectCurrentIdeModel`)
 * which is consulted BEFORE the env-var back-compat fallback.
 *
 * Why this exists:
 *   - `rd-service.buildPlan` (and other sync callers) still call the
 *     sync `getStrongestModelId` — we do NOT change those signatures.
 *   - New async callers (the future Slice C-extension of
 *     `workflow-router-service`, plus any LLM-inside-z-code path)
 *     resolve the strongest model from the IDE's actual state,
 *     without forcing the user to set `config.model`.
 *
 * Resolution order:
 *   1. Explicit `config.model`.
 *   2. `PEAKS_STRONGEST_MODEL_DEFAULT` env var override.
 *   3. Runtime probe via `detectCurrentIdeModel()` (only when the
 *      registered IDE adapter opts in via `detectCurrentModel?` —
 *      only `zcode` does in Slice C; other IDEs skip this layer).
 *   4. Hardcoded back-compat default `'claude-opus-4-7'`.
 *
 * Each layer is isolated so a failure in the probe does not break
 * the resolver.
 */
export async function getStrongestModelIdAsync(
  config?: { model?: unknown },
  runtimeProbeDisabled: boolean = false
): Promise<string> {
  const raw = config?.model;
  const fromConfig = typeof raw === 'string' ? raw.trim() : undefined;
  if (fromConfig) return fromConfig;
  const envDefault = process.env.PEAKS_STRONGEST_MODEL_DEFAULT;
  if (envDefault && envDefault.length > 0) return envDefault;
  if (!runtimeProbeDisabled) {
    try {
      const probed = await detectCurrentIdeModel();
      if (probed && probed.length > 0) return probed;
    } catch { // TODO(g2): best-effort runtime probe — fall through to back-compat default is intentional
      // best-effort — fall through to back-compat default
    }
  }
  return 'claude-opus-4-7';
}

export function getConfiguredExecutionModelId(providers: ModelProviderConfig | undefined): string {
  const providerConfigs = Object.values(providers ?? {});
  const configuredModel = providerConfigs
    .map((provider) => provider?.model?.trim())
    .find((model): model is string => typeof model === 'string' && model.length > 0);
  if (!configuredModel) {
    throw new ProviderNotConfiguredError();
  }
  return configuredModel;
}

/**
 * Slice 015 — typed exception for "no provider has a configured model".
 * Lives next to its throw site so a downstream `instanceof` check survives
 * any tree-shaking. CLI catch sites map this to the `INVALID_PROVIDERS`
 * envelope code via `_cli-error-envelope.mapServiceError`.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(message = 'Execution model must be configured in providers') {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}

export function getEconomyAwareExecutionModelId(config: Pick<PeaksConfig, 'economyMode' | 'providers'> & { model?: string }): string {
  // Slice 2.0.1-bug1 round 3: economy is the project default. Treat undefined as enabled
  // (matches the pre-slice implicit default from DEFAULT_CONFIG.economyMode = true). Only an
  // explicit `economyMode === false` switches execution to the strongest planner/reviewer
  // model (resolved dynamically per Slice 2026-07-09 add-zcode-adapter A.3).
  return config.economyMode !== false ? getConfiguredExecutionModelId(config.providers) : getStrongestModelId(config);
}
