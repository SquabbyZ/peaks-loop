// The prerequisite fragments shared by two or more request-type tables.
//
// WHY THIS MODULE EXISTS. `artifact-prerequisites.ts` was at the 300-line
// file-size cap and `fileSizeExcessLines` is a ratchet that may only go DOWN.
// Adding the design-fidelity row to the tables needed headroom, so the tables
// and their fragments moved here. Every body below was moved VERBATIM from
// `artifact-prerequisites.ts`; only the `export ` prefix was added, because a
// sibling module now reads them.
//
// NOTHING HERE IS EXPORTED FROM `artifact-prerequisites.ts` TODAY. These are
// composition units for `prerequisite-tables.ts`; the gate still reads the
// assembled tables through the public `getPrerequisitesFor`.
import type { ArtifactPrerequisite } from './artifact-prerequisites.js';

// Shared prerequisite fragments.
export const BUG_ANALYSIS: ArtifactPrerequisite = {
  relativePath: 'rd/bug-analysis-<rid>.md',
  // The bare path below is still accepted, so an older session keeps passing.
  legacyRelativePath: 'rd/bug-analysis.md',
  description:
    'Bug root-cause analysis (reproduction, affected paths, fix approach, regression test plan). The rid is part of the filename so two bugfix slices in one session do not collide; the bare location is accepted during the back-compat window via legacyRelativePath.',
  mustContain: ['## Root cause', '## Fix approach']
};
export const CODE_REVIEW: ArtifactPrerequisite = {
  // The bare path below is still accepted, so an older session keeps passing.
  relativePath: 'rd/code-review-<rid>.md',
  legacyRelativePath: 'rd/code-review.md',
  description: 'Code review evidence (CRITICAL/HIGH must be fixed before handoff)',
  mustContain: ['## Findings', 'CRITICAL']
};
export const SECURITY_REVIEW: ArtifactPrerequisite = {
  relativePath: 'rd/security-review-<rid>.md',
  // The bare path is the legacy tier, so a session already on disk keeps passing.
  legacyRelativePath: 'rd/security-review.md',
  description:
    'Security review evidence for the changed surface. The rid is part of the filename so two config slices in one session do not collide; the bare location is the legacy tier. The body is never read, so a collision here was silent.'
};
// Gate B9 — RD-side perf baseline: the body carries a Results table or "N/A — no perf surface".
export const PERF_BASELINE: ArtifactPrerequisite = {
  relativePath: 'rd/perf-baseline.md',
  description:
    'RD-side perf baseline (peaks-rd Gate B9) — must include a Results table with measurements OR the literal "N/A — no perf surface" escape hatch in the Notes section. QA Gate A4 diffs against this file.',
  // Either a real Results table is present, OR the explicit no-perf-surface
  // stub marker. Both paths satisfy Gate B9; absence of both is BLOCKED.
  mustContainAny: ['## Results', 'N/A — no perf surface']
};
// v2.12.0 Group B Tier 5 — audit outputs from the new independent
// skills (`peaks-security-audit` / `peaks-perf-audit`). These replace
// the v2.11.x rd/{security-review,perf-baseline}.md slots for the
// fanout-trigger types (feat / bugfix / refactor). The audit skills
// are dispatched as pre-RD audit runs that consume the public PRD
// handoff (`prd/handoff.md`) — see `AUDIT_REQUIRES_HANDOFF` below.
//
// Back-compat: the canonical location is `audit/security-<rid>.md`
// (and `audit/perf.md`) plus the older `rd/security-review.md` (and
// `rd/perf-baseline.md`) are accepted via `legacyRelativePaths`, in
// that order, for the back-compat window.
export const AUDIT_SECURITY: ArtifactPrerequisite = {
  relativePath: 'audit/security-<rid>.md',
  // v2.12.0 location, then the v2.11.x one. Both are live on disk.
  legacyRelativePath: 'audit/security.md',
  legacyRelativePaths: ['rd/security-review.md'],
  description:
    'Independent security audit output (peaks-security-audit skill, v2.12.0+). Replaces the v2.11.x rd/security-review.md slot for fanout-trigger request types. The rid is part of the filename so two slices in one session do not collide; the bare and rd/-prefixed legacy locations are accepted during the back-compat window via legacyRelativePaths.',
  // New canonical path writes a "## Verdict" header on the audit
  // envelope. The legacy rd/security-review.md writes a "## Findings"
  // header. Both pass the gate.
  mustContainAny: ['## Verdict', '## Findings']
};
export const AUDIT_PERF: ArtifactPrerequisite = {
  relativePath: 'audit/perf-<rid>.md',
  // Same two-tier history as AUDIT_SECURITY. This is the pair that
  // produced the 2026-09-13 evidence: `audit/perf.md` was overwritten by
  // the second slice and the first slice's audit is unrecoverable.
  legacyRelativePath: 'audit/perf.md',
  legacyRelativePaths: ['rd/perf-baseline.md'],
  description:
    'Independent perf audit output (peaks-perf-audit skill, v2.12.0+). Replaces the v2.11.x rd/perf-baseline.md slot for fanout-trigger request types. The rid is part of the filename so two slices in one session do not collide; the bare and rd/-prefixed legacy locations are accepted during the back-compat window via legacyRelativePaths.',
  // New schema writes "## Baseline" header; the legacy schema writes
  // "## Results". Both pass the gate, as does the explicit
  // no-perf-surface stub (slices whose surface is purely logic /
  // config / docs).
  mustContainAny: ['## Baseline', '## Results', 'N/A — no perf surface']
};
// v2.13.1 Group A — MUT prereq (Plan 2 ships `mut-report.json` to
// `.peaks/_runtime/<sid>/mut/mut-report.json`; v2.13.1 wires it into
// the rd:qa-handoff gate for fanout-trigger types). The body must carry
// the `"passed": true` marker so the gate rejects failed mutation
// runs. We pin on the substring `"passed":` so that both JSON and
// pretty-printed JSON (with whitespace variations) are caught — the
// downstream stricter check happens in `verdict-aggregator.ts`. The
// PRD's preserved-behavior clause says `loadMutReport() === null`
// stays `skipped` on the qa side, which means this prereq is the
// rd-side CLI hard gate (blocks `rd → qa-handoff`), while qa-side
// consumption remains soft.
//
// `backCompat: true` is set, a MISSING file downgrades to a warning instead
// of a hard failure. The hard-fail behavior for `passed: false` is preserved
// (the body still has to carry `"passed": true` when present).
// v2.14.0 will remove `backCompat` and re-elevate missing → throw.
// The warning's code is derived from this prerequisite
// (`backCompatWarningCode` → `mut-report-missing-deprecated-in-v2.14.0`)
// rather than hardcoded in the shared branch, so a consumer filtering on the
// code cannot match a different artifact's warning.
//
// The repo's producer/reader constant is `mutReportPath()` in
// `packages/peaks-loop-mut/src/services/mut/report-loader.ts`, naming
// `mut/mut-report.json`; `peaks mut run`'s `--out` is caller-supplied. A
// `<rid>`-templated requirement here would name no file a producer can write —
// a gate living only in prose, behind `backCompat: true`, gating nothing.
export const MUT_REPORT: ArtifactPrerequisite = {
  relativePath: 'mut/mut-report.json',
  description:
    'peaks-mut mutation + weak-assertion report (Plan 2, v2.12.0+). v2.13.1: the artifact contract requires this at rd:qa-handoff for feature / bugfix / refactor slices — `peaks workflow verify-pipeline` is what checks that, and it reads this table rather than the transition. v2.13.2: back-compat window — missing file downgrades to a warning (1-minor-release); passed:false still throws. The body must carry `"passed": true` when present; failed runs are blocked at this gate. CONFIG / DOCS / CHORE slices retain the legacy "no acceptance surface" exemption.',
  // Substring check on the JSON property name only — strictness (kill
  // rate ≥ 0.8 etc.) is enforced downstream by verdict-aggregator +
  // peaks-mut's evaluateThresholds. We require both the property name
  // and a literal `true` value to keep the gate as tight as possible
  // without depending on JSON parsing in the prereq resolver.
  mustContainAny: ['"passed": true', '"passed":true'],
  backCompat: true,
  backCompatUntil: 'v2.14.0'
};

