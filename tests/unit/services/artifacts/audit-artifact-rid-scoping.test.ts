// tests/unit/services/artifacts/audit-artifact-rid-scoping.test.ts
//
// Guards slice `2026-09-14-audit-artifact-rid-scoping` (job
// `2026-09-14-meta-integrity-fixes`, 4/4).
//
// The defect this file exists for, measured on 2026-09-13 in session
// `2026-09-13-session-21878f`: two slices ran in the same session, and the
// `rd:qa-handoff` gate's required paths carried no rid. Slice 2 therefore had
// to write the SAME filename slice 1 had written to pass the same gate.
// `audit/perf.md` was overwritten and slice 1's audit is unrecoverable;
// `audit/security.md` survived only because that one auditor noticed the
// collision by hand and saved slice 1's copy as `audit/security-<rid>.md`.
// The gate stayed green throughout, because it checks that a file EXISTS, not
// whose evidence it holds.
//
// So the assertions below are deliberately not "the gate passes". They are:
//   - AC2: the gate resolves EACH rid to ITS OWN file
//   - AC1: two rids' evidence coexist on disk and both are readable
//   - AC4: the pre-rid layouts still resolve, including the hand-preserved
//          specimen and the three real sessions that hold their security
//          evidence only at `rd/security-review.md`
//   - AC3: a genuinely missing artifact still FAILS (the control group —
//          proving the gate can now find two rids does not prove it still
//          rejects a third)
//
// Dimensions covered:
//   - render:      the declared naming contract (which paths carry `<rid>`)
//   - behavior:    resolution outcome per rid, per on-disk layout
//   - integration: a real temp `.peaks/_runtime/<sid>/` tree on disk
//   - a11y:        omitted — the resolver returns an envelope, it prints
//                  nothing and exits nothing

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  checkPrerequisites,
  getPrerequisitesFor,
  type ArtifactPrerequisite
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { generateEvidence } from '../../../../src/services/evidence/evidence-generator.js';
import type { RequestArtifactRole } from '../../../../src/services/artifacts/request-artifact-service.js';

declareDimensions(
  'tests/unit/services/artifacts/audit-artifact-rid-scoping.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'resolver returns a result envelope; prints nothing and exits nothing' }],
);

const SESSION_ID = '2026-09-13-session-21878f';
const RID_A = '2026-09-13-compact-event-settle';
const RID_B = '2026-09-13-statusline-window-witness';

/** The four artifacts this slice rid-scoped, and their bare pre-rid form.
 *  The mut report is deliberately NOT one of them — see the dedicated test
 *  at the bottom of the `(integration)` block. */
const RID_SCOPED_ARTIFACTS: ReadonlyArray<{ name: string; ridPath: string; barePath: string }> = [
  { name: 'security audit', ridPath: 'audit/security-<rid>.md', barePath: 'audit/security.md' },
  { name: 'perf audit', ridPath: 'audit/perf-<rid>.md', barePath: 'audit/perf.md' },
  { name: 'code review', ridPath: 'rd/code-review-<rid>.md', barePath: 'rd/code-review.md' },
  { name: 'karpathy review', ridPath: 'rd/karpathy-review-<rid>.md', barePath: 'rd/karpathy-review.md' }
];

/** The bare mut-report path — the ONE name the repo can produce
 *  (`mutReportPath()` in packages/peaks-loop-mut/.../report-loader.ts). */
const MUT_REPORT_BARE = 'mut/mut-report.json';

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-rid-scoping-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'audit'), { recursive: true });
  return root;
}

function sessionRootOf(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', SESSION_ID);
}

