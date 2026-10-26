/**
 * `src/services/observability/owner-skill-map.ts`
 *
 * The path → owning-skill lookup. An artifact path says WHAT is missing;
 * this table says WHO was supposed to produce it, so a reader of the
 * observability stream can name the skill that failed to deliver rather
 * than only counting the failure.
 *
 * WHY A TABLE AND NOT A RULE. The artifact directories are not derivable
 * from the path shape: `audit/security-<rid>.md` and `audit/perf-<rid>.md`
 * live under the same directory and belong to two different skills, and a
 * rule that said "anything under `audit/` is an audit artifact" would name
 * neither. The table states the ownership explicitly, and the more specific
 * prefix wins when two could match.
 *
 * WHY THERE IS NO `audit/` CATCH-ALL. A directory-level entry for `audit/`
 * would attribute both audit artifacts to one skill, which is the
 * ambiguity this table exists to remove. The audit entries are the
 * specific ones instead — one per artifact, and one per location that
 * artifact is written at.
 *
 * WHY THE LOOKUP ANSWERS `null`. An unknown path has no owner that this
 * table can name, and a guessed owner is worse than none: it would put a
 * skill's name on an artifact that skill never produces.
 */

/** One row of the map: a path prefix and the skill that owns what it names. */
export type OwnerSkillEntry = {
  readonly prefix: string;
  readonly skill: string;
};

/**
 * The map, in declaration order. The LOOKUP sorts by prefix length, so this
 * order is documentation, not the resolution order.
 */
export const OWNER_SKILL_ENTRIES: readonly OwnerSkillEntry[] = [
  { prefix: 'audit/security-', skill: 'peaks-security-audit' },
  // The bare security audit location — the one that predates the request id
  // in the filename. It is a live tier, not a guess: the judged-declaration
  // check resolves the audit artifact through `securityArtifactTiers`, and
  // that list's second entry is this file — so a session holding it puts that
  // path into the missing list, and a row that did not claim it would leave
  // that missing artifact with no owner.
  { prefix: 'audit/security.md', skill: 'peaks-security-audit' },
  { prefix: 'audit/perf-', skill: 'peaks-perf-audit' },
  { prefix: 'prd/', skill: 'peaks-prd' },
  { prefix: 'ui/', skill: 'peaks-ui' },
  { prefix: 'rd/', skill: 'peaks-rd' },
  { prefix: 'qa/', skill: 'peaks-qa' },
  { prefix: 'sc/', skill: 'peaks-sc' },
  { prefix: 'mut/', skill: 'peaks-mut' }
];

/**
 * The same rows, most specific prefix first. A longer prefix is a narrower
 * claim, so it is tried first — that is what keeps `audit/security.md` ahead
 * of `audit/security-`, and both ahead of a shorter prefix that would also
 * match them.
 */
const ENTRIES_BY_SPECIFICITY: readonly OwnerSkillEntry[] = [...OWNER_SKILL_ENTRIES].sort(
  (a, b) => b.prefix.length - a.prefix.length
);

/**
 * The skill that owns the artifact at `path`, or `null` when no row claims
 * it.
 */
export function ownerSkillForPath(path: string): string | null {
  for (const entry of ENTRIES_BY_SPECIFICITY) {
    if (path.startsWith(entry.prefix)) return entry.skill;
  }
  return null;
}
