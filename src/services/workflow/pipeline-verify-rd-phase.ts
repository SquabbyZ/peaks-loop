/**
 * peaks-workflow — the RD evidence gates, derived from the type tables.
 *
 * WHY THIS IS A MODULE OF ITS OWN. The same measured budget as
 * `pipeline-verify-qa-phase.ts`: the file-size census records gated excess by
 * EQUALITY, and `pipeline-verify-gate-support` already carries its share of that
 * sum. A file under its cap adds nothing to it, so the reasoning below is paid
 * for here at zero census cost.
 *
 * WHY A DERIVATION AT ALL. `rdGatesForType` answered "which evidence does RD
 * owe" with three hand-written type lists — `=== 'bugfix'`, `!== 'docs' &&
 * !== 'chore' && !== 'config'`, and a four-name union — none of which read the
 * `artifact-prerequisites.ts` table that `peaks request transition` enforces.
 * The table is the authority: a type whose `rd:qa-handoff` row carries the
 * prerequisite owes that evidence, and a type whose row does not owes none.
 *
 * WHY THE `relativePath`s ARE THE BARE NAMES. Each row's path is the probe name
 * the contract accessor is asked about, and each is a path the contract accepts.
 * `rd/security-review.md` is load-bearing: it is the legacy tier of BOTH the
 * fanout `AUDIT_SECURITY` row (feature / bugfix / refactor) and the
 * `SECURITY_REVIEW` row config uses. The canonical `audit/security-<rid>.md` is
 * carried only by the former, so deriving off it would silently drop config's
 * security gate — the six-type table in `pipeline-verify-rd-gates.test.ts` pins
 * that.
 */

import type { RequestType } from '../artifacts/artifact-prerequisites.js';
// A LIVE-BINDING CYCLE: `pipeline-verify-gate-support` re-exports
// `rdGatesForType` from this module while this module reads its
// `contractEvidencePaths`. Both are function declarations, which ESM initialises
// during instantiation, so the binding is safe — but only while nothing here
// CALLS it at module load. The derivation is function-only and the default
// parameter below resolves per call. A leaf-module split would have to move
// `contractPrerequisite` / `contractBodyViolations` with the accessor and expand
// this diff, so the cycle stays bounded to these two files.
import { contractEvidencePaths } from './pipeline-verify-gate-support.js';
import type { PipelineGate } from './pipeline-verify-types.js';

/**
 * Every RD evidence gate the checker can build, each naming the contract path it
 * stands for. The NAME and DESCRIPTION are the checker's own — `peaks workflow
 * skip` takes gate names and the violation text prints the description — while
 * the PATH is the contract's, and it is the half that makes a gate list
 * derivable instead of restated beside the tables it is supposed to be read from.
 */
export const RD_EVIDENCE_GATES: ReadonlyArray<{
  name: string;
  description: string;
  relativePath: string;
}> = [
  // The contract's design / scope record at `rd:qa-handoff`. The retired
  // `rd/tech-doc.md` slot this gate replaced has no prerequisite in any table.
  {
    name: 'prd-handoff',
    description: 'PRD handoff capsule (approved scope + non-goals)',
    relativePath: 'prd/handoff.md'
  },
  {
    name: 'bug-analysis',
    description: 'Bug root-cause analysis',
    relativePath: 'rd/bug-analysis.md'
  },
  { name: 'code-review', description: 'Code review evidence', relativePath: 'rd/code-review.md' },
  {
    name: 'security-review',
    description: 'Security review evidence',
    relativePath: 'rd/security-review.md'
  },
  // `AUDIT_PERF`'s legacy tier. Relocating the gate (rather than deleting it) is
  // what keeps AC3's control meaningful: genuinely absent perf evidence fails.
  {
    name: 'perf-baseline',
    description: 'Performance audit evidence',
    relativePath: 'rd/perf-baseline.md'
  }
];

/** What a type's table carries for one probe name, or null when it carries none. */
export type RdEvidenceLookup = (
  requestType: RequestType,
  relativePath: string
) => readonly string[] | null;

/**
 * The RD gate list for one type: the request gate, then one gate per evidence
 * row this type's table carries.
 *
 * `lookup` is a parameter rather than a direct call so an arm can drive the
 * derivation with a contract of its own. That is the only way to show a null
 * drops a gate: a check that only ever runs against the table it already agrees
 * with cannot be observed to drop anything.
 */
export function deriveRdGates(requestType: RequestType, lookup: RdEvidenceLookup): PipelineGate[] {
  const gates: PipelineGate[] = [
    {
      name: 'rd-request-exists',
      description: 'RD request artifact created',
      passed: false,
      detail: ''
    }
  ];
  for (const evidence of RD_EVIDENCE_GATES) {
    if (lookup(requestType, evidence.relativePath) === null) continue;
    gates.push({
      name: evidence.name,
      description: evidence.description,
      passed: false,
      detail: ''
    });
  }
  return gates;
}

/**
 * The production binding: the type's own `rd:qa-handoff` table is the lookup.
 *
 * `lookup` is an optional overrides seam, not configuration: the arm drives this
 * binding with a synthetic contract so a restatement inside the default cannot
 * stay green. Production passes one argument and gets the real table.
 */
export function rdGatesForType(
  requestType: RequestType,
  lookup: RdEvidenceLookup = (type, relativePath) =>
    contractEvidencePaths('rd', 'qa-handoff', type, relativePath)
): PipelineGate[] {
  return deriveRdGates(requestType, lookup);
}

/**
 * The contract path the gate named `gateName` stands for.
 *
 * `resolveRdEvidencePaths` iterates exactly the gate list this module built, so
 * a miss would be a name invented outside the table; it refuses by name rather
 * than dereferencing nothing.
 */
export function rdEvidenceProbe(gateName: string): string {
  const gate = RD_EVIDENCE_GATES.find((entry) => entry.name === gateName);
  if (gate === undefined) {
    throw new Error(
      `pipeline-verify: "${gateName}" is not an RD evidence gate — expected one of ${RD_EVIDENCE_GATES.map((entry) => entry.name).join(', ')}`
    );
  }
  return gate.relativePath;
}