function writeArtifact(projectRoot: string, relativePath: string, body: string): string {
  const absolute = join(sessionRootOf(projectRoot), relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
  return absolute;
}

/** Body satisfying AUDIT_SECURITY's `mustContainAny` and carrying a rid so the
 *  two rids' files are distinguishable by content, not merely by name. */
function securityBody(rid: string): string {
  return `---\nschemaVersion: 1\nartifactKind: security-audit\nrid: ${rid}\n---\n\n# Security audit — \`${rid}\`\n\n## Verdict\n\nwarn\n`;
}

function perfBody(rid: string): string {
  return `# Performance audit — rid \`${rid}\`\n\n## Baseline\n\n| metric | before | after |\n|---|---|---|\n`;
}

function codeReviewBody(rid: string): string {
  return `# Code review — rid \`${rid}\`\n\n## Findings\n\nCRITICAL: none.\n`;
}

function karpathyBody(rid: string): string {
  return [
    `# Karpathy review — \`${rid}\``,
    '',
    '## Karpathy-Gate',
    '',
    '## Think Before Coding',
    '## Simplicity First',
    '## Surgical Changes',
    '## Goal-Driven Execution',
    ''
  ].join('\n');
}

/** `PrerequisiteCheckResult.missing[].path` carries the `<rid>`-SUBSTITUTED
 *  path, not the raw placeholder — so an assertion written against
 *  `'audit/security-<rid>.md'` would pass vacuously (it can never appear).
 *  Every `missing` assertion goes through this. */
function missingPath(ridPath: string, rid: string): string {
  return ridPath.replace('<rid>', rid);
}

/** Compare a `join()`-built absolute path against a repo-relative literal.
 *  `join()` yields backslashes on Windows, so `endsWith('audit/perf.md')` is
 *  ALWAYS false there — the same vacuity this file's `missingPath()` helper
 *  exists to prevent, one segment further out. Normalise separators first. */
function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Seed every artifact the rd:qa-handoff FEATURE gate needs, into the RID
 *  SCOPED locations only. Returns the paths written.
 *
 *  The point of seeding the COMPLETE set is that the assertion can then be
 *  `ok === true`, not `missing` does not contain X. An assertion on a string
 *  the resolver never emits is vacuously true: a version that ignores `<rid>`
 *  entirely also never emits it, and would still pass. `ok` cannot be faked
 *  that way. */
function seedCompleteSlice(projectRoot: string, rid: string): void {
  writeArtifact(projectRoot, 'prd/handoff.md', '---\nschemaVersion: 2\nsha256: deadbeef\n---\n\n# Handoff\n');
  writeArtifact(projectRoot, `audit/security-${rid}.md`, securityBody(rid));
  writeArtifact(projectRoot, `audit/perf-${rid}.md`, perfBody(rid));
  writeArtifact(projectRoot, `rd/code-review-${rid}.md`, codeReviewBody(rid));
  writeArtifact(projectRoot, `rd/karpathy-review-${rid}.md`, karpathyBody(rid));
  // UNIT_TESTS pins the literal `## Test cases` (h2) plus ONE of the two test
  // idioms — `test(` OR `it(` (`mustContainAny`, see R10 of rid
  // `2026-09-16-codegraph-index-integrity`). This fixture deliberately keeps
  // the LESS common idiom (`test(`: 372 vs `it(`: 3015 across `tests/`) so the
  // full rd:qa-handoff gate still exercises the legacy-idiom path; the `it(`
  // path is pinned in `unit-tests-marker-idiom.test.ts`.
  writeArtifact(projectRoot, `qa/test-cases/${rid}.md`, `## Test cases\n\ntest('x', () => {});\n`);
  writeArtifact(projectRoot, 'qa/.initiated', '');
}

async function missingPaths(
  projectRoot: string,
  requestId: string
): Promise<{ missing: string[]; warnings: string[]; ok: boolean }> {
  const result = await checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd' as RequestArtifactRole,
    newState: 'qa-handoff',
    requestType: 'feature',
    requestId
  });
  return {
    missing: result.missing.map((entry) => entry.path),
    warnings: result.warnings.map((entry) => entry.path),
    ok: result.ok
  };
}

/** The five prereqs this slice own, keyed by their bare pre-rid path. */
function ridScopedPrereqs(): ReadonlyArray<{ ridPath: string; prereq: ArtifactPrerequisite }> {
  return getPrerequisitesFor('rd', 'qa-handoff', 'feature')
    .filter((prereq) => prereq.relativePath.includes('<rid>'))
    .map((prereq) => ({ ridPath: prereq.relativePath, prereq }));
}

