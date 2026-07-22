/**
 * peaks-loop 2.0 project-local preferences schema.
 * Per spec §8.4 — per-project state lives in `.peaks/preferences.json`,
 * NOT in `~/.peaks/config.json` (which is slim global).
 *
 * Spec reference: docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md §8.4
 */

export const PREFERENCES_SCHEMA_VERSION = '2.0.0';

/**
 * Per-task-level UA install UX prompt decision.
 * Values:
 *   - 'unset'              — ask every session (default)
 *   - 'skip-this-session'  — skip prompt for current session only
 *   - 'skip-forever'       — never ask, never install
 */
export type UaPromptDecision = 'unset' | 'skip-this-session' | 'skip-forever';

/**
 * L1a task classification conservatism.
 * Values:
 *   - 'default'  — use default signal thresholds
 *   - 'strict'   — always upgrade to next level (slower, safer)
 *   - 'lax'      — always downgrade to previous level (faster, riskier)
 */
export type ClassifyConservatism = 'default' | 'strict' | 'lax';

/**
 * Per-touchpoint headroom-AI mode override.
 * Spec §7.4 — default 'balanced'.
 */
export type HeadroomMode = 'balanced' | 'aggressive' | 'conservative';

export interface HeadroomPreferences {
  /** Whether headroom integration is enabled globally. Default: true */
  readonly enabled: boolean;
  /** Default mode if a touchpoint doesn't override. Default: 'balanced' */
  readonly defaultMode: HeadroomMode;
  /** Per-touchpoint mode overrides */
  readonly perTouchpoint: {
    subAgentDispatch: HeadroomMode;
    memorySearch: HeadroomMode;
    retrospectiveSearch: HeadroomMode;
    doctorScan: HeadroomMode;
    doctorRoute: HeadroomMode;
  };
  /** Minimum joined-result byte count before search-touchpoint compression runs. Default: 4096. */
  readonly compressMinBytes: number;
}

export interface ClassifyRuleOverrides {
  // All fields are optional: a partial override is merged over DEFAULT_PREFERENCES.classifyRules
  // by preferences-service.ts::mergePreferences (load + save). Missing fields fall back to the
  // default; present fields replace. Never pass an object missing the `schema_version` guard
  // upstream — that lives on ProjectPreferences, not on the rule overrides.
  /** File count threshold above which a task is promoted to 'feature' */
  readonly feature_threshold_files?: number;
  /** Line count threshold above which a task is promoted to 'feature' */
  readonly feature_threshold_lines?: number;
  /** Whether to require a 24h grace before cleaning recently-active sessions */
  readonly runtime_clean_grace_hours?: number;
}

export interface SwarmSpeculativePreferences {
  /** Whether speculative dispatch is enabled. Default: true */
  readonly enabled: boolean;
  /** Max concurrent speculative sub-agents. Default: 3 (slice 2026-06-24-efficiency-4p-bundle, G3/P1.1) */
  readonly maxConcurrent: number;
  /** Min hit rate below which speculative auto-disables. Default: 0.5 */
  readonly minHitRate: number;
}

