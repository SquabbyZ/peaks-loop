import { join, dirname, basename } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { pathExists } from '../../shared/fs.js';
import { emitObservabilityEvent } from '../observability/observability-service.js';
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
  /** Relative path under `.peaks/_runtime/<session-id>/`. May contain `<rid>` placeholder. */
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
  /**
   * Slice 2.6.1.F: structural heading markers — when set, the file must
   * contain ALL of these as markdown headings (line beginning with `#`–`###`
   * followed by the marker, case-insensitive). This prevents a file from
   * passing the gate by simply mentioning the marker as prose. Use this for
   * section-anchored gates like the karpathy 4-guideline review.
   * Independent of `mustContain` / `mustContainAny`.
   */
  headingMustContain?: ReadonlyArray<string>;
};

export type PrerequisiteCheckResult = {
  ok: boolean;
  missing: Array<{ path: string; description: string }>;
};

type TransitionKey = `${RequestArtifactRole}:${RequestArtifactState}`;
type PrerequisiteTable = Partial<Record<TransitionKey, ReadonlyArray<ArtifactPrerequisite>>>;

// Shared prerequisite fragments
// (Removed in v2.11.0 Group A: TECH_DOC prerequisite. The per-session
// rd/tech-doc.md is replaced by the immutable peaks-prd handoff at
// prd/handoff.md. Group B will introduce a PRD_HANDOFF prerequisite
// once the handoff service lands. For Group A scope, `rd:implemented`
// and `rd:qa-handoff` rely on the evidence files (code-review,
// security-review, perf-baseline, karpathy-review, unit tests) only.)
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
// Karpathy-Gate (Slice 5/6 — karpathy-enforcement 5-way fanout).
// Hard gate: rd/karpathy-review.md MUST exist with the 4 guideline section
// markers (think-before-coding / simplicity-first / surgical-changes /
// goal-driven-execution) as actual headings before rd:qa-handoff transitions
// to qa. Slice 2.6.1.F hardening: the 4 guideline markers are now enforced
// as `headingMustContain` (line-anchored `#`–`###` prefix), not as substring
// matches. This prevents a malicious or careless file from passing the gate
// by simply mentioning the guideline names as prose. The `## Karpathy-Gate`
// header remains a substring match (it is the file's own gate header, not
// a structural section anchor).
const KARPATHY_REVIEW: ArtifactPrerequisite = {
  relativePath: 'rd/karpathy-review.md',
  description:
    'RD-side karpathy review (peaks-rd 5-way fanout) — must contain a "## Karpathy-Gate" header AND the 4 guideline section markers (Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution) as actual markdown headings. Per karpathy §1 / §3.',
  mustContain: ['## Karpathy-Gate'],
  headingMustContain: [
    'Think Before Coding',
    'Simplicity First',
    'Surgical Changes',
    'Goal-Driven Execution'
  ]
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

// v2.11.0 D1/D4 trim (Group C Tier 6): peaks-qa no longer requires
// qa/security-findings.md or qa/performance-findings.md at qa:verdict-issued.
// Those are owned by peaks-rd's audit fan-out (rd/security-review.md and
// rd/perf-baseline.md). QA references them by path from the test-report body
// (see qa-transition-gates.md Gates A3/A4). SECURITY_FINDINGS /
// PERFORMANCE_FINDINGS constants are kept for back-compat and a 1-minor-
// release deprecation window but are NOT in any qa:verdict-issued table.
const FEATURE_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:implemented': [],
  'rd:qa-handoff': [CODE_REVIEW, SECURITY_REVIEW, PERF_BASELINE, KARPATHY_REVIEW, UNIT_TESTS, QA_INITIATED],
  'qa:running': [TEST_CASES],
  'qa:verdict-issued': [TEST_CASES, TEST_REPORT]
};

// Bugfix: lighter planning artifact (bug-analysis instead of tech-doc), still requires code review + security review + regression test.
// Performance baseline: required for perf-shaped bugfixes (where the bug IS a
// perf regression). For non-perf bugfixes, RD writes the perf-baseline stub
// with "N/A — no perf surface" — Gate B9 still passes (mustContainAny hit),
// and the stub tells QA Gate A4 to skip the perf diff.
// v2.11.0 D1/D4: SECURITY_FINDINGS dropped from qa:verdict-issued (peaks-rd owns it).
const BUGFIX_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:implemented': [BUG_ANALYSIS],
  'rd:qa-handoff': [BUG_ANALYSIS, CODE_REVIEW, SECURITY_REVIEW, PERF_BASELINE, UNIT_TESTS, QA_INITIATED],
  'qa:running': [TEST_CASES],
  'qa:verdict-issued': [TEST_CASES, TEST_REPORT]
};

// Refactor: same as feature; refactor hard gates (coverage ≥ 95%) are enforced separately in peaks-rd SKILL.
const REFACTOR_TABLE: PrerequisiteTable = FEATURE_TABLE;

// Docs / chore: minimal gate — require PRD content before proceeding.
// Prevents jumping to implementation without planning.
const MINIMAL_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT]
};

