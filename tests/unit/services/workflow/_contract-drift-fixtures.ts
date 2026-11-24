// tests/unit/services/workflow/_contract-drift-fixtures.ts
//
// The on-disk fixture harness shared by `pipeline-verify-contract-drift.test.ts`
// and its back-compat sibling. Moved verbatim out of the first file so both can
// seed the SAME compliant tree: importing a `.test.ts` module from another test
// file would re-register that file's cases inside the importer.
//
// A fixture library, not a test file: no `.test.ts` suffix, so the unit config
// does not collect it and it declares no dimensions. Each test file owns its own
// `withTmpWorkspacePerTest` hooks; this module never registers hooks.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import { updateStatusBlock } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import type { TmpWorkspace } from '../../_setup/tmp-workspace.js';
import { backcompatAcceptanceBody } from '../artifacts/_audit-artifact-rid-fixtures.js';
import {
  judgedDeclarationSection,
  writeJudgedFixtureSource
} from '../artifacts/_judged-declaration-fixture.js';

export const SESSION_ID = 'test-session-contract-drift';
export const RID = '2026-09-14-contract-drift-fixture';
export const TS = '2026-09-14T00:00:00.000Z';

/** The Karpathy-review prerequisites: the gate header plus the four guideline
 *  names as real markdown headings. */
export const KARPATHY_REVIEW_BODY = [
  '# Karpathy review',
  '',
  '## Karpathy-Gate',
  '',
  '### Think Before Coding',
  '',
  '### Simplicity First',
  '',
  '### Surgical Changes',
  '',
  '### Goal-Driven Execution',
  ''
].join('\n');

/** `prd/handoff.md` — `AUDIT_REQUIRES_HANDOFF` pins `schemaVersion: 2` and a
 *  `sha256:` fingerprint. Both components read that body contract: the gate
 *  through `checkPrerequisites`, and the checker through
 *  `contractBodyViolations` (repair round 2 — before that the checker probed
 *  existence only), so this fixture has to satisfy it for either to pass. */
export const PRD_HANDOFF_BODY = '# PRD handoff\n\nschemaVersion: 2\nsha256: 0000000000000000\n';

export const DESIGN_BODY =
  'schemaVersion: 1\nsha256:\n## Design conformance\ndesign-conformance: pass\n';

/** The tracked acceptances this workspace seeds, derived from the shipped table
 *  so the fixture cannot drift from the windows it accepts. */
export const ACCEPTANCE_BODY = backcompatAcceptanceBody();

/** The QA-side evidence a feature slice needs at `verdict-issued`. */
export const QA_EVIDENCE: ReadonlyArray<[string, string]> = [
  [`qa/test-cases/${RID}.md`, '# Test cases\n\n## Test cases\n\ntest(x)\n'],
  [`qa/test-reports/${RID}.md`, '# Test report\n\n## Test execution\n\nall green\n']
];

/** Every prereq the table carries at `rd:qa-handoff` for `feature`, plus the
 *  QA evidence — so `checkPrerequisites` and `verifyPipeline` can be asserted
 *  to agree on the same tree. Note the absence of `rd/tech-doc.md`,
 *  `rd/security-review.md`, `qa/security-findings-<rid>.md` and
 *  `qa/performance-findings-<rid>.md` — none of those is required. */
export const CURRENT_CONTRACT_EVIDENCE: ReadonlyArray<[string, string]> = [
  [`prd/handoff-${RID}.md`, PRD_HANDOFF_BODY],
  ['rd/code-review.md', '# Code review\n\n## Findings\n\nCRITICAL: none\n'],
  ['audit/security.md', '# Security audit\n\n## Verdict\n\nPASS\n' + judgedDeclarationSection()],
  ['audit/perf.md', '# Perf audit\n\n## Baseline\n\nn/a\n'],
  ['rd/karpathy-review.md', KARPATHY_REVIEW_BODY],
  [`design/check-${RID}.md`, DESIGN_BODY],
  ['qa/.initiated', ''],
  ...QA_EVIDENCE
];

/** The pre-v2.12.0 / pre-rid-scoping layout, still accepted by the contract
 *  through `legacyRelativePath` / `legacyRelativePaths`. `rd/tech-doc.md` is
 *  kept here on purpose: it is not required any more, and carrying it must not
 *  cost a slice anything either. */
export const LEGACY_CONTRACT_EVIDENCE: ReadonlyArray<[string, string]> = [
  ['prd/handoff.md', PRD_HANDOFF_BODY],
  ['rd/tech-doc.md', '# Tech doc\n'],
  ['rd/code-review.md', '# Code review\n\n## Findings\n\nCRITICAL: none\n'],
  [
    'rd/security-review.md',
    '# Security review\n\n## Findings\n\nnone\n' + judgedDeclarationSection()
  ],
  ['rd/perf-baseline.md', '# Perf baseline\n\n## Results\n\nn/a\n'],
  ['rd/karpathy-review.md', KARPATHY_REVIEW_BODY],
  [`design/check-${RID}.md`, DESIGN_BODY],
  ['qa/.initiated', ''],
  ...QA_EVIDENCE
];

export function write(projectRoot: string, relative: string, body: string): void {
  const path = join(projectRoot, '.peaks', '_runtime', SESSION_ID, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

/** Seed a slice that has genuinely reached `rd:qa-handoff` + `verdict-issued`,
 *  then lay down `evidence`. */
export async function seedSlice(
  ws: TmpWorkspace,
  evidence: ReadonlyArray<[string, string]>
): Promise<void> {
  for (const [role, state] of [
    ['rd', 'qa-handoff'],
    ['qa', 'verdict-issued']
  ] as const) {
    const created = await createRequestArtifact({
      role,
      requestId: RID,
      projectRoot: ws.path,
      sessionId: SESSION_ID,
      apply: true
    });
    writeFileSync(
      created.path,
      updateStatusBlock(readFileSync(created.path, 'utf8'), state, TS).updated,
      'utf8'
    );
  }
  writeJudgedFixtureSource(ws.path);
  // The commit leg refuses a closed back-compat window that no tracked
  // acceptance covers. This tree has neither the mutation report nor the
  // third-party review, so the workspace carries the acceptances the shipped
  // `.peaks/lint/backcompat-expired-acceptance.json` carries, with a review
  // target far enough ahead that these arms judge the CONTRACT, not the list.
  const acceptance = join(ws.path, '.peaks', 'lint', 'backcompat-expired-acceptance.json');
  mkdirSync(dirname(acceptance), { recursive: true });
  writeFileSync(acceptance, ACCEPTANCE_BODY, 'utf8');
  for (const [relative, body] of evidence) write(ws.path, relative, body);
}
