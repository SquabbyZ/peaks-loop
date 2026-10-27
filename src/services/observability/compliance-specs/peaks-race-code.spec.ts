/**
 * `src/services/observability/compliance-specs/peaks-race-code.spec.ts`
 *
 * The pilot compliance spec for `peaks-race-code`: the steps the fast lane
 * says it performs, and the artifact that proves each one ran.
 *
 * WHY THE FAST LANE IS THE SECOND PILOT. The fast lane writes no Gate A–G
 * file chain, no planning document and no review envelope — it says so itself
 * in the section "What this lane does not write". So its steps are exactly the
 * two obligations it does keep: the session workspace the driver binds to, and
 * the one short record that carries the need, the files changed, the four
 * completion proofs and any risk row. The lane is the cheapest place to see
 * the metric work on a skill whose obligations are small enough to read.
 *
 * THE PATHS ARE SESSION-RELATIVE, the same vocabulary the artifact-
 * prerequisite table stores, so a caller resolves one shape for every spec.
 *
 * AND BOTH PATHS ARE CONTRACT GAPS, WHICH IS THE FINDING. The prerequisite
 * table names no artifact of the fast lane at all, so every path this spec
 * verifies is one the contract does not yet read. That is declared below
 * rather than assumed away: a gate that never asked for the lane's evidence
 * cannot report the lane skipping it.
 */

import type { ComplianceContractGap, ComplianceSpec } from '../compliance-spec.js';

/** The steps `peaks-race-code` declares, as the compliance spec sees them. */
export const PEAKS_RACE_CODE_SPEC: ComplianceSpec = {
  id: 'peaks-race-code',
  source: 'skills/peaks-race-code/SKILL.md',
  owner: 'peaks-race-code',
  steps: [
    {
      id: 'race-session-workspace',
      description:
        'The session workspace exists: `peaks workspace init --project .` ran once, and the driver binds to it.',
      required: true,
      ownerSkill: 'peaks-race-code',
      verify: { artifactExists: 'session.json' }
    },
    {
      id: 'race-trace-record',
      description:
        'The one short record exists: the need in one sentence, the lane and who chose it, the files changed, the four completion proofs with their actual results, and any risk row hit.',
      required: true,
      ownerSkill: 'peaks-race-code',
      verify: { artifactExists: 'race/<rid>.md' },
      afterStep: 'race-session-workspace'
    }
  ]
};

/**
 * The paths this spec verifies that the artifact-prerequisite table does not
 * name.
 *
 * BOTH of the lane's obligations are here, and the reason is the lane's own
 * design: it writes no request artifacts, so the transition table — which
 * gates request artifacts — has no row for anything it produces. The lane's
 * evidence is checked by nothing today, which is exactly the gap this metric
 * is built to make visible.
 */
export const PEAKS_RACE_CODE_CONTRACT_GAPS: readonly ComplianceContractGap[] = [
  {
    path: 'session.json',
    reason:
      "the artifact-prerequisite table names no session-workspace file, so nothing in the transition contract reads the fast lane's own workspace binding"
  },
  {
    path: 'race/<rid>.md',
    reason:
      "the artifact-prerequisite table names no race-lane record, so the trace that carries the lane's four completion proofs is read by no gate"
  }
];
