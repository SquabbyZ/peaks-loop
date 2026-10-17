/**
 * peaks-workflow — the QA phase, derived from the type tables.
 *
 * WHY THIS IS A MODULE OF ITS OWN. A measured budget, not taste: the file-size
 * census records the gated excess by EQUALITY, and `pipeline-verify-gate-support`
 * already carries its share of that sum. A file under its cap adds nothing to it,
 * so the reasoning below — which a contributor has to be able to find — is paid
 * for here, at zero census cost.
 *
 * WHY A DERIVATION AT ALL. Two layers answered one question — *does this request
 * need a QA phase?* — and gave different answers, because neither read the answer
 * off the type tables that define the contract. One named three request types;
 * the other asked unconditionally. A request whose table carries no QA row at all
 * therefore satisfied every prerequisite its own contract lists and was then
 * refused at commit time for a phase that contract never asked for.
 *
 * The tables are the authority. `MINIMAL_TABLE` carries no `qa:` row, which is
 * what "these types have no QA phase" has always meant, and what
 * `request transition --role qa --state verdict-issued` has always enforced
 * against the same table.
 *
 * WHY IT IS ARMED. A derivation nobody checks is a restatement with better
 * manners. A table row can name a QA artifact no gate stands for, and that row
 * would then build no gate and say nothing about it — the same drift, one layer
 * down. So the declared gate list is reconciled against every type's QA rows once
 * per process, and a mismatch THROWS. The cost is deliberate and wider than it
 * looks: the CLI registers every command eagerly, so an unrepresentable row does
 * not merely fail `verify-pipeline` — it fails EVERY `peaks` invocation that
 * reaches this module, the commit leg and `workflow verdict-aggregate` included.
 * That is the fail-closed
 * direction, and naming the row keeps the repair one line.
 */

import {
  getPrerequisitesFor,
  VALID_REQUEST_TYPES,
  type ArtifactPrerequisite,
  type RequestType
} from '../artifacts/artifact-prerequisites.js';
import { allowedStatesForRole } from '../artifacts/request-artifact-state-helpers.js';
import type { PipelineGate } from './pipeline-verify-types.js';

/**
 * Every state the QA role can be in, taken from the repository's own state model
 * rather than restated here.
 *
 * WHY IT IS NOT JUST `verdict-issued`. The terminal state is the one the phase's
 * evidence is resolved at, so an earlier version keyed both the derivation and the
 * reconciliation to it alone — which left the `qa:running` row a feature's table
 * already carries outside the arming. A row at any other state would have been
 * silently unrepresentable. The arming is total over the state axis instead.
 */
export const QA_STATES = allowedStatesForRole('qa');

/**
 * Every QA evidence gate the checker can build, each naming the contract path it
 * stands for. The NAME is the checker's own — `peaks workflow skip` takes gate
 * names and the violation text prints the description — while the PATH is the
 * contract's, and it is the half that makes a gate list derivable instead of
 * restated beside the tables it is supposed to be read from.
 */
export const QA_EVIDENCE_GATES: ReadonlyArray<{
  name: string;
  description: string;
  relativePath: string;
}> = [
  { name: 'test-cases', description: 'QA test cases', relativePath: 'qa/test-cases/<rid>.md' },
  {
    name: 'test-report',
    description: 'QA test report with execution results',
    relativePath: 'qa/test-reports/<rid>.md'
  }
];

/**
 * Every QA prerequisite this type's table carries, at any state the QA role can
 * be in.
 *
 * THE REFUSAL IS NAMED ON PURPOSE. `getPrerequisitesFor` reads a record keyed by
 * type, so a non-member reaches `undefined` and throws a bare `TypeError` — before
 * the derivation existed, a list of names answered such a caller with a gate list
 * instead. A value that no longer works must say what it wanted, which value it
 * got, and what the alternatives are.
 */
function qaPrerequisitesOfType(requestType: RequestType): ReadonlyArray<ArtifactPrerequisite> {
  if (!VALID_REQUEST_TYPES.includes(requestType)) {
    throw new Error(
      `pipeline-verify: "${String(requestType)}" is not a request type — expected one of ${VALID_REQUEST_TYPES.join(', ')}`
    );
  }
  return QA_STATES.flatMap((state) => getPrerequisitesFor('qa', state, requestType));
}

/**
 * Does this type's table carry a QA phase?
 *
 * One derivation, so the gate list and the checker's verdict cannot disagree: the
 * phase exists for a type exactly when its table carries a QA prerequisite —
 * counted across every QA state, so a type whose only QA row sits at a
 * non-terminal state is not read as having no phase at all.
 */
