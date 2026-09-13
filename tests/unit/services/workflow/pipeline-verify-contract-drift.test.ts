// tests/unit/services/workflow/pipeline-verify-contract-drift.test.ts
//
// rid=2026-09-14-verify-pipeline-contract-drift — slice 2 of job
// `2026-09-14-meta-integrity-fixes`.
//
// The defect: `peaks workflow verify-pipeline` evaluated a contract that had
// been retired, so a slice that had already passed `peaks request transition`
// still failed the pipeline check the SKILLs call mandatory. Three of its
// demands were retired paths:
//
//   1. `rd/security-review.md` — demoted by v2.12.0 Group B Tier 5 to a
//      legacy fallback of `audit/security.md` (and, after slice
//      `2026-09-14-audit-artifact-rid-scoping`, of `audit/security-<rid>.md`).
//   2/3. `qa/security-findings-<rid>.md` and `qa/performance-findings-<rid>.md`
//      — dropped from every `qa:verdict-issued` table by the v2.11.0 D1/D4
//      trim. peaks-qa's own SKILL says QA does not own them.
//
// The fix makes the checker derive each gate's candidate paths from the
// `artifact-prerequisites.ts` table through its public accessor, so the two
// components share one source of truth (`contractEvidencePaths`).
//
// Repair cycle 1 (QA R1): the first pass left one gate OUT of that derivation.
// A `tech-doc` gate was pinned to `rd/tech-doc.md` — an artifact v2.11.0 Group A
// retired, which the table carries no prerequisite for. The result was the very
// drift this slice was written to remove: `checkPrerequisites` returned
// `ok=true, missing=[]` on a tree while `verifyPipeline` failed it on
// `tech-doc`. The gate is now derived like the others, and the design / scope
// record the contract DOES name at `rd:qa-handoff` (`prd/handoff.md`,
// `AUDIT_REQUIRES_HANDOFF`) is derived alongside it — so the two components are
// asserted to agree in BOTH directions on the same on-disk tree.
//
// Dimensions covered:
//   - render:      the gate list + the envelope fields the gates feed
//   - behavior:    the contract lookup, and which artifacts are retired
//   - integration: real on-disk trees through `verifyPipeline` — the green
//                  tree, the legacy-layout tree, and three controls that
//                  remove evidence which is still required
//   - a11y:        the violation / nextAction text a human reads when a gate
//                  fails (the CLI's `message` field)

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import { checkPrerequisites } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { createRequestArtifact } from '../../../../src/services/artifacts/request-artifact-service.js';
import { updateStatusBlock } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';
import {
  contractEvidencePaths,
  qaGatesForType,
  rdGatesForType
} from '../../../../src/services/workflow/pipeline-verify-gate-support.js';

