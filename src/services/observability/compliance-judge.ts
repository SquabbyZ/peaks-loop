/**
 * `src/services/observability/compliance-judge.ts`
 *
 * The judge: given a compliance spec and a way to ask whether an artifact
 * exists, report which declared steps actually ran.
 *
 * WHY A JUDGE AND NOT A SCOREBOARD. A pass rate says "the slice passed"; a
 * compliance rate says "the checks the skill PROMISED ran". The difference is
 * the point of the campaign: a slice can pass its gate while a step the skill
 * declared never happened, and only the second reading sees that.
 *
 * THE JUDGE IS PURE. It never touches a filesystem: whether an artifact exists
 * is asked through the `exists` callback the caller supplies. That is what
 * makes one spec judgeable against a real workspace, a fixture, or a
 * hypothetical — and it is why the rules below are statements about RULES
 * rather than about a machine's state.
 *
 * THE DEMOTION RULE, AND WHY IT IS A FIXPOINT. A step that declares
 * `afterStep: X` cannot be credited on the strength of its own artifact when X
 * did not run: the audit that exists without the handoff it read is not
 * evidence of an audit. Demoting one step can invalidate whatever depended on
 * it, so the demotion is applied repeatedly until nothing changes — and since
 * demotion only ever removes a pass, the loop terminates.
 *
 * STEP IDS MUST BE UNIQUE INSIDE A SPEC. The demotion looks a prerequisite up
 * by id, so two steps sharing one id would be judged against each other.
 */

import type { ComplianceSpec } from './compliance-spec.js';

/** What the judge concluded about one declared step. */
export type StepResult = {
  /** The step's id, so a reader can find it in the spec. */
  readonly stepId: string;
  /** Whether the step's artifact was there. */
  readonly executed: boolean;
  /**
   * Why the step did not execute. Present exactly when `executed` is false;
   * absent when it is true, because a passing step has nothing to explain.
   */
  readonly failureReason?: string;
};

/** The verdict for one spec. */
export type ComplianceResult = {
  /** The spec's id. */
  readonly specId: string;
  /** One entry per declared step, in the order the spec declares them. */
  readonly steps: readonly StepResult[];
  /**
   * The share of REQUIRED steps that executed. A spec that declares no
   * required step demonstrates no compliance, so the rate is 0 rather than a
   * vacuous 1: the reading that lets a spec declaring nothing read as
   * perfect compliance is the one this metric exists to refuse.
   */
  readonly complianceRate: number;
};

/**
 * Judge one spec.
 *
 * @param spec the declared steps to judge.
 * @param exists asked whether a session-relative artifact path is present.
 */
export function judgeCompliance(
  spec: ComplianceSpec,
  exists: (artifactPath: string) => boolean
): ComplianceResult {
  const executed = new Map<string, boolean>();
  const reasons = new Map<string, string>();

  for (const step of spec.steps) {
    const present = exists(step.verify.artifactExists);
    executed.set(step.id, present);
    if (!present) {
      reasons.set(step.id, `missing artifact: ${step.verify.artifactExists}`);
    }
  }

  demoteUnsatisfiedPrerequisites(spec, executed, reasons);

  const steps: StepResult[] = spec.steps.map((step) => {
    const ran = executed.get(step.id) === true;
    const reason = reasons.get(step.id);
    if (ran || reason === undefined) {
      return { stepId: step.id, executed: ran };
    }
    return { stepId: step.id, executed: ran, failureReason: reason };
  });

  const required = spec.steps.filter((step) => step.required);
  const executedRequired = required.filter((step) => executed.get(step.id) === true).length;
  const complianceRate = required.length === 0 ? 0 : executedRequired / required.length;

  return { specId: spec.id, steps, complianceRate };
}

/**
 * Demote every step whose prerequisite did not execute, until nothing changes.
 *
 * A step names its prerequisite by id, and the prerequisite may be declared
 * LATER in the spec — which is why this is a fixpoint rather than a single
 * pass in declaration order. A prerequisite the spec does not declare is
 * unsatisfied by definition: a step cannot be credited on the strength of a
 * prerequisite nobody can show.
 */
function demoteUnsatisfiedPrerequisites(
  spec: ComplianceSpec,
  executed: Map<string, boolean>,
  reasons: Map<string, string>
): void {
  const declared = new Set(spec.steps.map((step) => step.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of spec.steps) {
      const prerequisite = step.afterStep;
      if (prerequisite === undefined) continue;
      if (executed.get(step.id) !== true) continue;
      if (prerequisite === step.id) {
        executed.set(step.id, false);
        reasons.set(
          step.id,
          `prerequisite step "${prerequisite}" is this step itself, so no order can be satisfied`
        );
        changed = true;
        continue;
      }
      if (!declared.has(prerequisite)) {
        executed.set(step.id, false);
        reasons.set(
          step.id,
          `prerequisite step "${prerequisite}" is not declared in this spec, so it cannot have run`
        );
        changed = true;
        continue;
      }
      if (executed.get(prerequisite) === true) continue;
      executed.set(step.id, false);
      reasons.set(step.id, `prerequisite step "${prerequisite}" did not execute`);
      changed = true;
    }
  }
}
