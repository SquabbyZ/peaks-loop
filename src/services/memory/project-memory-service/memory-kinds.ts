// ---------------------------------------------------------------------------
// Canonical memory-kind vocabulary + hot/warm tier map.
//
// Extracted from `types.ts` by the `b1-filesplit-campaign` (wave 3, leaf
// `b1w3-c-memory`). This module has no imports — the tuple, the derived
// union type, the tier map and the two tier-filtered arrays reference only
// each other — so it is the leaf of the dependency graph. `types.ts`
// re-exports every name below so downstream callers (the `index.ts` barrel,
// the frontmatter parser, memory-rotate / memory-ingest) keep importing
// them from `./types.js` unchanged.
// ---------------------------------------------------------------------------

/**
 * Canonical memory-kind vocabulary — the single source of truth.
 *
 * The union type, the accepted-kind set in the frontmatter parser, the
 * hot/warm tier map below, `KIND_ORDER` in the reindex view, and the CLI
 * `--kind` help text all derive from this tuple. Adding a kind here is the
 * only edit required; TypeScript then forces `MEMORY_KIND_TIER` to cover it.
 *
 * unchanged. The 13 appended kinds were observed on disk with real values
 * that the index schema rejected (`peaks memory reindex` reported them as
 * `unrecognized kind value`). Accepting them moves those files into the
 * index; files with no kind field at all stay reported as unclassified.
 */
export const PROJECT_MEMORY_KINDS = [
  // Original 8 (pre-2026-09-10).
  'project',
  'rule',
  'decision',
  'reference',
  'feedback',
  'convention',
  'module',
  'lesson',
  // Slice E expansion — observed on-disk values, hot tier.
  'bug',
  'investigation',
  'technical-pattern',
  'project-rule',
  // Slice E expansion — observed on-disk values, warm tier.
  'design',
  'handoff',
  'session-handoff',
  'project-todo',
  'publish-closure',
  'project-closure',
  'slice-closure',
  'slice-pilot-findings',
  'sediment'
] as const;

export type ProjectMemoryKind = (typeof PROJECT_MEMORY_KINDS)[number];

/** Hot kinds keep their body in the always-available index; warm kinds are
 *  indexed with the same entry shape but read on demand. */
export type MemoryKindTier = 'hot' | 'warm';

/**
 * Hot/warm tier per kind. Insertion order IS the deterministic section order
 * used by the generated `MEMORY.md` (`KIND_ORDER` in `index/reindex.ts`),
 * so this object's key order is load-bearing — append new kinds at the end
 * of their tier block rather than reshuffling existing entries.
 *
 * The `Record<ProjectMemoryKind, MemoryKindTier>` annotation makes a missing
 * tier a compile error whenever `PROJECT_MEMORY_KINDS` grows.
 */
export const MEMORY_KIND_TIER: Record<ProjectMemoryKind, MemoryKindTier> = {
  // hot — full body kept in the index
  feedback: 'hot',
  decision: 'hot',
  rule: 'hot',
  convention: 'hot',
  module: 'hot',
  lesson: 'hot',
  bug: 'hot',
  investigation: 'hot',
  'technical-pattern': 'hot',
  'project-rule': 'hot',
  // warm — same entry shape, read on demand
  project: 'warm',
  reference: 'warm',
  design: 'warm',
  handoff: 'warm',
  'session-handoff': 'warm',
  'project-todo': 'warm',
  'publish-closure': 'warm',
  'project-closure': 'warm',
  'slice-closure': 'warm',
  'slice-pilot-findings': 'warm',
  sediment: 'warm'
};

export const HOT_MEMORY_KINDS: readonly ProjectMemoryKind[] = PROJECT_MEMORY_KINDS.filter(
  (kind) => MEMORY_KIND_TIER[kind] === 'hot'
);

export const WARM_MEMORY_KINDS: readonly ProjectMemoryKind[] = PROJECT_MEMORY_KINDS.filter(
  (kind) => MEMORY_KIND_TIER[kind] === 'warm'
);
