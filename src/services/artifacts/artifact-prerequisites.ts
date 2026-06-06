import { join, dirname, basename } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { pathExists } from '../../shared/fs.js';
import type { RequestArtifactRole, RequestArtifactState } from './request-artifact-service.js';

export type RequestType = 'feature' | 'bugfix' | 'refactor' | 'docs' | 'config' | 'chore';

export const VALID_REQUEST_TYPES: ReadonlyArray<RequestType> = [
  'feature',
  'bugfix',
  'refactor',
  'docs',
  'config',
  'chore'
];

export const DEFAULT_REQUEST_TYPE: RequestType = 'feature';

export function isRequestType(value: string): value is RequestType {
  return (VALID_REQUEST_TYPES as ReadonlyArray<string>).includes(value);
}

export type ArtifactPrerequisite = {
  /** Relative path under `.peaks/<session-id>/`. May contain `<rid>` placeholder. */
  relativePath: string;
  /** Human-readable description of what this artifact represents. */
  description: string;
  /** Optional content markers — when set, the file must contain ALL of these (case-insensitive substring). */
  mustContain?: ReadonlyArray<string>;
  /**
   * Optional content markers — when set, the file must contain AT LEAST ONE of
   * these (case-insensitive substring). Use this for escape-hatch patterns
   * (e.g. perf-baseline's "Results table" OR "N/A — no perf surface" stub).
   * `mustContain` and `mustContainAny` are independent: when both are set,
   * `mustContain` markers must all be present AND at least one `mustContainAny`
   * marker must be present.
   */
  mustContainAny?: ReadonlyArray<string>;
};

export type PrerequisiteCheckResult = {
  ok: boolean;
  missing: Array<{ path: string; description: string }>;
};

type TransitionKey = `${RequestArtifactRole}:${RequestArtifactState}`;
type PrerequisiteTable = Partial<Record<TransitionKey, ReadonlyArray<ArtifactPrerequisite>>>;

// Shared prerequisite fragments
const TECH_DOC: ArtifactPrerequisite = {
  relativePath: 'rd/tech-doc.md',
  description: 'RD technical design doc (architecture, files changed, data flow)',
  mustContain: ['## Red-line scope', '## Implementation evidence']
};
const BUG_ANALYSIS: ArtifactPrerequisite = {
  relativePath: 'rd/bug-analysis.md',
  description: 'Bug root-cause analysis (reproduction, affected paths, fix approach, regression test plan)',
  mustContain: ['## Root cause', '## Fix approach']
};
const CODE_REVIEW: ArtifactPrerequisite = {
  relativePath: 'rd/code-review.md',
  description: 'Code review evidence (CRITICAL/HIGH must be fixed before handoff)',
  mustContain: ['## Findings', 'CRITICAL']
};
const SECURITY_REVIEW: ArtifactPrerequisite = { relativePath: 'rd/security-review.md', description: 'Security review evidence for the changed surface' };
// Gate B9 — RD-side perf baseline (peaks-rd SKILL "Parallel review fan-out").
// The file must exist; the body must either carry a Results table marker
// (per peaks-rd SKILL "Mandatory perf-baseline output") or the explicit
// "N/A — no perf surface" escape hatch. A slice without a perf surface
// still has to write the stub; an RD that omits perf-baseline entirely is
// blocked here, matching peaks-rd's BLOCKING Gate B9 claim.
const PERF_BASELINE: ArtifactPrerequisite = {
  relativePath: 'rd/perf-baseline.md',
  description:
    'RD-side perf baseline (peaks-rd Gate B9) — must include a Results table with measurements OR the literal "N/A — no perf surface" escape hatch in the Notes section. QA Gate A4 diffs against this file.',
  // Either a real Results table is present, OR the explicit no-perf-surface
  // stub marker. Both paths satisfy Gate B9; absence of both is BLOCKED.
  mustContainAny: ['## Results', 'N/A — no perf surface']
};
const TEST_CASES: ArtifactPrerequisite = {
  relativePath: 'qa/test-cases/<rid>.md',
  description: 'Generated test cases (unit / integration / UI regression)',
  mustContain: ['## Test cases']
};
const TEST_REPORT: ArtifactPrerequisite = {
  relativePath: 'qa/test-reports/<rid>.md',
  description: 'Test execution report with actual pass/fail/coverage results',
  mustContain: ['## Test execution']
};
const SECURITY_FINDINGS: ArtifactPrerequisite = {
  relativePath: 'qa/security-findings.md',
  description: 'Security test findings (record "no findings" inside if truly clean)',
  mustContain: ['## Findings']
};
const PERFORMANCE_FINDINGS: ArtifactPrerequisite = {
  relativePath: 'qa/performance-findings.md',
  description: 'Performance test findings (record baseline/after numbers or explicit "not applicable" rationale)',
  mustContain: ['## Baseline']
};