describe('(render) the declared naming contract', () => {
  it('names each audit/review artifact with the rid in the filename', () => {
    const declared = ridScopedPrereqs().map((entry) => entry.ridPath);
    for (const artifact of RID_SCOPED_ARTIFACTS) {
      expect(declared).toContain(artifact.ridPath);
    }
  });

  it('keeps the bare pre-rid path as an accepted legacy location', () => {
    for (const artifact of RID_SCOPED_ARTIFACTS) {
      const prereq = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
        (candidate) => candidate.relativePath === artifact.ridPath
      );
      const accepted = [prereq?.legacyRelativePath, ...(prereq?.legacyRelativePaths ?? [])];
      expect(accepted).toContain(artifact.barePath);
    }
  });

  it('still accepts the v2.11.x rd/*-review.md tier behind the bare audit path', () => {
    // Three real sessions on disk hold their security evidence ONLY at the
    // oldest tier, so it cannot be dropped: 2026-09-06-session-a87ca4,
    // 2026-09-10-session-528a63, 2026-09-12-session-e37ef0.
    const security = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
      (candidate) => candidate.relativePath === 'audit/security-<rid>.md'
    );
    const perf = getPrerequisitesFor('rd', 'qa-handoff', 'feature').find(
      (candidate) => candidate.relativePath === 'audit/perf-<rid>.md'
    );
    expect(security?.legacyRelativePaths).toContain('rd/security-review.md');
    expect(perf?.legacyRelativePaths).toContain('rd/perf-baseline.md');
  });
});

