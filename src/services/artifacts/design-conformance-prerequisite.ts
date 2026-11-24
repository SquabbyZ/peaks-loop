import type { ArtifactPrerequisite } from './artifact-prerequisites.js';

/**
 * DESIGN_CONFORMANCE — the markdown half of the evidence pair written by
 * `peaks design check --gate` (S3). It gates `rd:qa-handoff` for feature and
 * bugfix slices; refactor reaches it through the `REFACTOR_TABLE` alias.
 *
 * ACCEPTED VERDICTS are exactly four: `pass`, `not-applicable` (the change set
 * has no UI surface), `not-adopted` (the project has not adopted the design
 * contract) and `accepted` (a human accepted the findings). A `fail` verdict is
 * refused, and so is `blocked` — the verdict the checker emits when it could
 * not run at all (no engine, no render, no URL, no change set). A missing
 * capability is BLOCKED, never a pass, so this gate can never turn "the check
 * did not run" into a green handoff.
 *
 * `--gate` is the only writer of this file; an RD session that hand-authors it
 * is violating the contract, not satisfying it.
 */
export const DESIGN_CONFORMANCE: ArtifactPrerequisite = {
  relativePath: 'design/check-<rid>.md',
  description:
    'Design conformance evidence written by `peaks design check --gate` (S3). Accepted verdicts: `design-conformance: pass`, `not-applicable` (no UI surface), `not-adopted` (contract not adopted) or `accepted` (a human accepted the findings). A `fail` or `blocked` verdict is never a pass: a missing engine, render, URL or change set stays blocked, so this gate refuses rather than guessing.',
  mustContain: ['schemaVersion: 1', 'sha256:', '## Design conformance'],
  mustContainAny: [
    'design-conformance: pass',
    'design-conformance: not-applicable',
    'design-conformance: not-adopted',
    'design-conformance: accepted'
  ],
  backCompat: true,
  backCompatUntil: 'v4.4.0'
};