// PRD content prereq: ensures the PRD artifact has actual scope/acceptance content
// before handoff to RD/UI/QA. The SKILL says "Handoff to RD/UI/QA is blocked while
// the artifact is missing or in `draft` state" — this gives that claim a CLI gate.
const PRD_CONTENT: ArtifactPrerequisite = {
  relativePath: 'prd/requests/<rid>.md',
  description: 'PRD artifact must contain Goal and Acceptance criteria sections before handoff',
  mustContain: ['## Goals', '## Acceptance']
};

const UNIT_TESTS: ArtifactPrerequisite = {
  relativePath: 'qa/test-cases/<rid>.md',
  description: 'Unit test files for the implemented changes (enforces peaks-rd Gate B2)',
  mustContain: ['## Test cases', 'test(']
};

const QA_INITIATED: ArtifactPrerequisite = {
  relativePath: 'qa/.initiated',
  description: 'QA skill must be invoked before RD handoff (run peaks request init --role qa)'
};

const FEATURE_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:implemented': [TECH_DOC],
  'rd:qa-handoff': [TECH_DOC, CODE_REVIEW, SECURITY_REVIEW, PERF_BASELINE, UNIT_TESTS, QA_INITIATED],
  'qa:running': [TEST_CASES],
  'qa:verdict-issued': [TEST_CASES, TEST_REPORT, SECURITY_FINDINGS, PERFORMANCE_FINDINGS]
};

// Bugfix: lighter planning artifact (bug-analysis instead of tech-doc), still requires code review + security review + regression test.
// Performance baseline: required for perf-shaped bugfixes (where the bug IS a
// perf regression). For non-perf bugfixes, RD writes the perf-baseline stub
// with "N/A — no perf surface" — Gate B9 still passes (mustContainAny hit),
// and the stub tells QA Gate A4 to skip the perf diff.
const BUGFIX_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:implemented': [BUG_ANALYSIS],
  'rd:qa-handoff': [BUG_ANALYSIS, CODE_REVIEW, SECURITY_REVIEW, PERF_BASELINE, UNIT_TESTS, QA_INITIATED],
  'qa:running': [TEST_CASES],
  'qa:verdict-issued': [TEST_CASES, TEST_REPORT, SECURITY_FINDINGS]
};

// Refactor: same as feature; refactor hard gates (coverage ≥ 95%) are enforced separately in peaks-rd SKILL.
const REFACTOR_TABLE: PrerequisiteTable = FEATURE_TABLE;

// Docs / chore: minimal gate — require PRD content before proceeding.
// Prevents jumping to implementation without planning.
const MINIMAL_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT]
};

// Config: security review is the only mandatory check (config changes can break auth, CORS, CSP, secrets handling).
const CONFIG_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:qa-handoff': [SECURITY_REVIEW],
  'qa:verdict-issued': [SECURITY_FINDINGS]
};