export interface ProjectPreferences {
  /**
   * On-disk schema version. The JSON key is `schema_version` (snake_case) — this matches the
   * raw on-disk key in `.peaks/preferences.json`, NOT the camelCase used by the rest of this
   * interface. preferences-service.ts validates this value against PREFERENCES_SCHEMA_VERSION
   * on load and writes the current value on save. Any mismatch throws PREFERENCES_SCHEMA_MISMATCH.
   */
  readonly schema_version: typeof PREFERENCES_SCHEMA_VERSION;
  /**
   * Slice 2026-06-28-code-mode-bypass-fix: economyMode is a
   * **MODEL-SELECTION** knob only — it chooses between the cheap
   * configured provider (`getConfiguredExecutionModelId`) and the
   * strongest planner/reviewer model (`getStrongestModelId(...)`). It does
   * NOT throttle concurrency, fan-out, or worker count. Per user
   * direction 2026-06-28: "效率比省钱更重要，是在效率达到最大值的时
   * 候，再去考虑经济问题" (efficiency first; economy is only considered
   * after efficiency is maxed out).
   *
   * Concurrency is governed by:
   *   - `swarmMode` (project-policy opt-out for the swarm subgraph),
   *   - `fanout.defaultMode` (HARD constraint: `'fan-out'` per slice
   *     2026-06-24-audit-5th-p2),
   *   - the slice DAG leaf count (≥ 2 leaves at one topological level
   *     forces parallel dispatch via `peaks sub-agent dispatch --from-dag`).
   *
   * Even with `economyMode: true` AND `swarmMode: false`, a 2-leaf DAG
   * MUST dispatch in parallel — the `fanout-mandatory` rule is
   * unconditional. Economy ≠ concurrency.
   */
  readonly economyMode: boolean;
  /**
   * Slice 2026-06-28: swarmMode controls whether the swarm subgraph
   * (peaks-rd/qa worker graph) is generated at all. It does NOT
   * control fan-out. Fan-out is governed by the slice DAG + the
   * `fanout.defaultMode` preference; swarmMode only decides the
   * dispatch *shape* (worker graph vs flat dispatch).
   */
  readonly swarmMode: boolean;
  readonly uaPrompt: UaPromptDecision;
  readonly agentShieldPrompt: UaPromptDecision;
  readonly classifyConservatism: ClassifyConservatism;
  readonly classifyRules: ClassifyRuleOverrides;
  readonly headroom: HeadroomPreferences;
  readonly swarmSpeculative: SwarmSpeculativePreferences;
  /** Loop Autonomous (L4 14.5) toggle. Default: false — never auto-enable. */
  readonly loopAutonomousEnabled: boolean;
  /**
   * L2.3 P2-a: ECC AgentShield subprocess toggle. Default: false.
   *
   * When true, `peaks audit static` spawns `npx ecc-agentshield scan --json`
   * and merges its findings into the audit report. When false (default),
   * the audit runs peaks-loop-only and the subprocess is never spawned.
   *
   * The preference is independent of whether ECC is installed — i.e.
   * `agentShieldEnabled: true` with ECC missing surfaces a soft
   * "ECC not installed" warning and the audit still completes.
   */
  readonly agentShieldEnabled: boolean;
  /**
   * Slice 2026-06-24-audit-5th-p2: fan-out is now a HARD constraint.
   * The previous opt-out (`defaultMode = 'serial'`) is removed by user
   * direction. Single-sub-agent dispatch is no longer permitted when
   * the slice DAG has ≥ 2 leaves at the same topological level; the
   * LLM-side runner MUST use `peaks sub-agent dispatch --from-dag`
   * (N parallel `buildToolCall` per dispatch).
   *
   * The field is kept on `ProjectPreferences` for backward-compatible
   * load (legacy preferences.json files still parse) but the runtime
   * shape is fixed: `defaultMode === 'fan-out'`. Any other value in a
   * saved file is rejected at load time.
   */
  readonly fanout: FanoutPreference;
  /**
   * Slice 2026-07-22-orchestrator-memory-preflight: orchestrator-side memory
   * preflight knobs. Optional — `resolveMemoryPreflightConfig` (see
   * src/services/context/memory-preflight-config.ts) merges over a hard-coded
   * default block when this key is absent, so legacy preferences.json files
   * keep working unchanged.
   */
  readonly memoryPreflight?: {
    readonly enabled?: boolean;
    readonly maxTokens?: number;
    readonly listCap?: number;
    readonly contentCacheBytes?: number;
  };
}

export type FanoutMode = 'fan-out';

export const FANOUT_MODES: readonly FanoutMode[] = ['fan-out'];

/**
 * Runtime type guard for `FanoutMode`. Slice 2026-06-24-audit-5th-p2
 * narrowed the closed set from `['fan-out','serial']` to `['fan-out']`
 * — stale preferences.json files with `"serial"` must now fail-fast at
 * load (see `preferences-service.ts`) instead of being silently coerced.
 */
export function isFanoutMode(value: unknown): value is FanoutMode {
  return typeof value === 'string' && (FANOUT_MODES as readonly string[]).includes(value);
}

export interface FanoutPreference {
  /** Hard-coded mode. Slice 2026-06-24-audit-5th-p2 removed the serial opt-out. */
  readonly defaultMode: FanoutMode;
}

export const DEFAULT_PREFERENCES: ProjectPreferences = {
  schema_version: PREFERENCES_SCHEMA_VERSION,
  economyMode: true,
  swarmMode: true,
  uaPrompt: 'unset',
  agentShieldPrompt: 'unset',
  classifyConservatism: 'default',
  classifyRules: {
    feature_threshold_files: 10,
    feature_threshold_lines: 100,
    runtime_clean_grace_hours: 24,
  },
  headroom: {
    enabled: true,
    defaultMode: 'balanced',
    perTouchpoint: {
      subAgentDispatch: 'balanced',
      memorySearch: 'balanced',
      retrospectiveSearch: 'balanced',
      doctorScan: 'balanced',
      doctorRoute: 'conservative',
    },
    compressMinBytes: 4096,
  },
  swarmSpeculative: {
    enabled: true,
    maxConcurrent: 3,
    minHitRate: 0.5,
  },
  loopAutonomousEnabled: false,
  agentShieldEnabled: false,
  fanout: {
    defaultMode: 'fan-out'
  },
  // Slice 2026-07-22-orchestrator-memory-preflight: defaults aligned with
  // memory-preflight-config.ts::DEFAULTS. Kept in sync manually because
  // loadPreferences() returns DEFAULT_PREFERENCES verbatim when the on-disk
  // file is absent, and partial overlays rely on memoryPreflight being
  // defined here.
  memoryPreflight: {
    enabled: true,
    maxTokens: 1200,
    listCap: 12,
    contentCacheBytes: 6000,
  },
};