describe('(behavior) per-rid resolution', () => {
  it('resolves each rid to its OWN rid-scoped file (AC2)', async () => {
    // Runs the whole FEATURE qa-handoff gate once per rid. Two rids, one
    // session, one directory — both must come back clean, which is only
    // possible if each rid's evidence is resolved by name.
    const projectRoot = makeProjectRoot();
    seedCompleteSlice(projectRoot, RID_A);
    seedCompleteSlice(projectRoot, RID_B);

    const a = await missingPaths(projectRoot, RID_A);
    const b = await missingPaths(projectRoot, RID_B);

    expect(a.missing).toEqual([]);
    expect(b.missing).toEqual([]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });

  it('reports the rid-scoped path missing when only the OTHER rid has evidence', async () => {
    // The positive control for AC2: if resolution ignored the rid and matched
    // any `audit/security*.md`, this would pass and the test above would be
    // vacuous.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, `audit/security-${RID_A}.md`, securityBody(RID_A));

    const b = await missingPaths(projectRoot, RID_B);
    expect(b.missing).toContain(missingPath('audit/security-<rid>.md', RID_B));
  });

  it('does not fall back to a bare, ridless file when a rid-scoped one is present', async () => {
    // Ordering matters: a stale bare file from a sibling slice must not win
    // over this rid's own evidence. Both satisfy `mustContainAny`, so only a
    // "primary tier first" resolver reports `ok` here for the right reason.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, `audit/security-${RID_B}.md`, securityBody(RID_B));
    writeArtifact(projectRoot, 'audit/security.md', 'stale, other slice, no verdict header\n');

    const b = await missingPaths(projectRoot, RID_B);
    expect(b.missing).not.toContain(missingPath('audit/security-<rid>.md', RID_B));
  });
});

describe('(integration) two slices coexist, and the old layouts still resolve', () => {
  it('keeps both slices evidence retrievable with distinct contents (AC1)', async () => {
    const projectRoot = makeProjectRoot();
    seedCompleteSlice(projectRoot, RID_A);
    seedCompleteSlice(projectRoot, RID_B);

    // Both are on disk at once, and each still holds its OWN body — this is
    // the property the 2026-09-13 overwrite destroyed for `audit/perf.md`.
    for (const rid of [RID_A, RID_B]) {
      const security = readFileSync(join(sessionRootOf(projectRoot), `audit/security-${rid}.md`), 'utf8');
      const perf = readFileSync(join(sessionRootOf(projectRoot), `audit/perf-${rid}.md`), 'utf8');
      expect(security).toContain(rid);
      expect(perf).toContain(rid);
    }
  });

  it('the real producer emits rid-scoped names, so two generated slices do not collide (AC1)', async () => {
    // Repair cycle 2. Enumerating the gate's READERS (all the tests above) does
    // not prove the collision is closed: the artifacts are written by a
    // producer that had never been in the sweep, and a rid-scoped requirement
    // with a bare-name producer is unsatisfiable. This runs the real producer
    // (`peaks evidence generate`) for two rids into one session and asserts the
    // produced tree.
    const projectRoot = makeProjectRoot();
    const writtenByRid: string[][] = [];
    for (const rid of [RID_A, RID_B]) {
      const result = await generateEvidence({
        projectRoot,
        rid,
        title: 'rid-scoping producer probe',
        files: [],
        lineCounts: {},
        sessionId: SESSION_ID
      });
      writtenByRid.push(result.writtenFiles);
    }

    // (a) nothing the producer writes lands on a bare pre-rid path — this is
    //     the assertion that fails outright against the pre-repair generator.
    for (const written of writtenByRid) {
      for (const artifact of RID_SCOPED_ARTIFACTS) {
        expect(written.some((path) => posix(path).endsWith(artifact.barePath))).toBe(false);
      }
    }

    // (b) both rids' files exist side by side, each holding its OWN rid — the
    //     property the 2026-09-13 overwrite destroyed.
    for (const artifact of RID_SCOPED_ARTIFACTS) {
      for (const rid of [RID_A, RID_B]) {
        const absolute = join(sessionRootOf(projectRoot), artifact.ridPath.replace('<rid>', rid));
        expect(existsSync(absolute)).toBe(true);
        expect(readFileSync(absolute, 'utf8')).toContain(rid);
      }
    }

    // (c) and the gate resolves each rid to its own file (producer → gate).
    for (const rid of [RID_A, RID_B]) {
      const { missing } = await missingPaths(projectRoot, rid);
      for (const artifact of RID_SCOPED_ARTIFACTS) {
        expect(missing).not.toContain(missingPath(artifact.ridPath, rid));
      }
    }
  });

  it('reads each rid its OWN body — a broken file for one rid does not pass on the other rid evidence (AC1)', async () => {
    // The harm on 2026-09-13 was not "a file is missing" — it was that the
    // gate accepted ANOTHER slice's file as this slice's evidence. So seed
    // slice A's rid-scoped file with a body the gate must reject, slice B's
    // with a body it must accept, and a valid bare file as a decoy. Only
    // checking that the paths differ would not catch a mix-up.
    const projectRoot = makeProjectRoot();
    seedCompleteSlice(projectRoot, RID_A);
    seedCompleteSlice(projectRoot, RID_B);
    writeArtifact(projectRoot, `audit/security-${RID_A}.md`, `# Security audit — \`${RID_A}\`\n\nno verdict header here\n`);
    writeArtifact(projectRoot, 'audit/security.md', securityBody(RID_B));

    const a = await missingPaths(projectRoot, RID_A);
    const b = await missingPaths(projectRoot, RID_B);

    expect(a.missing).toContain(missingPath('audit/security-<rid>.md', RID_A));
    expect(b.missing).toEqual([]);
  });

  it('recognises the hand-preserved specimen at its rid-scoped name (AC4)', async () => {
    // Exactly the shape an auditor left on disk on 2026-09-13: the bare
    // `audit/security.md` holds slice 2's audit, and slice 1's was saved by
    // hand as `audit/security-<rid>.md`.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, 'audit/security.md', securityBody(RID_B));
    writeArtifact(projectRoot, `audit/security-${RID_A}.md`, securityBody(RID_A));

    const a = await missingPaths(projectRoot, RID_A);
    expect(a.missing).not.toContain(missingPath('audit/security-<rid>.md', RID_A));
  });

  it('still resolves the bare pre-rid path for sessions written before this change (AC4)', async () => {
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, 'audit/security.md', securityBody(RID_A));
    writeArtifact(projectRoot, 'audit/perf.md', perfBody(RID_A));
    writeArtifact(projectRoot, 'rd/code-review.md', codeReviewBody(RID_A));
    writeArtifact(projectRoot, 'rd/karpathy-review.md', karpathyBody(RID_A));

    const { missing } = await missingPaths(projectRoot, RID_A);
    for (const path of [
      'audit/security-<rid>.md',
      'audit/perf-<rid>.md',
      'rd/code-review-<rid>.md',
      'rd/karpathy-review-<rid>.md'
    ]) {
      expect(missing).not.toContain(missingPath(path, RID_A));
    }
  });

  it('still resolves the oldest v2.11.x tier, which real sessions depend on (AC4)', async () => {
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, 'rd/security-review.md', securityBody(RID_A));
    writeArtifact(projectRoot, 'rd/perf-baseline.md', perfBody(RID_A));

    const { missing } = await missingPaths(projectRoot, RID_A);
    expect(missing).not.toContain(missingPath('audit/security-<rid>.md', RID_A));
    expect(missing).not.toContain(missingPath('audit/perf-<rid>.md', RID_A));
  });

  it('fails when evidence is genuinely absent — the clean control group (AC3)', async () => {
    const projectRoot = makeProjectRoot();

    const { missing, warnings, ok } = await missingPaths(projectRoot, RID_A);

    expect(ok).toBe(false);
    // The four hard-fail artifacts. MUT is excluded on purpose: it carries
    // `backCompat: true`, so a missing report is a soft-block warning under
    // the v2.13.2 window (asserted right below) — that is pre-existing
    // behaviour this slice must not change.
    for (const artifact of RID_SCOPED_ARTIFACTS) {
      expect(missing).toContain(missingPath(artifact.ridPath, RID_A));
    }
    expect(warnings).toContain(MUT_REPORT_BARE);
  });

  it('gates the mut report at the one name the repo can actually produce', async () => {
    // Slice `2026-09-14-audit-artifact-rid-scoping` repair cycle 1. The mut
    // report was briefly rid-scoped to `mut/mut-report-<rid>.json`, but no
    // producer can write that name: `mutReportPath()` (packages/peaks-loop-mut
    // /src/services/mut/report-loader.ts) returns the bare path and
    // `peaks mut run`'s `--out` is caller-chosen with no default. Combined
    // with `backCompat: true` that made the requirement a prose-only gate —
    // it could never fire. This asserts the requirement is SATISFIABLE:
    // writing the bare file clears the gate outright.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, MUT_REPORT_BARE, '{"passed": true}');

    const { missing, warnings } = await missingPaths(projectRoot, RID_A);

    expect(missing).not.toContain(MUT_REPORT_BARE);
    expect(warnings).not.toContain(MUT_REPORT_BARE);
  });

  it('tolerates the numbered filename prefix at the rid-scoped tier too', async () => {
    // `request init` writes `NNN-<name>`, and the shared resolver tolerates it
    // at every tier — including the new rid-scoped one, where the rid is part
    // of the suffix the numbered form has to preserve.
    const projectRoot = makeProjectRoot();
    writeArtifact(projectRoot, `audit/001-security-${RID_A}.md`, securityBody(RID_A));

    const { missing } = await missingPaths(projectRoot, RID_A);
    expect(missing).not.toContain(missingPath('audit/security-<rid>.md', RID_A));
  });

  it('refuses a traversal rid before it writes anything (F1b)', async () => {
    // Repair round. The rid becomes a filename in nine of the generator's
    // writes. Measured before the guard existed: `--rid '../../../pwned'` wrote
    // `.peaks/_runtime/pwned.md` — OUTSIDE the per-session evidence dir this
    // slice exists to enforce — and a deeper rid wrote above the project root
    // with the string echoed into the artifact body.
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-rid-scoping-'));
    tempRoots.push(projectRoot);

    await expect(
      generateEvidence({ projectRoot, rid: '../../../pwned', title: 'pwn', files: [], lineCounts: {}, sessionId: SESSION_ID })
    ).rejects.toThrow(/Invalid request id/);

    // Refused before the first mkdir, so not even the session tree exists —
    // let alone the escape target one level above it.
    expect(existsSync(join(projectRoot, '.peaks', '_runtime'))).toBe(false);
  });

  it('still satisfies the `config` gate, whose security slot is the ridless name (H-2)', async () => {
    // Repair round. The generator is request-type-agnostic (it has no
    // `--request-type`), but `config`'s `rd:qa-handoff` row is `SECURITY_REVIEW`
    // — `rd/security-review.md`, which carries no `<rid>` — so writing only the
    // rid-scoped audit made a `config` slice fail a gate it passed before this
    // slice. Measured with the real generator and the real gate before the
    // fix: `{"requestType":"config","ok":false,"missing":["rd/security-review.md"]}`.
    const projectRoot = makeProjectRoot();
    await generateEvidence({ projectRoot, rid: RID_A, title: 'config probe', files: [], lineCounts: {}, sessionId: SESSION_ID });

    const result = await checkPrerequisites({
      projectRoot,
      sessionId: SESSION_ID,
      role: 'rd',
      newState: 'qa-handoff',
      requestType: 'config',
      requestId: RID_A
    });

    expect(result.missing.map((m) => m.path.replace(/\\/g, '/').replace(`${sessionRootOf(projectRoot).replace(/\\/g, '/')}/`, '')))
      .not.toContain('rd/security-review.md');
    expect(result.ok).toBe(true);
  });
});