const PREREQUISITES_BY_TYPE: Record<RequestType, PrerequisiteTable> = {
  feature: FEATURE_TABLE,
  bugfix: BUGFIX_TABLE,
  refactor: REFACTOR_TABLE,
  docs: MINIMAL_TABLE,
  config: CONFIG_TABLE,
  chore: MINIMAL_TABLE
};

export type CheckPrerequisitesOptions = {
  projectRoot: string;
  /**
   * Durable scope of the artifact (the `.peaks/<changeId>/` directory
   * the file lives in). The gate scans under `.peaks/<changeId>/<role>/`
   * for prerequisite artifacts. As of slice 2026-06-05-change-id-as-unit-of-work,
   * this replaces the legacy `sessionId` field — the file body and the
   * on-disk path now agree on the same top-level dir.
   */
  changeId: string;
  /**
   * Session binding (the developer's local session that wrote the
   * request artifact). Read from the file body's `- session:` line.
   * Optional, but when present the gate falls back to
   * `.peaks/_runtime/<sid>/<role>/` and then `.peaks/<sid>/<role>/`
   * for prerequisite artifacts that don't exist at the per-change-id
   * path. This mirrors the F1/F2 back-compat pattern (read new path
   * first, then legacy) and keeps the gate working for users whose
   * QA / tech-doc / initiated artifacts still live under the session
   * dir rather than under the change-id dir.
   */
  sessionId?: string;
  role: RequestArtifactRole;
  newState: RequestArtifactState;
  requestId: string;
  requestType?: RequestType;
};

export function getPrerequisitesFor(
  role: RequestArtifactRole,
  newState: RequestArtifactState,
  requestType: RequestType = DEFAULT_REQUEST_TYPE
): ReadonlyArray<ArtifactPrerequisite> {
  const table = PREREQUISITES_BY_TYPE[requestType];
  return table[`${role}:${newState}`] ?? [];
}

function resolvePrerequisitePath(prerequisite: ArtifactPrerequisite, requestId: string): string {
  return prerequisite.relativePath.replace('<rid>', requestId);
}

/**
 * Resolve a prerequisite to an on-disk path, tolerating the numbered filename
 * prefix that `request init` writes (e.g. `001-<rid>.md`). When the prerequisite
 * path contains `<rid>`, we accept either the legacy bare `<rid>.md` form or any
 * `NNN-<rid>.md` numbered form — mirroring the matcher in request-artifact-service.
 * Returns the matched absolute path, or null when nothing matches.
 */
async function resolvePrerequisiteAbsolutePath(
  sessionRoot: string,
  prerequisite: ArtifactPrerequisite,
  requestId: string
): Promise<string | null> {
  const relative = resolvePrerequisitePath(prerequisite, requestId);
  const exact = join(sessionRoot, relative);
  if (await pathExists(exact)) {
    return exact;
  }
  // Only `<rid>`-templated prerequisites can carry a numbered prefix; fixed paths
  // (e.g. rd/tech-doc.md) are matched exactly above.
  if (!prerequisite.relativePath.includes('<rid>')) {
    return null;
  }
  const dir = dirname(exact);
  const targetSuffix = `-${basename(exact)}`;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const match = entries.find((name) => /^\d+-/.test(name) && name.endsWith(targetSuffix));
  return match ? join(dir, match) : null;
}