// v2.12.0 Group B Tier 5 — gate that the peaks-prd handoff (the
// immutable, per-slice handoff capsule at `prd/handoff-<rid>.md`)
// exists before the audit skills consume it: the peaks-security-audit
// / peaks-perf-audit commands read its frontmatter, so the prereq gate
// holds it at rd:qa-handoff.
//
// This gate is co-listed with AUDIT_SECURITY / AUDIT_PERF at
// `rd:qa-handoff` for FEATURE / BUGFIX / REFACTOR. CONFIG retains
// the old form (no PRD handoff chain — config slices may run before
// PRD handoff exists for small CONFIG-only commits).
export const AUDIT_REQUIRES_HANDOFF: ArtifactPrerequisite = {
  relativePath: 'prd/handoff-<rid>.md',
  // filename, like the four audit/review artifacts above. A single slot per
  // SESSION cannot hold two slices' capsules — `peaks prd handoff init`
  // overwrote it on every call, and this gate stayed green because it pinned
  // only `schemaVersion: 2` + `sha256:`, never WHOSE rid the file named.
  // Measured on `2026-09-13-session-21878f`: a four-slice job passed this
  // prerequisite on a capsule written for a different line of work.
  // The bare path stays accepted (see `legacyRelativePath`) so the three
  // sessions on disk that hold only `prd/handoff.md` keep passing. That tier
  // on, and every producer (`handoff-service.initHandoff`,
  legacyRelativePath: 'prd/handoff.md',
  description:
    'PRD handoff capsule (v2.12.0+) — peaks-security-audit / peaks-perf-audit both read frontmatter from this file. There is no dependency on the transition: the ARTIFACT CONTRACT is what binds every reader of this table, and `peaks workflow verify-pipeline` is what checks the contract on disk (`contractEvidencePaths()` reads this table; a state name does not). The `rd:qa-handoff` transition enforces this same table through `checkPrerequisites`, so a missing prerequisite blocks the state move and is reported without one — the table is checked the same way with or without a transition. The rid is part of the filename so two slices in one session do not collide; the bare pre-rid-scoping location is accepted as the legacy tier.',
  // Empty `mustContain` is fine — file existence is the contract.
  // The peaks-prd handoff service writes frontmatter with
  // `schemaVersion: 2` and a sha256 fingerprint; we pin a
  // substring check on `schemaVersion: 2` to fail loudly if a
  // legacy handoff (schemaVersion: 1) slips in. This protects
  // the audit skills from reading an envelope they cannot parse.
  mustContain: ['schemaVersion: 2', 'sha256:']
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
export const KARPATHY_REVIEW: ArtifactPrerequisite = {
  relativePath: 'rd/karpathy-review-<rid>.md',
  legacyRelativePath: 'rd/karpathy-review.md',
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
// v2.14.0 G4 — third-party reviewer (peaks-reviewer skill). Parallel
// to KARPATHY_REVIEW. The body MUST carry the literal substring
// `third-party-review` so a stub file with an empty envelope cannot
// pass the gate. The full envelope lives at the JSON sibling path
// (`rd/third-party-review-<rid>.json`); this MD file is the human-readable
// companion. The body declares a `modelFamily` that the gate diffs against
// the karpathy review's: equality fails the build. When `~/.peaks/config.json`
// lacks a `reviewer.providers` section, the prereq is auto-marked `skipped:
// no-reviewer-config` and the transition still passes (A4.3 fallbackOnError=skip).
// The bare pre-rid path is the legacy tier, so sessions already on disk pass.
export const THIRD_PARTY_REVIEW: ArtifactPrerequisite = {
  relativePath: 'rd/third-party-review-<rid>.md',
  legacyRelativePath: 'rd/third-party-review.md',
  description:
    'v2.14.0 G4 third-party reviewer (peaks-reviewer skill) — must declare a `modelFamily` distinct from the karpathy-reviewer modelFamily (AC-4.4). Skipped when `~/.peaks/config.json` lacks `reviewer.providers` (>=2 entries); the prereq then resolves to a soft warning (`no-reviewer-config`) rather than a hard failure. The JSON sibling at `rd/third-party-review-<rid>.json` carries the schema-validated ReviewerEnvelope (no free-form LLM JSON); the rid is part of both filenames so two slices in one session do not collide, and the bare location is accepted as the legacy tier. v2.14.0 ships as a soft-warning prereq (1-minor-release back-compat window); v2.15.0 will hard-fail when the file is absent AND `reviewer.providers` is configured.',
  mustContain: ['third-party-review', 'modelFamily'],
  backCompat: true,
  backCompatUntil: 'v2.15.0'
};
export const TEST_CASES: ArtifactPrerequisite = {
  relativePath: 'qa/test-cases/<rid>.md',
  description: 'Generated test cases (unit / integration / UI regression)',
  mustContain: ['## Test cases']
};
export const TEST_REPORT: ArtifactPrerequisite = {
  relativePath: 'qa/test-reports/<rid>.md',
  description: 'Test execution report with actual pass/fail/coverage results',
  mustContain: ['## Test execution']
};
export const SECURITY_FINDINGS: ArtifactPrerequisite = {
  relativePath: 'qa/security-findings.md',
  description: 'Security test findings (record "no findings" inside if truly clean)',
  mustContain: ['## Findings']
};
export const PERFORMANCE_FINDINGS: ArtifactPrerequisite = {
  relativePath: 'qa/performance-findings.md',
  description:
    'Performance test findings (record baseline/after numbers or explicit "not applicable" rationale)',
  mustContain: ['## Baseline']
};

// PRD content prereq: ensures the PRD artifact has actual scope/acceptance content
// before handoff to RD/UI/QA. The SKILL says "Handoff to RD/UI/QA is blocked while
// the artifact is missing or in `draft` state" — this gives that claim a CLI gate.
export const PRD_CONTENT: ArtifactPrerequisite = {
  relativePath: 'prd/requests/<rid>.md',
  description: 'PRD artifact must contain Goal and Acceptance criteria sections before handoff',
  mustContain: ['## Goals', '## Acceptance']
};

// R10 (2026-09-16): the second marker used to be the bare `test(` inside
// `mustContain` — i.e. ALL markers required. That made the gate satisfiable
// only by MENTIONING the literal string in prose, never by honest test code,
// because this repo's own BDD Test Style Contract
// (`skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md:170`) names BOTH
// idioms — "The first string-literal argument of `it()` / `test()` MUST
// describe business behavior" — and `it(` is the dominant one by ~8x.
// Measured 2026-09-16 (`grep -rho '\bit(' tests | wc -l`, same for `test(`):
// `it(` 3015 vs `test(` 372 across `tests/`; the three test files slice
// The gate was in fact passing on artifacts whose ONLY `test(` was prose —
// including this repo's own generated template `buildTestCases`
// (`src/services/evidence/evidence-generator.ts`), which literally reads
// "no new tests; behavior preserved" and satisfied the marker anyway.
// Both idioms are therefore accepted via `mustContainAny` — an existing
// field on this type, already used by PERF_BASELINE / AUDIT_SECURITY /
// MUT_REPORT — while `## Test cases` stays a hard `mustContain`.
// Do NOT "tighten" this back to a single idiom in `mustContain`: that
// restores exactly the pass-by-mentioning hole `headingMustContain` was
// introduced to close (see the field doc comment above), and no honest test
// file in this repo could then satisfy the gate.
export const UNIT_TESTS: ArtifactPrerequisite = {
  relativePath: 'qa/test-cases/<rid>.md',
  description: 'Unit test files for the implemented changes (enforces peaks-rd Gate B2)',
  mustContain: ['## Test cases'],
  mustContainAny: ['test(', 'it(']
};

export const QA_INITIATED: ArtifactPrerequisite = {
  relativePath: 'qa/.initiated',
  description: 'QA skill must be invoked before RD handoff (run peaks request init --role qa)'
};
