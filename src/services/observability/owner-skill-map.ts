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
 * WHY THE LOOKUP ANSWERS `null`. A path has no owner that this table can
 * name, and a guessed owner is worse than none: it would put a skill's name
 * on an artifact that skill never produces. The paths that are genuinely
 * ownerless are listed in `UNOWNED_PATH_ENTRIES` with the reason, so that
 * "no owner" is always a stated fact and never a gap.
 *
 * TWO KINDS OF ROW. A row is a PREFIX claim by default — the path starts
 * with it — and an EXACT claim when it says so. The exact rows exist for
 * the bare, file-shaped legacy locations: a prefix claim on a file name
 * would also claim every file whose name merely starts with it, and an
 * artifact that was never produced must not be attributed to the skill
 * that owns a different file with a similar name.
 *
 * THE `gateEvidence.*` ROWS ARE DECLARATION KEYS, NOT PATHS. The handoff
 * capsule declares the evidence Gate C will check, and a declared key that
 * names a file that is not on disk reaches the missing list under the key's
 * own name. The owner of a key is the skill that produces the evidence the
 * key names — the same question the artifact rows answer, asked of a
 * declaration instead of a file.
 */

/** One row of the map: a path prefix and the skill that owns what it names. */
export type OwnerSkillEntry = {
  readonly prefix: string;
  readonly skill: string;
  /**
   * True when `prefix` names ONE file rather than a directory of files: the
   * match is the whole path, not its start.
   */
  readonly exact?: boolean;
};

/**
 * The map, in declaration order. The LOOKUP sorts by prefix length, so this
 * order is documentation, not the resolution order.
 */