export async function checkPrerequisites(options: CheckPrerequisitesOptions): Promise<PrerequisiteCheckResult> {
  const requirements = getPrerequisitesFor(options.role, options.newState, options.requestType);
  if (requirements.length === 0) {
    return { ok: true, missing: [] };
  }
  // As of slice 2026-06-05-change-id-as-unit-of-work, the prerequisite
  // gate resolves paths under `.peaks/<changeId>/<role>/...` where the
  // changeId is the file's durable scope (the top-level dir the file
  // lives in), NOT the body's `- session:` line. The body and the path
  // can now disagree (e.g. a request written in one session but read
  // across sessions), and the gate follows the on-disk location.
  //
  // As of slice 2026-06-06-session-layout-canonicalize (F3) repair
  // cycle 1, the gate also falls back to:
  //   1. `.peaks/_runtime/<sid>/<role>/...` (post-F3 canonical home
  //      for session-scoped artifacts: `qa/.initiated`,
  //      `qa/test-cases/<rid>.md`, etc.), then
  //   2. `.peaks/<sid>/<role>/...` (pre-F3 legacy home for the same
  //      artifacts).
  // This mirrors the F1/F2 back-compat pattern (read new path first,
  // then legacy) so users who have NOT migrated the QA / tech-doc /
  // initiated artifacts from the session dir to the change-id dir
  // still get a clean transition. The per-change-id path wins when
  // both exist (post-F3 source of truth).
  const changeRoot = join(options.projectRoot, '.peaks', options.changeId);
  const canonicalSessionRoot = options.sessionId !== undefined
    ? join(options.projectRoot, '.peaks', '_runtime', options.sessionId)
    : null;
  const legacySessionRoot = options.sessionId !== undefined
    ? join(options.projectRoot, '.peaks', options.sessionId)
    : null;
  const missing: Array<{ path: string; description: string }> = [];
  for (const prerequisite of requirements) {
    const relative = resolvePrerequisitePath(prerequisite, options.requestId);
    const absolute = await resolvePrerequisiteAbsolutePathWithFallback(
      changeRoot,
      canonicalSessionRoot,
      legacySessionRoot,
      prerequisite,
      options.requestId
    );
    if (absolute === null) {
      missing.push({ path: relative, description: prerequisite.description });
      continue;
    }
    if (prerequisite.mustContain && prerequisite.mustContain.length > 0) {
      const body = await readFile(absolute, 'utf8');
      const lowered = body.toLowerCase();
      const missingMarkers = prerequisite.mustContain.filter((marker) => !lowered.includes(marker.toLowerCase()));
      if (missingMarkers.length > 0) {
        missing.push({
          path: relative,
          description: `${prerequisite.description} — missing section(s): ${missingMarkers.join(', ')}`
        });
      }
    }
    if (prerequisite.mustContainAny && prerequisite.mustContainAny.length > 0) {
      const body = await readFile(absolute, 'utf8');
      const lowered = body.toLowerCase();
      const hitAny = prerequisite.mustContainAny.some((marker) => lowered.includes(marker.toLowerCase()));
      if (!hitAny) {
        missing.push({
          path: relative,
          description: `${prerequisite.description} — none of the escape-hatch markers present: ${prerequisite.mustContainAny.join(', ')}`
        });
      }
    }
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Resolve a prerequisite to an on-disk path, with a 3-tier fallback:
 *   1. `<changeRoot>/<relative>` (per-change-id scope; post-F3 source
 *      of truth).
 *   2. `<canonicalSessionRoot>/<relative>` (post-F3 canonical session
 *      home, when `canonicalSessionRoot` is provided).
 *   3. `<legacySessionRoot>/<relative>` (pre-F3 legacy session home,
 *      when `legacySessionRoot` is provided).
 * Tolerates the numbered filename prefix that `request init` writes
 * (e.g. `001-<rid>.md`) at every tier. Returns the matched absolute
 * path, or null when nothing matches.
 */
async function resolvePrerequisiteAbsolutePathWithFallback(
  changeRoot: string,
  canonicalSessionRoot: string | null,
  legacySessionRoot: string | null,
  prerequisite: ArtifactPrerequisite,
  requestId: string
): Promise<string | null> {
  const roots: Array<string | null> = [changeRoot, canonicalSessionRoot, legacySessionRoot];
  for (const root of roots) {
    if (root === null) continue;
    const found = await resolvePrerequisiteAbsolutePath(root, prerequisite, requestId);
    if (found !== null) return found;
  }
  return null;
}
