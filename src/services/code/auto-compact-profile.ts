/**
 * The PUBLIC auto-compact profile resolution.
 *
 * The profile used to be derived from the 24h long-run state machine, which
 * made the compaction cadence a private property of one mode. It is now a
 * public choice, resolved in ONE order:
 *
 *   1. an explicit `--mode` on this invocation (highest; one call, one override)
 *   2. the project setting `autoCompactProfile` (public, persistent, any mode)
 *   3. the default `'standard'`
 *
 * The 24h mode does NOT participate: a project that wants to compact earlier
 * says so with the project setting. Where the profile is STORED or REPORTED it
 * is always the canonical profile name — never the legacy alias.
 */
import { loadPreferences } from '../preferences/preferences-service.js';
import { normalizeAutoCompactMode, type AutoCompactProfile } from './auto-compact-modes.js';

/** Which of the three sources answered the profile question. */
export type AutoCompactProfileSource = 'cli' | 'preference' | 'default';

export interface ResolvedAutoCompactProfile {
  readonly profile: AutoCompactProfile;
  /** Where it came from: `'cli'`, `'preference'` or `'default'`. */
  readonly source: AutoCompactProfileSource;
}

/**
 * The profile the project pinned, or `null` when it pinned nothing: no key in
 * the file, an unknown value, or the default `'standard'`. A file this build
 * CANNOT READ answers `null` too, leaving the compaction path unbroken.
 */
export function readAutoCompactProfilePreference(projectRoot: string): AutoCompactProfile | null {
  const read = readStoredProfile(projectRoot);
  if (!read.ok) return null;
  const normalized = typeof read.value === 'string' ? normalizeAutoCompactMode(read.value) : null;
  return normalized === null || normalized === 'standard' ? null : normalized;
}

/**
 * The two outcomes of the read: the stored value, or why it is unavailable.
 *
 * DISCRIMINATED, because "the file cannot be read" and "the file carries no
 * profile" are different facts; the reader above collapses them on purpose —
 * both mean "no effective preference" to every caller of this module.
 */
type StoredProfile = { ok: true; value: unknown } | { ok: false; reason: 'unreadable' };

/** Read the stored preference, naming the failure instead of hiding it. */
function readStoredProfile(projectRoot: string): StoredProfile {
  try {
    return { ok: true, value: loadPreferences(projectRoot).autoCompactProfile };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * Resolve the profile in force for one invocation — THE resolution order lives
 * here, in one place, so it cannot drift between the CLI and the services.
 */
export function resolveAutoCompactProfile(input: {
  readonly projectRoot: string;
  /** The normalized `--mode` value, when the caller named one. */
  readonly cliMode?: AutoCompactProfile | null | undefined;
}): ResolvedAutoCompactProfile {
  if (input.cliMode !== undefined && input.cliMode !== null) {
    return { profile: input.cliMode, source: 'cli' };
  }
  const preference = readAutoCompactProfilePreference(input.projectRoot);
  if (preference !== null) return { profile: preference, source: 'preference' };
  return { profile: 'standard', source: 'default' };
}
