/**
 * The PUBLIC auto-compact profiles.
 *
 * Two profiles, and BOTH are public: any project, in any mode, can pick
 * either one. Nothing here belongs to the 24h long-run mode any more — a
 * profile is a THRESHOLD choice, not a mode.
 *
 * `'standard'` keeps the v2.13.0 zero-pause contract thresholds
 * (autoFire=0.80, preCompact=0.85, redLine=0.95).
 *
 * `'eager'` fires EARLIER (autoFire=0.65, preCompact=0.70, redLine=0.85).
 *
 * WHY THE NAME CHANGED. The profile used to be called `'partial'`, and that
 * name promised a behaviour this product does not have: there is NO
 * partial-compaction pathway — the profile only moves the THRESHOLDS at
 * which the orchestrator fires. A public name that promises behaviour the
 * product does not implement is a lie in the CLI surface, so the profile is
 * named after what it actually does: it fires earlier. `'partial'` stays
 * ACCEPTED as a compatibility alias — `--mode partial` is a published CLI
 * surface, and dropping it would break existing callers harder than a
 * no-op — and `normalizeAutoCompactMode` is the ONE place that maps it onto
 * `'eager'`.
 *
 * `autoFire` tier is added between soft-warn and preCompact. peaks-loop
 * preempts and runs `peaks code auto-compact` itself when
 * context crosses `autoFire`; the LLM is NOT asked to "decide"
 * (the LLM-judged 0.85–0.95 zone was the source of false-positive
 * "context too low" reports at 60%+ free — the LLM was guessing).
 */

/** The canonical profile names. */
export type AutoCompactProfile = 'standard' | 'eager';

/**
 * Every mode name this build ACCEPTS.
 *
 * `'partial'` is the legacy alias of `'eager'`. It stays in the type so a
 * caller that still passes it keeps compiling, and it is collapsed to
 * `'eager'` by `normalizeAutoCompactMode` before anything is stored or
 * reported — the alias is a spelling, never a second profile.
 */
export type AutoCompactMode = AutoCompactProfile | 'partial';

/** The canonical profile names, in the order the CLI lists them. */
export const AUTO_COMPACT_PROFILES: readonly AutoCompactProfile[] = ['standard', 'eager'];

/**
 * The ONE alias table: a legacy mode name → the canonical profile it means.
 * `normalizeAutoCompactMode` is its only reader, so the mapping cannot be
 * restated — and therefore cannot drift — anywhere else.
 */
const LEGACY_MODE_ALIASES: Readonly<Record<string, AutoCompactProfile>> = { partial: 'eager' };

export interface AutoCompactThresholds {
  readonly autoFire: number;
  readonly preCompact: number;
  readonly redLine: number;
}

const EAGER_THRESHOLDS: AutoCompactThresholds = { autoFire: 0.65, preCompact: 0.7, redLine: 0.85 };

const PROFILE_THRESHOLDS: Readonly<Record<AutoCompactProfile, AutoCompactThresholds>> = {
  standard: { autoFire: 0.8, preCompact: 0.85, redLine: 0.95 },
  eager: EAGER_THRESHOLDS
};

/**
 * The threshold table. `partial` is the legacy alias and points at the SAME
 * row as `eager` — the numbers are written once, so the alias cannot drift
 * away from the profile it names.
 */
export const AUTO_COMPACT_THRESHOLDS: Readonly<Record<AutoCompactMode, AutoCompactThresholds>> = {
  ...PROFILE_THRESHOLDS,
  partial: EAGER_THRESHOLDS
};

/**
 * Normalize a mode name to its canonical profile, or `null` when the name is
 * not a mode this build knows.
 *
 * This is the single entry point for the alias mapping: `'partial'` in,
 * `'eager'` out, and every caller that needs the canonical name goes
 * through here.
 */
export function normalizeAutoCompactMode(value: string): AutoCompactProfile | null {
  if (value === 'standard' || value === 'eager') return value;
  const alias = LEGACY_MODE_ALIASES[value];
  return alias ?? null;
}

/** True when `value` names a mode this build accepts (a canonical name or the legacy alias). */
export function isValidMode(value: string): value is AutoCompactMode {
  return normalizeAutoCompactMode(value) !== null;
}

/** The threshold a mode fires at. */
export function thresholdFor(
  mode: AutoCompactMode,
  kind: 'autoFire' | 'preCompact' | 'redLine'
): number {
  // `mode` is typed, so the canonical name is always resolvable; the
  // fallback keeps the function total for an untyped caller.
  const canonical = normalizeAutoCompactMode(mode) ?? 'standard';
  return AUTO_COMPACT_THRESHOLDS[canonical][kind];
}

function pct(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

/**
 * Human-readable form of a profile's threshold row.
 *
 * Derived from `AUTO_COMPACT_THRESHOLDS` rather than hand-written. Diagnosis
 * 2026-09-15 (C1) found this string advertising `0.85/0.95` for `standard`
 * while the table had auto-fired at `0.80` since slice
 * description named only the two thresholds that were left over from the
 * v2.13.0 contract, and skipped the one that actually fires. Reading the
 * numbers out of the table makes that drift unrepresentable.
 */
export function describeMode(mode: AutoCompactMode): string {
  const canonical = normalizeAutoCompactMode(mode) ?? 'standard';
  const { autoFire, preCompact, redLine } = AUTO_COMPACT_THRESHOLDS[canonical];
  const bands = `auto-fire ${pct(autoFire)} / pre-compact ${pct(preCompact)} / red-line ${pct(redLine)}`;
  return canonical === 'standard'
    ? `standard (${bands} — v2.13.0 zero-pause contract)`
    : `eager (${bands} — fires earlier than standard)`;
}

/** True when the context percentage has reached the `eager` profile's pre-compact line. */
export function isEagerModeEligible(contextPercent: number): boolean {
  return contextPercent >= EAGER_THRESHOLDS.preCompact;
}

/**
 * @deprecated The profile was renamed; `eager` is the canonical name. Kept
 * so an existing caller keeps working — it now means the same thing.
 */
export const isPartialModeEligible = isEagerModeEligible;
