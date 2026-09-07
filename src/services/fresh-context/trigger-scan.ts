/**
 * Fresh-context trigger scan — pure, deterministic signal detection for the
 * search-first preflight (slice 2026-09-07-search-first-preflight).
 *
 * The scan is a cheap NL keyword check that runs BEFORE the first planning
 * action. It decides whether the orchestrator should search for fresh
 * context (Context7 → WebSearch) and synthesize ≤5 binding directives to
 * hedge against model training-data lag.
 *
 * Kept free of fs / network / config IO so it is trivially testable. The
 * caller (`fresh-context-commands.ts`) reads the `freshContext.enabled`
 * kill-switch from the config service and passes it in as `enabled`; the
 * pure scan then gates `triggered` on it (enabled=false → no-op, per
 * acceptance criterion #9).
 */

export interface FreshContextPreflightResult {
  /** true when the preflight should run (a signal/force keyword hit AND not killed). */
  triggered: boolean;
  /** true when a force keyword (联网搜 / 查最新 / 搜一下) matched. */
  forced: boolean;
  /** the signal keywords matched in the prompt (case-insensitive). */
  signals: string[];
  /** the `freshContext.enabled` kill-switch value (false → no-op). */
  enabled: boolean;
}

/** Signal keywords — matched case-insensitively as substrings. */
export const SIGNAL_KEYWORDS: readonly string[] = [
  '升级', '迁移', '最新', 'latest', 'new', '版本', '兼容',
  'breaking', 'upgrade', 'migrate', '新框架', '推荐库', '选型'
];

/** Force keywords — the user explicitly asks for a live search. */
export const FORCE_KEYWORDS: readonly string[] = ['联网搜', '查最新', '搜一下'];

export function scanFreshContextTrigger(prompt: string, enabled: boolean): FreshContextPreflightResult {
  const haystack = prompt.toLowerCase();
  const signals = SIGNAL_KEYWORDS.filter((keyword) => haystack.includes(keyword.toLowerCase()));
  const forced = FORCE_KEYWORDS.some((keyword) => haystack.includes(keyword.toLowerCase()));
  const triggered = enabled && (signals.length > 0 || forced);
  return { triggered, forced, signals, enabled };
}