export function typeRequiresQaPhase(requestType: RequestType): boolean {
  return qaPrerequisitesOfType(requestType).length > 0;
}

/**
 * The request types whose table carries NO QA phase — the set a skip may cover.
 *
 * DERIVED, not listed. The skip allowlist used to spell `['docs', 'config', 'chore']`,
 * and `config` carries a QA phase (its table demands `SECURITY_REVIEW` and
 * `TEST_REPORT`), so a plantable record could bypass a phase the contract requires.
 * Reading the answer off the same derivation the pipeline uses means a table change
 * moves the allowlist with it — in both directions, without anyone remembering.
 */
export const QA_FREE_TYPES: ReadonlyArray<RequestType> = Object.freeze(
  VALID_REQUEST_TYPES.filter((requestType) => !typeRequiresQaPhase(requestType))
);

/**
 * Fill in the QA request gate for a phase that HAS one.
 *
 * A type whose table carries no QA row has no QA gate to fill, and that is not a
 * special case to handle at the call site: the artifact is still honoured — its
 * state and its location are read either way — so a tree that ran QA for a type
 * whose table does not demand it keeps passing.
 */
export function markQaRequestGate(gates: PipelineGate[], artifactPath: string): void {
  const requestGate = gates[0];
  if (requestGate === undefined) return;
  requestGate.passed = true;
  requestGate.detail = `found at ${artifactPath}`;
}

/**
 * The QA phase's gate list for one type: the phase gate when the phase exists,
 * then one gate per piece of evidence the caller resolved from the contract. An
 * empty list IS the answer for a type with no QA phase.
 *
 * The `security-findings` / `performance-findings` gates were removed here
 * security review or performance review — `peaks-qa/SKILL.md` says so, and the
 * v2.11.0 D1/D4 trim dropped both from every `qa:verdict-issued` table. The
 * evidence they used to demand is now checked on the RD side, at the paths the
 * contract actually names (`audit/security-<rid>.md`, `audit/perf.md` and
 * `rd/security-review.md` / `rd/perf-baseline.md` as the declared legacy tiers
 * behind them).
 */
export function qaPhaseGates(
  required: boolean,
  evidence: ReadonlyArray<{ name: string; description: string }>
): PipelineGate[] {
  if (!required) return [];

  const gates: PipelineGate[] = [
    {
      name: 'qa-request-exists',
      description: 'QA request artifact created',
      passed: false,
      detail: ''
    }
  ];
  for (const gate of evidence) {
    gates.push({ name: gate.name, description: gate.description, passed: false, detail: '' });
  }
  return gates;
}

/**
 * THE ARM — the reconciliation behind the load-time refusal below.
 *
 * `prerequisitesOfType` is a parameter rather than a direct call so an arm can
 * drive this with a table of its own. That is the only way to show the refusal is
 * reachable: a check that can only ever run against the table it already agrees
 * with cannot be observed to fail.
 *
 * It is handed EVERY QA state's rows — `qaPrerequisitesOfType` above, whose
 * `QA_STATES` is the repository's own model — so a `qa:` row at a state the phase
 * does not end in is armed too. Keying only the terminal state is how the
 * `qa:running` row went unarmed.
 */
function qaGateReconciliationFailures(
  types: ReadonlyArray<RequestType>,
  prerequisitesOfType: (requestType: RequestType) => ReadonlyArray<ArtifactPrerequisite>
): string[] {
  const failures: string[] = [];
  for (const requestType of types) {
    for (const prerequisite of prerequisitesOfType(requestType)) {
      // The same path set the contract resolver matches on, so a row accepted
      // through a legacy tier is covered by the gate that tier stands behind.
      const contractPaths = [
        prerequisite.relativePath,
        ...(prerequisite.legacyRelativePath !== undefined ? [prerequisite.legacyRelativePath] : []),
        ...(prerequisite.legacyRelativePaths ?? [])
      ];
      if (QA_EVIDENCE_GATES.some((gate) => contractPaths.includes(gate.relativePath))) continue;
      failures.push(
        `the "${requestType}" table carries the QA prerequisite ${prerequisite.relativePath} and no gate in QA_EVIDENCE_GATES stands for it`
      );
    }
  }
  return failures;
}

const QA_GATE_RECONCILIATION_FAILURES = qaGateReconciliationFailures(
  VALID_REQUEST_TYPES,
  qaPrerequisitesOfType
);
if (QA_GATE_RECONCILIATION_FAILURES.length > 0) {
  throw new Error(
    `pipeline-verify: the QA gate list does not follow the type tables — ${QA_GATE_RECONCILIATION_FAILURES.join('; ')}`
  );
}