// AC-2 of slice 2026-09-17-4-0-51-cleanup: THIRD_PARTY_REVIEW is the
// second backCompat=true prereq in the FEATURE table (the first is
// MUT_REPORT). It carries `rd/third-party-review.md` and is satisfied
// either by the bare file (when reviewer.providers is configured) or
// by the soft-warning branch (when it is not). The MUT_REPORT case at
// line ~408 covers the same shape; these two cases pin the
// THIRD_PARTY_REVIEW twin so a future gate change cannot silently
// regress one but not the other.
describe('(AC-2) THIRD_PARTY_REVIEW backCompat soft-warning symmetry', () => {
  const THIRD_PARTY_REVIEW_BARE = 'rd/third-party-review.md';

  it('reports the third-party-review as a soft warning, not a hard fail, when absent', async () => {
    const projectRoot = makeProjectRoot();

    const { missing, warnings, ok } = await missingPaths(projectRoot, RID_A);

    // The third-party-review carries backCompat: true (mirrors the
    // MUT_REPORT contract at line 295-301 of artifact-prerequisites.ts).
    // A missing file therefore lands in `warnings`, not `missing`, and
    // the gate stays open under the 1-minor-release soft-warning window.
    expect(warnings).toContain(THIRD_PARTY_REVIEW_BARE);
    expect(missing).not.toContain(THIRD_PARTY_REVIEW_BARE);
    // Soft-warning must not flip the overall verdict to false (the
    // soft-block contract from v2.13.2; the missing-list may still
    // contain HARD prereqs from RID_SCOPED_ARTIFACTS — we only check
    // the third-party-review branch).
    expect(typeof ok).toBe('boolean');
  });

  it('clears the soft warning when the bare third-party-review file is present with the required markers', async () => {
    // Symmetric to the MUT_REPORT case at line 408-423: writing the
    // file at the canonical path with the mustContain markers makes
    // the gate satisfied outright.
    const projectRoot = makeProjectRoot();
    writeArtifact(
      projectRoot,
      THIRD_PARTY_REVIEW_BARE,
      '# Third-party review\n\nmodelFamily: claude-fable-5-1\nthird-party-review verdict: pass\n'
    );

    const { missing, warnings } = await missingPaths(projectRoot, RID_A);

    expect(missing).not.toContain(THIRD_PARTY_REVIEW_BARE);
    expect(warnings).not.toContain(THIRD_PARTY_REVIEW_BARE);
  });
});
