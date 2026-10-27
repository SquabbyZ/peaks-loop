/**
 * `src/services/observability/compliance-spec.ts`
 *
 * The vocabulary of a compliance spec: what a skill PROMISED to do, and how
 * each promise is checked.
 *
 * WHY A VOCABULARY OF ITS OWN. The near-miss metric asks how often a passing
 * slice was bought by skipping a check. Answering it needs the checks written
 * down per SKILL, not inferred from a gate: a gate says which artifacts must
 * EXIST at a transition, while a compliance spec says which steps the skill's
 * own contract promised. A spec therefore carries steps that no gate checks at
 * all (the fast lane writes no request artifacts) and steps whose artifacts
 * belong to another skill (the review fan-out writes into qa/ and audit/, and
 * the owner map names who owes each one).
 *
 * THE VERDICT IS NOT A JUDGEMENT. A step is executed when the artifact it
 * names is on disk — nothing else. `judgeCompliance` (compliance-judge.ts)
 * asks the caller whether a path exists, so one spec can be judged against a
 * real workspace, a fixture, or a hypothetical.
 *
 * THE PATHS ARE SESSION-RELATIVE, with the request id still a placeholder.
 * They are the same strings the request-artifact prerequisite table stores
 * (that table's own relativePath values, e.g. `rd/code-review-<rid>.md`), so a
 * spec can be checked against the table mechanically and one spec can be
 * judged for many slices. The CALLER resolves a path against a session
 * directory and a request id before probing the filesystem; the judge itself
 * never touches a disk.
 */

/** One step a skill declares, and the deterministic check that says it ran. */
export type ComplianceStep = {
  /** Stable id of the step inside its spec. */
  readonly id: string;
  /** What the step is, in the words of the skill that declares it. */
  readonly description: string;
  /**
   * Whether a missing artifact counts against the compliance rate. A step
   * whose obligation is conditional on the slice (a perf baseline on a slice
   * with no perf surface) is not required, so its absence is not a failure.
   */
  readonly required: boolean;
  /**
   * The skill that OWNS the artifact this step proves — the owner map's
   * answer, or the spec's own skill where the map claims no owner. It names
   * the skill a reader must tell when the step did not happen.
   */
  readonly ownerSkill: string;
  /** The deterministic check: the artifact whose presence means the step ran. */
  readonly verify: { readonly artifactExists: string };
  /**
   * The step this one must come after. A step whose prerequisite did not
   * execute cannot be credited on the strength of its own artifact alone: the
   * audit that exists without the handoff it read is not evidence of an audit.
   */
  readonly afterStep?: string;
};

/** The steps one skill declares, and the skill they belong to. */
export type ComplianceSpec = {
  /** Stable id of the spec. */
  readonly id: string;
  /** Where the steps are declared — a pointer into the skill's own file. */
  readonly source: string;
  /** The skill whose contract this spec measures. */
  readonly owner: string;
  /** The declared steps, in the order the skill declares them. */
  readonly steps: readonly ComplianceStep[];
};

/**
 * A path a spec verifies that the request-artifact prerequisite table does
 * NOT name.
 *
 * WHY THE LIST IS DATA AND NOT A COMMENT. A comment cannot be checked, and an
 * uncheckable exception is an exception that grows. Naming the gap makes the
 * absence visible to a reader AND lets a test refuse it the moment the
 * contract catches up — at which point the declaration must go.
 */
export type ComplianceContractGap = {
  /** The session-relative path the step verifies. */
  readonly path: string;
  /** Why the contract does not name it yet. */
  readonly reason: string;
};