declareDimensions(
  'tests/unit/services/workflow/pipeline-verify-contract-drift.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

const SESSION_ID = 'test-session-contract-drift';
const RID = '2026-09-14-contract-drift-fixture';
const TS = '2026-09-14T00:00:00.000Z';

/** The Karpathy-review prerequisites: the gate header plus the four guideline
 *  names as real markdown headings. */
const KARPATHY_REVIEW_BODY = [
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
  '',
].join('\n');

/** `prd/handoff.md` — `AUDIT_REQUIRES_HANDOFF` pins `schemaVersion: 2` and a
 *  `sha256:` fingerprint. Both components read that body contract: the gate
 *  through `checkPrerequisites`, and the checker through
 *  `contractBodyViolations` (repair round 2 — before that the checker probed
 *  existence only), so this fixture has to satisfy it for either to pass. */
const PRD_HANDOFF_BODY = '# PRD handoff\n\nschemaVersion: 2\nsha256: 0000000000000000\n';

/** The QA-side evidence a feature slice needs at `verdict-issued`. */
const QA_EVIDENCE: ReadonlyArray<[string, string]> = [
  [`qa/test-cases/${RID}.md`, '# Test cases\n\n## Test cases\n\ntest(x)\n'],
  [`qa/test-reports/${RID}.md`, '# Test report\n\n## Test execution\n\nall green\n']
];

/** Every prereq the table carries at `rd:qa-handoff` for `feature`, plus the
 *  QA evidence — so `checkPrerequisites` and `verifyPipeline` can be asserted
 *  to agree on the same tree. Note the absence of `rd/tech-doc.md`,
 *  `rd/security-review.md`, `qa/security-findings-<rid>.md` and
 *  `qa/performance-findings-<rid>.md` — none of those is required. */
const CURRENT_CONTRACT_EVIDENCE: ReadonlyArray<[string, string]> = [
  ['prd/handoff.md', PRD_HANDOFF_BODY],
  ['rd/code-review.md', '# Code review\n\n## Findings\n\nCRITICAL: none\n'],
  ['audit/security.md', '# Security audit\n\n## Verdict\n\nPASS\n'],
  ['audit/perf.md', '# Perf audit\n\n## Baseline\n\nn/a\n'],
  ['rd/karpathy-review.md', KARPATHY_REVIEW_BODY],
  ['qa/.initiated', ''],
  ...QA_EVIDENCE
];

/** The pre-v2.12.0 / pre-rid-scoping layout, still accepted by the contract
 *  through `legacyRelativePath` / `legacyRelativePaths`. `rd/tech-doc.md` is
 *  kept here on purpose: it is not required any more, and carrying it must not
 *  cost a slice anything either. */
const LEGACY_CONTRACT_EVIDENCE: ReadonlyArray<[string, string]> = [
  ['prd/handoff.md', PRD_HANDOFF_BODY],
  ['rd/tech-doc.md', '# Tech doc\n'],
  ['rd/code-review.md', '# Code review\n\n## Findings\n\nCRITICAL: none\n'],
  ['rd/security-review.md', '# Security review\n\n## Findings\n\nnone\n'],
  ['rd/perf-baseline.md', '# Perf baseline\n\n## Results\n\nn/a\n'],
  ['rd/karpathy-review.md', KARPATHY_REVIEW_BODY],
  ['qa/.initiated', ''],
  ...QA_EVIDENCE
];

function write(projectRoot: string, relative: string, body: string): void {
  const path = join(projectRoot, '.peaks', '_runtime', SESSION_ID, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

/** Seed a slice that has genuinely reached `rd:qa-handoff` + `verdict-issued`,
 *  then lay down `evidence`. */
async function seedSlice(
  ws: TmpWorkspace,
  evidence: ReadonlyArray<[string, string]>,
): Promise<void> {
  for (const [role, state] of [['rd', 'qa-handoff'], ['qa', 'verdict-issued']] as const) {
    const created = await createRequestArtifact({
      role,
      requestId: RID,
      projectRoot: ws.path,
      sessionId: SESSION_ID,
      apply: true,
    });
    writeFileSync(created.path, updateStatusBlock(readFileSync(created.path, 'utf8'), state, TS).updated, 'utf8');
  }
  for (const [relative, body] of evidence) write(ws.path, relative, body);
}

const ws = withTmpWorkspacePerTest('peaks-pipeline-contract-');

describe('Scenario: behavior — the checker reads the contract, not a frozen copy of it', () => {
  it('when the contract demotes a path to a legacy fallback, should probe it as a fallback', () => {
    // AUDIT_SECURITY: rid-scoped canonical, then the two historical tiers.
    expect(contractEvidencePaths('rd', 'qa-handoff', 'feature', 'rd/security-review.md')).toEqual([
      'audit/security-<rid>.md',
      'audit/security.md',
      'rd/security-review.md',
    ]);
    expect(contractEvidencePaths('rd', 'qa-handoff', 'feature', 'rd/perf-baseline.md')).toEqual([
      'audit/perf-<rid>.md',
      'audit/perf.md',
      'rd/perf-baseline.md',
    ]);
  });

  it('when the contract carries the artifact under its current name, should return that name first', () => {
    expect(contractEvidencePaths('rd', 'qa-handoff', 'feature', 'rd/code-review.md')?.[0]).toBe('rd/code-review-<rid>.md');
    expect(contractEvidencePaths('qa', 'verdict-issued', 'feature', 'qa/test-cases/<rid>.md')).toEqual([
      'qa/test-cases/<rid>.md',
    ]);
  });

  it('when the contract has dropped an artifact entirely, should report it as retired', () => {
    // These are the three requirements that made a compliant slice fail.
    expect(contractEvidencePaths('qa', 'verdict-issued', 'feature', 'qa/security-findings-<rid>.md')).toBeNull();
    expect(contractEvidencePaths('qa', 'verdict-issued', 'feature', 'qa/performance-findings-<rid>.md')).toBeNull();
    // Sanity: the retirement is specific, not a lookup that always misses.
    expect(contractEvidencePaths('qa', 'verdict-issued', 'feature', 'qa/test-reports/<rid>.md')).not.toBeNull();
  });

  it('when the request type has no audit surface, should follow the contract rather than a hardcoded list', () => {
    // CONFIG_TABLE keeps the v2.11.x single-file security slot and has no perf
    // entry at all — the checker must not invent one.
    expect(contractEvidencePaths('rd', 'qa-handoff', 'config', 'rd/security-review.md')).toEqual(['rd/security-review.md']);
    expect(contractEvidencePaths('rd', 'qa-handoff', 'config', 'rd/perf-baseline.md')).toBeNull();
  });

  it('when the design record was retired from the contract, should report it as retired (R1)', () => {
    // `rd/tech-doc.md`: retired in v2.11.0 Group A, absent from every table.
    expect(contractEvidencePaths('rd', 'qa-handoff', 'feature', 'rd/tech-doc.md')).toBeNull();
    expect(contractEvidencePaths('rd', 'qa-handoff', 'refactor', 'rd/tech-doc.md')).toBeNull();
    // The record the contract names instead is `prd/handoff.md`, and the
    // request types that carry it are exactly the ones the table gives it to.
    expect(contractEvidencePaths('rd', 'qa-handoff', 'feature', 'prd/handoff.md')).toEqual(['prd/handoff.md']);
    expect(contractEvidencePaths('rd', 'qa-handoff', 'bugfix', 'prd/handoff.md')).toEqual(['prd/handoff.md']);
    expect(contractEvidencePaths('rd', 'qa-handoff', 'docs', 'prd/handoff.md')).toBeNull();
    expect(contractEvidencePaths('rd', 'qa-handoff', 'config', 'prd/handoff.md')).toBeNull();
  });
});

describe('Scenario: render — the gate list the QA phase now evaluates', () => {
  it('when QA verifies a feature slice, should not gate on security or performance findings', () => {
    expect(qaGatesForType('feature').map((g) => g.name)).toEqual([
      'qa-request-exists',
      'test-cases',
      'test-report',
    ]);
  });

  it('when RD hands off a feature slice, should gate on the contract artifacts', () => {
    expect(rdGatesForType('feature').map((g) => g.name)).toEqual([
      'rd-request-exists',
      'prd-handoff',
      'code-review',
      'security-review',
      'perf-baseline',
    ]);
    // The retired design record gets no gate (R1), and the types the table
    // gives no handoff to get none either.
    expect(rdGatesForType('feature').map((g) => g.name)).not.toContain('tech-doc');
    expect(rdGatesForType('config').map((g) => g.name)).toEqual(['rd-request-exists', 'security-review']);
    // docs/chore carry no audit prereqs, so they get no audit gates.
    expect(rdGatesForType('docs').map((g) => g.name)).toEqual(['rd-request-exists']);
  });
});

describe('Scenario: integration — the checker agrees with `request transition` on the same trees', () => {
  it('when a slice satisfies the current contract, should complete (AC1)', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.rdPhase.gates.every((g) => g.passed)).toBe(true);
    expect(result.qaPhase.gates.every((g) => g.passed)).toBe(true);
  });

  it('when a slice still sits on the pre-v2.12.0 layout, should stay green (back-compat, AC1)', async () => {
    await seedSlice(ws(), LEGACY_CONTRACT_EVIDENCE);
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
    // ...and the slice is told which form it used, without being failed for it.
    expect(result.acceptedForm).toBe('legacy');
    expect(result.usedCanonicalPath).toBe(true);
  });

  it('when security evidence is genuinely absent at every contract path, should still fail (AC3)', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'audit'), { recursive: true });
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'rd', 'security-review.md'), { force: true });
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    const security = result.rdPhase.gates.find((g) => g.name === 'security-review');
    expect(security?.passed).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('when performance evidence is genuinely absent at every contract path, should still fail (AC3)', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'audit', 'perf.md'));
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    expect(result.rdPhase.gates.find((g) => g.name === 'perf-baseline')?.passed).toBe(false);
    expect(result.complete).toBe(false);
  });

  it('when QA evidence is genuinely absent, should still fail (AC3 — the gates that never moved)', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'qa', 'test-reports'), { recursive: true });
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    expect(result.qaPhase.gates.find((g) => g.name === 'test-report')?.passed).toBe(false);
    expect(result.complete).toBe(false);
  });
});