export const OWNER_SKILL_ENTRIES: readonly OwnerSkillEntry[] = [
  { prefix: 'gateEvidence.codeReview', skill: 'peaks-rd' },
  { prefix: 'gateEvidence.perfBaseline', skill: 'peaks-perf-audit' },
  { prefix: 'gateEvidence.prdHandoff', skill: 'peaks-prd' },
  // The project scan is Gate A's artifact, and Gate A belongs to the
  // orchestrator: `skills/peaks-code/SKILL.md` carries it as the MANDATORY
  // "Pre-RD project scan checklist", and
  // `skills/peaks-code/references/project-scan-checklist.md` opens with
  // "Before handing off to `peaks-rd`, scan the project and record findings
  // to `.peaks/project-scan/project-scan.md`". The declared path is that
  // file, so the skill that writes it is the one that owns the key.
  { prefix: 'gateEvidence.projectScan', skill: 'peaks-code' },
  // The security review evidence. For the fanout types the key declares
  // `audit/security-<rid>.md`, which the independent security audit writes;
  // for the `config` type it declares the config-specific
  // `rd/security-review-<rid>.md`, which the same audit skill writes — the
  // `config` type demands the security review and nothing else, and the
  // review itself is still the audit skill's work. One key, one answer — the
  // row names the skill that owns the security review as a concept, which is
  // the audit skill for every type that reaches it.
  { prefix: 'gateEvidence.securityReview', skill: 'peaks-security-audit' },
  { prefix: 'audit/security-', skill: 'peaks-security-audit' },
  // The bare security audit location — the one that predates the request id
  // in the filename. It is a live tier, not a guess: the judged-declaration
  // check resolves the audit artifact through `securityArtifactTiers`, and
  // that list's second entry is this file — so a session holding it puts that
  // path into the missing list, and a row that did not claim it would leave
  // that missing artifact with no owner. EXACT, because the row claims this
  // one file and not every file whose name begins with it.
  { prefix: 'audit/security.md', skill: 'peaks-security-audit', exact: true },
  { prefix: 'audit/perf-', skill: 'peaks-perf-audit' },
  // The bare perf audit location — the sibling of the security one above,
  // and the same story: the resolver probes it as a legacy tier.
  { prefix: 'audit/perf.md', skill: 'peaks-perf-audit', exact: true },
  { prefix: 'prd/', skill: 'peaks-prd' },
  { prefix: 'ui/', skill: 'peaks-ui' },
  { prefix: 'rd/', skill: 'peaks-rd' },
  // The third-party review is the REVIEWER's artifact, not RD's: the prereq
  // that demands it names the skill that writes it ("v2.14.0 G4 third-party
  // reviewer (peaks-reviewer skill)"). The `rd/` row above is a DIRECTORY
  // claim, so without this row it over-claimed this file and named the wrong
  // skill to fix.
  { prefix: 'rd/third-party-review-', skill: 'peaks-reviewer' },
  // The security review is the AUDIT skill's artifact, not RD's: the
  // judged-declaration check resolves the security audit artifact through
  // `securityArtifactTiers`, and that list names these two files as the
  // tiers the audit writes at. The `gateEvidence.securityReview` declaration
  // key already names that skill, so the key side and the path side said
  // different things about one file. The `rd/` row above is a DIRECTORY
  // claim, so without these rows it over-claimed this file and pointed a
  // reader at the wrong skill — the same shape the `rd/third-party-review-`
  // row fixes.
  //
  // TWO ROWS, BECAUSE THE TWO LOCATIONS HAVE TWO SHAPES. The file that
  // carries the request id in its name is a PREFIX claim, exactly like the
  // third-party review above it. The legacy tier is the bare file name with
  // no request id in it, so it is EXACT — the same reason `audit/security.md`
  // above is EXACT: a prefix claim on that name would also claim every file
  // whose name merely starts with it.
  { prefix: 'rd/security-review-', skill: 'peaks-security-audit' },
  { prefix: 'rd/security-review.md', skill: 'peaks-security-audit', exact: true },
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
 * A shape of path that has no owning skill, and the reason it has none.
 *
 * The list exists so that "no owner" is a STATED fact. A path that reaches
 * the missing list and is neither in the map nor here is a hole, and the
 * census test is what turns that hole into a red test.
 */
export type UnownedPathEntry = {
  /** The path prefix that identifies the shape. */
  readonly prefix: string;
  /** Why no skill owns a path of this shape. */
  readonly reason: string;
};

/**
 * The paths that have no owner, and why.
 *
 * `gateEvidence(<status>)` is a handoff capsule whose declaration cannot be
 * read. It is not an artifact: no skill produces a broken capsule, so there
 * is no owner to name — the defect belongs to whoever wrote the capsule, and
 * the gate reports it as a body failure on the capsule itself.
 */
export const UNOWNED_PATH_ENTRIES: readonly UnownedPathEntry[] = [
  {
    prefix: 'gateEvidence(',
    reason:
      'a handoff capsule whose gateEvidence declaration cannot be read is not an artifact ' +
      'any skill produces — the defect belongs to whoever wrote the capsule, so there is ' +
      'no owning skill to name'
  }
];

/**
 * The skill that owns the artifact at `path`, or `null` when no row claims
 * it.
 *
 * Total over every input: a value that is not a string answers `null` rather
 * than raising, because this runs inside the observability emit, whose
 * contract is that it never throws and never changes the caller's decision.
 */
export function ownerSkillForPath(path: string): string | null {
  if (typeof path !== 'string') return null;
  for (const entry of ENTRIES_BY_SPECIFICITY) {
    const claimed = entry.exact === true ? path === entry.prefix : path.startsWith(entry.prefix);
    if (claimed) return entry.skill;
  }
  return null;
}

/**
 * The reason the path at `path` has no owning skill, or `null` when the
 * path is not one of the known ownerless shapes.
 */
export function unownedPathReason(path: string): string | null {
  if (typeof path !== 'string') return null;
  for (const entry of UNOWNED_PATH_ENTRIES) {
    if (path.startsWith(entry.prefix)) return entry.reason;
  }
  return null;
}
