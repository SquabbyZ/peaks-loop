/**
 * peaks-cli 2.0 project-local preferences schema.
 * Per spec §8.4 — per-project state lives in `.peaks/preferences.json`,
 * NOT in `~/.peaks/config.json` (which is slim global).
 *
 * Spec reference: docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §8.4
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
  /** Max concurrent speculative sub-agents. Default: 2 */
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
  readonly economyMode: boolean;
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
   * the audit runs peaks-cli-only and the subprocess is never spawned.
   *
   * The preference is independent of whether ECC is installed — i.e.
   * `agentShieldEnabled: true` with ECC missing surfaces a soft
   * "ECC not installed" warning and the audit still completes.
   */
  readonly agentShieldEnabled: boolean;
  /**
   * Slice 2026-06-23-audit-p0-no-fanout-opt-out: per-project opt-out for
   * the default multi-sub-agent fan-out behavior (≥ 2 leaves at the
   * same topological level → `peaks sub-agent dispatch --from-dag`).
   *
   *   - 'fan-out' (default) — peak-solo SKILL instructs fan-out when ≥ 2 leaves.
   *   - 'serial'             — peak-solo SKILL instructs serial dispatch even
   *                            when ≥ 2 leaves (escape hatch for callers that
   *                            want deterministic per-slice logs).
   *
   * Backward compatible: existing preferences.json files load with
   * `fanout` defaulted to 'fan-out' via `mergePreferences`.
   */
  readonly fanout: FanoutPreference;
}

export type FanoutMode = 'fan-out' | 'serial';

export interface FanoutPreference {
  /** Slice default mode. Default: 'fan-out' (matches the pre-slice behavior). */
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
    maxConcurrent: 2,
    minHitRate: 0.5,
  },
  loopAutonomousEnabled: false,
  agentShieldEnabled: false,
  fanout: {
    defaultMode: 'fan-out'
  },
};