describe('Scenario: integration — the checker and `request transition` agree (R1)', () => {
  it('when a slice satisfies the contract but has no rd/tech-doc.md, should agree it is complete', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    // The tree carries no design doc at all. `request transition` is the
    // component that decides what the contract requires — and it does not
    // require this.
    expect(existsSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'rd', 'tech-doc.md'))).toBe(false);

    const prereqs = await checkPrerequisites({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: RID,
      requestType: 'feature',
    });
    expect(prereqs.missing.map((m) => m.path)).not.toContain('rd/tech-doc.md');
    expect(prereqs.ok).toBe(true);

    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    expect(result.rdPhase.gates.map((g) => g.name)).not.toContain('tech-doc');
    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
  });

  it('when the PRD handoff is absent, should agree with `request transition` that it fails (R1)', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'));

    // The laxer half of the same asymmetry: the table requires the handoff at
    // `rd:qa-handoff`, so the checker may not ignore it.
    const prereqs = await checkPrerequisites({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: RID,
      requestType: 'feature',
    });
    expect(prereqs.missing.map((m) => m.path)).toContain('prd/handoff.md');
    expect(prereqs.ok).toBe(false);

    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    expect(result.rdPhase.gates.find((g) => g.name === 'prd-handoff')?.passed).toBe(false);
    expect(result.violations).toContain('RD evidence missing: PRD handoff capsule (approved scope + non-goals) (prd/handoff.md)');
    expect(result.complete).toBe(false);
  });

  it('when the handoff EXISTS but violates the contract body, should agree with `request transition` that it fails (repair round 2)', async () => {
    // The exposure the security audit measured: the resolver probed
    // `existsSync` alone, so it reported `prd-handoff passed = true` for a
    // `schemaVersion: 1` handoff with no `sha256:` line — the exact file
    // `AUDIT_REQUIRES_HANDOFF` refuses at `rd:qa-handoff` with
    // `missing section(s)`. A guard stricter than nothing but laxer than the
    // contract is still a guard that reads a PATH instead of the CONTRACT, so
    // the checker now applies the table's own body markers.
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    write(ws().path, 'prd/handoff.md', '# PRD handoff\n\nschemaVersion: 1\nhandoffHash: "aa"\n');

    const prereqs = await checkPrerequisites({
      projectRoot: ws().path,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestId: RID,
      requestType: 'feature',
    });
    expect(prereqs.missing.map((m) => m.path)).toContain('prd/handoff.md');
    expect(prereqs.ok).toBe(false);

    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    const handoff = result.rdPhase.gates.find((g) => g.name === 'prd-handoff');
    expect(handoff?.passed).toBe(false);
    // Same vocabulary the table uses — one implementation, not a second copy.
    expect(handoff?.detail).toContain('missing section(s): schemaVersion: 2, sha256:');
    expect(result.violations.some((v) => v.includes('does not satisfy the contract'))).toBe(true);
    expect(result.complete).toBe(false);
  });
});

describe('Scenario: a11y — what a human reads when the checker fails', () => {
  it('when security evidence is missing, should name a path that exists in the contract', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'audit'), { recursive: true });
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'rd', 'security-review.md'), { force: true });
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    // The contract's *current* path, not the retired `rd/security-review.md`
    // the checker used to demand.
    expect(result.violations).toContain(
      `RD evidence missing: Security review evidence (audit/security-${RID}.md)`
    );
    expect(result.nextActions).toContain(`Create .peaks/_runtime/${SESSION_ID}/audit/security-${RID}.md`);
  });

  it('when the retired findings artifacts are absent, should not mention them at all', async () => {
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    const result = await verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
    const text = [...result.violations, ...result.nextActions].join('\n');
    expect(text).not.toContain('security-findings');
    expect(text).not.toContain('performance-findings');
    // Same for the retired design record: the tree has no `rd/tech-doc.md` and
    // the human is never told to create one (R1).
    expect(text).not.toContain('tech-doc');
  });
});
