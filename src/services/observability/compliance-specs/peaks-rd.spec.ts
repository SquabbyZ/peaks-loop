/**
 * `src/services/observability/compliance-specs/peaks-rd.spec.ts`
 *
 * The pilot compliance spec for `peaks-rd`: the steps the RD skill declares,
 * and the artifact that proves each one ran.
 *
 * WHY THESE STEPS. The near-miss question is about checks that can be SKIPPED
 * and still leave a green gate, so the steps here are the ones the skill's own
 * text makes obligatory: the per-request artifact every RD invocation must
 * write, the handoff capsule the RD side hands to QA, the parallel review
 * fan-out's code review and Karpathy review, and the two independent audits
 * the RD gate demands — the security audit and its sibling, the perf audit.
 * The RD-side perf baseline is the conditional one — the skill demands it only
 * for a slice with a user-visible performance surface — so its absence is not
 * a violation and it stays out of the denominator.
 *
 * THE TWO AUDITS ARE SIBLINGS, AND BOTH ARE HERE. The v2.12.0 fan-out
 * collapse moved the security-reviewer and perf-baseline-reviewer slots out of
 * the review fan-out into two standalone audit skills that write
 * `audit/security-<rid>.md` and `audit/perf-<rid>.md`. A spec that modelled
 * one audit and not the other would let the compliance rate read "peaks-rd
 * does its job" while half the parallel audit obligation went unmeasured.
 *
 * THE PATHS ARE SESSION-RELATIVE, the same vocabulary the artifact-
 * prerequisite table stores, so this spec and that table cannot disagree about
 * where an artifact lives. The one path the table does NOT name is declared
 * as a contract gap below rather than quietly used.
 *
 * THE ORDERING IS REAL. The independent audit skills read the immutable
 * peaks-prd handoff and refuse without it, so an audit artifact on disk while
 * the handoff is missing is not evidence of an audit — which is what the
 * `afterStep` edge encodes.
 *
 * `source` names the FILE the steps come from, because the steps come from
 * several sections of it; each step's description names its own section.
 */

import type { ComplianceContractGap, ComplianceSpec } from '../compliance-spec.js';

/** The steps `peaks-rd` declares, as the compliance spec sees them. */
export const PEAKS_RD_SPEC: ComplianceSpec = {
  id: 'peaks-rd',
  source: 'skills/bee/peaks-rd/SKILL.md',
  owner: 'peaks-rd',
  steps: [
    {
      id: 'rd-request-artifact',
      description:
        'Mandatory per-request artifact: the durable RD record of the request (red-line scope, coverage status, slice contract, implementation evidence, handoff).',
      required: true,
      ownerSkill: 'peaks-rd',
      verify: { artifactExists: 'rd/requests/<rid>.md' }
    },
    {
      id: 'rd-handoff',
      description:
        'The handoff capsule the RD side hands to peaks-qa: mode, scope, coverage status, validated decisions, current slice, artifact paths, blockers and next action.',
      required: true,
      ownerSkill: 'peaks-prd',
      verify: { artifactExists: 'prd/handoff-<rid>.md' }
    },
    {
      id: 'rd-code-review',
      description:
        'Parallel review fan-out: the code-reviewer wrote the per-slice code review, which is the Gate B3 evidence.',
      required: true,
      ownerSkill: 'peaks-rd',
      verify: { artifactExists: 'rd/code-review-<rid>.md' }
    },
    {
      id: 'rd-karpathy-review',
      description:
        'Parallel review fan-out: the karpathy-reviewer wrote the per-slice Karpathy review, which is the hard Karpathy-Gate.',
      required: true,
      ownerSkill: 'peaks-rd',
      verify: { artifactExists: 'rd/karpathy-review-<rid>.md' }
    },
    {
      id: 'rd-security-audit',
      description:
        'The independent security audit wrote its per-slice verdict; it reads the immutable handoff, so it cannot have run without one.',
      required: true,
      ownerSkill: 'peaks-security-audit',
      verify: { artifactExists: 'audit/security-<rid>.md' },
      afterStep: 'rd-handoff'
    },
    {
      id: 'rd-perf-audit',
      description:
        'The independent perf audit wrote its per-slice verdict; like the security audit it reads the immutable handoff, so it cannot have run without one.',
      required: true,
      ownerSkill: 'peaks-perf-audit',
      verify: { artifactExists: 'audit/perf-<rid>.md' },
      afterStep: 'rd-handoff'
    },
    {
      id: 'rd-perf-baseline',
      description:
        'The RD-side perf baseline. OPTIONAL: the skill demands it only for a slice with a user-visible performance surface, so its absence on any other slice is not a violation.',
      required: false,
      ownerSkill: 'peaks-rd',
      verify: { artifactExists: 'rd/perf-baseline.md' }
    }
  ]
};

/**
 * The paths this spec verifies that the artifact-prerequisite table does not
 * name.
 *
 * RD's per-request artifact is the one: the transition table gates the handoff
 * and the fan-out evidence, while the per-request artifact is read by the RD
 * handoff-coverage audit instead. That is a real difference between the two
 * mechanisms, and it is why the path is declared here rather than assumed to be
 * in the table.
 */
export const PEAKS_RD_CONTRACT_GAPS: readonly ComplianceContractGap[] = [
  {
    path: 'rd/requests/<rid>.md',
    reason:
      "the artifact-prerequisite table does not name RD's per-request artifact; the RD handoff-coverage audit reads it instead, so the table cannot be the only reader of the contract"
  }
];
