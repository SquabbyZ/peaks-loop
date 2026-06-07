/**
 * Resource profile accessors for the per-IDE dispatch layer.
 *
 * Slice #011-2026-06-07-ide-adapter-resource-profile introduced two new
 * optional fields on the `IdeAdapter` interface:
 *
 *   - `standardsProfile` — where the IDE reads its project-level
 *     agent instructions (root file + rules directory + format).
 *   - `skillInstall`     — where the postinstall script symlinks the
 *     bundled skills + output styles.
 *
 * These accessors are the single chokepoint for "given an IdeId, where
 * does the IDE read X from?". The two consumers that consume them:
 *
 *   1. `src/services/standards/ide-aware-standards-service.ts` —
 *      wraps `peaks standards init/update` to dispatch on the detected
 *      IDE rather than always writing CLAUDE.md + .claude/rules/**.
 *   2. `scripts/install-skills.mjs` (loaded via dynamic import) — the
 *      postinstall script dispatches on detected IDEs to install
 *      skills at the IDE-specific target root.
 *
 * Future slices add Cursor / Codex / Qoder / Tongyi Lingma by filling
 * the per-IDE values on the adapter; the accessors and the dispatch
 * layer do not change.
 */
import type { IdeId, IdeSkillInstall, IdeStandardsProfile } from './ide-types.js';
import { getAdapter, listAdapterIds } from './ide-registry.js';

/** Result of `detectAllResourceTargets` — one entry per registered adapter. */
export interface ResourceTarget {
  readonly ideId: IdeId;
  readonly standardsProfile: IdeStandardsProfile | null;
  readonly skillInstall: IdeSkillInstall | null;
}

/**
 * Look up the standards-file profile for a given IDE. Returns `null`
 * if the adapter is registered but does not declare a standards profile
 * (Trae in slice #011 — annotated `Standards: UNVERIFIED` for slice #012+).
 * Throws if the IDE id is not registered at all.
 */
export function getStandardsProfile(ideId: IdeId): IdeStandardsProfile | null {
  const adapter = getAdapter(ideId);
  return adapter.standardsProfile ?? null;
}

/**
 * Look up the skill-install profile for a given IDE. Returns `null`
 * if the adapter does not declare one (Trae in slice #011). Throws
 * if the IDE id is not registered.
 */
export function getSkillInstall(ideId: IdeId): IdeSkillInstall | null {
  const adapter = getAdapter(ideId);
  return adapter.skillInstall ?? null;
}

/**
 * Enumerate all registered adapters and return their resource profiles.
 * Used by `install-skills.mjs` (and any future fan-out consumer) that
 * needs to install across multiple IDEs at once. Returns the profiles
 * in adapter insertion order.
 */
export function detectAllResourceTargets(): readonly ResourceTarget[] {
  return listAdapterIds().map((ideId) => ({
    ideId,
    standardsProfile: getStandardsProfile(ideId),
    skillInstall: getSkillInstall(ideId),
  }));
}
