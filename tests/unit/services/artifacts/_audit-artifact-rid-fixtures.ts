// tests/unit/services/artifacts/_audit-artifact-rid-fixtures.ts
//
// The fixture harness behind
// `tests/unit/services/artifacts/audit-artifact-rid-scoping.test.ts` — the guard for slice
// `2026-09-14-audit-artifact-rid-scoping`, which exists because two slices once ran in one
// session and the gate's required paths carried no rid: slice 2 overwrote slice 1's
// `audit/perf.md` to pass the same gate, and the gate stayed green because it checks that
// a file EXISTS, not whose evidence it holds.
//
// Why the seam is HERE: the guard's scenarios read this module as data and as fixtures —
// the rid-scoped/bare path table, the tmp-project builders, the artifact bodies the gate's
// own `mustContainAny` predicates accept, and the one async probe that runs the real
// `checkPrerequisites` and reduces it to `{missing, warnings, ok}`. Every line below was
// moved byte-for-byte out of the guard; the only edit is the `export ` prefix on the names
// the guard reads back. All nineteen cases stay in the collected file, with every
// assertion literal unchanged.
//
// WHAT MUST NOT SLIP
//
// `securityBody` / `perfBody` / `codeReviewBody` / `karpathyBody` are shaped by the REAL
// prereq predicates in `src/services/artifacts/artifact-prerequisites.ts` (the security body
// is what the test file's own header says the AC4 legacy tiers matched, and the karpathy body
// is the four-heading Karpathy-Gate shape). Editing one here changes what a green gate means,
// so they are fixtures, not helpers to tidy. Likewise `seedCompleteSlice` writes the COMPLETE
// rd:qa-handoff set on purpose: the assertion it feeds is `ok === true`, and seeding a
// partial set is how an assertion on a path the resolver never emits turns vacuously true.
// `missingPath()` and `posix()` exist for exactly that reason — both are documented at the
// definitions below and neither is decoration.
//
// A scan/fixture library, not a test file: no `.test.ts` suffix, so the unit config
// (`include: tests/unit/**/*.test.ts`) does not collect it and it declares no dimensions.
// It is a file under `tests/`, so the ESM-extension guard walks it — which is why the two
// relative specifiers below carry their `.js` extension.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkPrerequisites,
  getPrerequisitesFor,
  type ArtifactPrerequisite
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
export const SESSION_ID = '2026-09-13-session-21878f';
export const RID_A = '2026-09-13-compact-event-settle';
export const RID_B = '2026-09-13-statusline-window-witness';

/** The four artifacts this slice rid-scoped, and their bare pre-rid form.
 *  The mut report is deliberately NOT one of them — see the dedicated test
 *  at the bottom of the `(integration)` block. */
export const RID_SCOPED_ARTIFACTS: ReadonlyArray<{
  name: string;
  ridPath: string;
  barePath: string;
}> = [
  { name: 'security audit', ridPath: 'audit/security-<rid>.md', barePath: 'audit/security.md' },
  { name: 'perf audit', ridPath: 'audit/perf-<rid>.md', barePath: 'audit/perf.md' },
  { name: 'code review', ridPath: 'rd/code-review-<rid>.md', barePath: 'rd/code-review.md' },
  {
    name: 'karpathy review',
    ridPath: 'rd/karpathy-review-<rid>.md',
    barePath: 'rd/karpathy-review.md'
  }
];

/** The bare mut-report path — the ONE name the repo can produce
 *  (`mutReportPath()` in packages/peaks-loop-mut/.../report-loader.ts). */
export const MUT_REPORT_BARE = 'mut/mut-report.json';

export const tempRoots: string[] = [];

export function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-rid-scoping-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID, 'audit'), { recursive: true });
  return root;
}

export function sessionRootOf(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', SESSION_ID);
}

export function writeArtifact(projectRoot: string, relativePath: string, body: string): string {
  const absolute = join(sessionRootOf(projectRoot), relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
  return absolute;
}

/** Body satisfying AUDIT_SECURITY's `mustContainAny` and carrying a rid so the
 *  two rids' files are distinguishable by content, not merely by name. */
export function securityBody(rid: string): string {
  return `---\nschemaVersion: 1\nartifactKind: security-audit\nrid: ${rid}\n---\n\n# Security audit — \`${rid}\`\n\n## Verdict\n\nwarn\n`;
}

export function perfBody(rid: string): string {
  return `# Performance audit — rid \`${rid}\`\n\n## Baseline\n\n| metric | before | after |\n|---|---|---|\n`;
}

export function codeReviewBody(rid: string): string {
  return `# Code review — rid \`${rid}\`\n\n## Findings\n\nCRITICAL: none.\n`;
}

export function karpathyBody(rid: string): string {
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
export function missingPath(ridPath: string, rid: string): string {
  return ridPath.replace('<rid>', rid);
}

/** Compare a `join()`-built absolute path against a repo-relative literal.
 *  `join()` yields backslashes on Windows, so `endsWith('audit/perf.md')` is
 *  ALWAYS false there — the same vacuity this file's `missingPath()` helper
 *  exists to prevent, one segment further out. Normalise separators first. */
export function posix(path: string): string {
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
export function seedCompleteSlice(projectRoot: string, rid: string): void {
  writeArtifact(
    projectRoot,
    'prd/handoff.md',
    '---\nschemaVersion: 2\nsha256: deadbeef\n---\n\n# Handoff\n'
  );
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

export async function missingPaths(
  projectRoot: string,
  requestId: string
): Promise<{ missing: string[]; warnings: string[]; ok: boolean }> {
  const result = await checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd',
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
export function ridScopedPrereqs(): ReadonlyArray<{
  ridPath: string;
  prereq: ArtifactPrerequisite;
}> {
  return getPrerequisitesFor('rd', 'qa-handoff', 'feature')
    .filter((prereq) => prereq.relativePath.includes('<rid>'))
    .map((prereq) => ({ ridPath: prereq.relativePath, prereq }));
}