// Config: security review is the only mandatory check (config changes can break auth, CORS, CSP, secrets handling).
// v2.11.0 D1/D4: SECURITY_FINDINGS dropped from qa:verdict-issued (peaks-rd owns security evidence).
const CONFIG_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:qa-handoff': [SECURITY_REVIEW],
  'qa:verdict-issued': [TEST_REPORT]
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
   * Durable scope of the artifact (the `.peaks/_runtime/<changeId>/` directory
   * the file lives in). The gate scans under `.peaks/_runtime/<changeId>/<role>/`
   * for prerequisite artifacts. As of slice 2026-06-05-change-id-as-unit-of-work,
   * this replaces the legacy `sessionId` field — the file body and the
   * on-disk path now agree on the same top-level dir.
   */
  changeId: string;
  /**
   * Session binding (the developer's local session that wrote the
   * request artifact). Read from the file body's `- session:` line.
   * Optional, but when present the gate falls back to
   * `.peaks/_runtime/<sid>/<role>/` and then `.peaks/_runtime/<sid>/<role>/`
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
  // Slice 006 simplifies the resolution to a 2-tier fallback. The
  // per-change-id scope (`.peaks/_runtime/<changeId>/<role>/`) is gone — new
  // artifacts go to the session dir directly. The 2 tiers are:
  //   1. `.peaks/_runtime/<sid>/<role>/...` (post-F3 canonical
  //      session home; primary).
  //   2. `.peaks/_runtime/<sid>/<role>/...` (pre-F3 legacy session home;
  //      back-compat).
  // The changeId is preserved in the artifact body's frontmatter for
  // human navigation; it is no longer a filesystem path key.
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
    if (prerequisite.headingMustContain && prerequisite.headingMustContain.length > 0) {
      const body = await readFile(absolute, 'utf8');
      // Slice 2.6.1.F: a line beginning with `#`, `##`, or `###` followed by
      // the marker (case-insensitive). Fenced code blocks are NOT excluded
      // here — a "heading" inside a code fence is rare and, when present,
      // should still be reported as missing to keep the contract strict.
      const headingLines = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => /^#{1,3}\s+/.test(line));
      const loweredHeadings = headingLines.map((h) => h.toLowerCase());
      const missingHeadings = prerequisite.headingMustContain.filter(
        (marker) => !loweredHeadings.some((h) => h.includes(marker.toLowerCase()))
      );
      if (missingHeadings.length > 0) {
        missing.push({
          path: relative,
          description: `${prerequisite.description} — missing heading(s): ${missingHeadings.join(', ')}`
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
  const result: PrerequisiteCheckResult = { ok: missing.length === 0, missing };
  emitPrereqTransitionEvent({
    projectRoot: options.projectRoot,
    sessionId: options.sessionId ?? '',
    role: options.role,
    newState: options.newState,
    requestId: options.requestId,
    result
  });
  return result;
}

// Slice C of v2.11.1 — observability hook #7/7. Fire-and-forget per
// PRD Q4. The synchronous emit never throws and never blocks the
// prereq check return value.
function emitPrereqTransitionEvent(opts: {
  projectRoot: string;
  sessionId: string;
  role: RequestArtifactRole;
  newState: RequestArtifactState;
  requestId: string;
  result: PrerequisiteCheckResult;
}): void {
  if (opts.sessionId === undefined) return;
  emitObservabilityEvent({
    schemaVersion: 1,
    ts: new Date().toISOString(),
    sessionId: opts.sessionId,
    category: 'slice-transition',
    sliceRid: opts.requestId,
    detail: {
      artifactRole: opts.role,
      to: opts.newState,
      prereqOk: opts.result.ok,
      missingCount: opts.result.missing.length
    }
  }, { projectRoot: opts.projectRoot });
}

/**
 * Resolve a prerequisite to an on-disk path, with a 2-tier fallback
 * (slice 006 — the per-change-id tier was dropped because per-change-id
 * dirs are no longer created):
 *   1. `<canonicalSessionRoot>/<relative>` (post-F3 canonical session
 *      home, when `canonicalSessionRoot` is provided).
 *   2. `<legacySessionRoot>/<relative>` (pre-F3 legacy session home,
 *      when `legacySessionRoot` is provided).
 * Tolerates the numbered filename prefix that `request init` writes
 * (e.g. `001-<rid>.md`) at every tier. Returns the matched absolute
 * path, or null when nothing matches.
 */
async function resolvePrerequisiteAbsolutePathWithFallback(
  canonicalSessionRoot: string | null,
  legacySessionRoot: string | null,
  prerequisite: ArtifactPrerequisite,
  requestId: string
): Promise<string | null> {
  const roots: Array<string | null> = [canonicalSessionRoot, legacySessionRoot];
  for (const root of roots) {
    if (root === null) continue;
    const found = await resolvePrerequisiteAbsolutePath(root, prerequisite, requestId);
    if (found !== null) return found;
  }
  return null;
}
