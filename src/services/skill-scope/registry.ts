/**
 * `peaks skill scope` — adapter registry.
 *
 * The registry owns the map from IdeId → SkillScopeAdapter. It exposes two
 * functions:
 * - `getScopeAdapter(ide)` — direct lookup. Throws on unknown ide.
 * - `resolveActiveAdapter(projectRoot)` — discover the best adapter by
 *   probing every registered adapter's `detect(projectRoot)`. Falls back
 *   to Claude Code with a synthetic score of 0.5 when no adapter scores
 *   ≥ 0.5 (R3: "Claude Code shipped, Trae in progress" per package.json).
 *
 * See tech-doc-025 §7 for the discovery flow + fallback semantics.
 */

import type { IdeId } from '../ide/ide-types.js';
import type { SkillScopeAdapter } from './types.js';
import { CLAUDE_CODE_SKILL_SCOPE } from './adapters/claude-code.js';
import { CODEX_SKILL_SCOPE } from './adapters/codex.js';
import { CURSOR_SKILL_SCOPE } from './adapters/cursor.js';
import { QODER_SKILL_SCOPE } from './adapters/qoder.js';
import { TONGYI_SKILL_SCOPE } from './adapters/tongyi.js';
import { TRAE_SKILL_SCOPE } from './adapters/trae.js';

/**
 * Insertion order: Claude Code first (shipped), then Trae (in progress),
 * then the four roadmap IDEs. The CLI's `--ide <name>` overrides this map.
 */
const SCOPE_ADAPTERS: ReadonlyMap<IdeId, SkillScopeAdapter> = new Map<IdeId, SkillScopeAdapter>([
  ['claude-code', CLAUDE_CODE_SKILL_SCOPE],
  ['trae', TRAE_SKILL_SCOPE],
  ['codex', CODEX_SKILL_SCOPE],
  ['cursor', CURSOR_SKILL_SCOPE],
  ['qoder', QODER_SKILL_SCOPE],
  ['tongyi-lingma', TONGYI_SKILL_SCOPE],
]);

/** Get the adapter for a given IDE id. Throws on unsupported IDE. */
export function getScopeAdapter(ide: IdeId): SkillScopeAdapter {
  const adapter = SCOPE_ADAPTERS.get(ide);
  if (adapter === undefined) {
    throw new Error(
      `No SkillScopeAdapter for IDE: ${ide}. Registered: ${listScopeAdapterIds().join(', ') || '(none)'}`
    );
  }
  return adapter;
}

/** All registered adapter ids (insertion order). */
export function listScopeAdapterIds(): readonly IdeId[] {
  return Array.from(SCOPE_ADAPTERS.keys());
}

/** All registered adapters (insertion order). */
export function listScopeAdapters(): readonly SkillScopeAdapter[] {
  return Array.from(SCOPE_ADAPTERS.values());
}

export interface ResolvedAdapter {
  readonly adapter: SkillScopeAdapter;
  readonly score: number;
  /** True when the score is synthetic (no real adapter hit ≥ 0.5). */
  readonly isFallback: boolean;
}

/**
 * Discover the active adapter for a project root. Returns the highest-
 * scoring adapter; if all adapters score < 0.5, falls back to the Claude
 * Code adapter with a synthetic score of 0.5 (R3). Stubs (Trae, Cursor,
 * Codex, Qoder, Tongyi) return 0.0 from `detect()` so they never win.
 */
export async function resolveActiveAdapter(projectRoot: string): Promise<ResolvedAdapter> {
  let best: { adapter: SkillScopeAdapter; score: number } | null = null;
  for (const adapter of SCOPE_ADAPTERS.values()) {
    const score = await adapter.detect(projectRoot);
    if (best === null || score > best.score) {
      best = { adapter, score };
    }
  }
  if (best === null || best.score < 0.5) {
    return { adapter: CLAUDE_CODE_SKILL_SCOPE, score: 0.5, isFallback: true };
  }
  return { adapter: best.adapter, score: best.score, isFallback: false };
}

/**
 * Test seam: replace the registry (used by stub-adapter tests to inject
 * a fresh adapter for an IDE without restarting the module).
 */
export function _setScopeAdapterForTesting(ide: IdeId, adapter: SkillScopeAdapter): void {
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set(ide, adapter);
}

/** Test seam: reset to built-in defaults. */
export function _resetScopeAdaptersForTesting(): void {
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).clear();
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set('claude-code', CLAUDE_CODE_SKILL_SCOPE);
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set('trae', TRAE_SKILL_SCOPE);
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set('codex', CODEX_SKILL_SCOPE);
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set('cursor', CURSOR_SKILL_SCOPE);
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set('qoder', QODER_SKILL_SCOPE);
  (SCOPE_ADAPTERS as Map<IdeId, SkillScopeAdapter>).set('tongyi-lingma', TONGYI_SKILL_SCOPE);
}