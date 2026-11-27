// The per-request-type prerequisite tables the gate reads.
//
// WHY THIS MODULE EXISTS. `artifact-prerequisites.ts` was at the 300-line
// file-size cap and `fileSizeExcessLines` is a ratchet that may only go DOWN.
// Adding the design-fidelity row to the two handoff arrays needed headroom, so
// the tables left that module. The table bodies were moved VERBATIM; the only
// addition is `DESIGN_FIDELITY` beside `DESIGN_CONFORMANCE` in the feature and
// bugfix handoff arrays.
//
// `PREREQUISITES_BY_TYPE` is defined here and re-exported from
// `artifact-prerequisites.ts`, so every existing importer keeps its import site.
import { DESIGN_CONFORMANCE } from './design-conformance-prerequisite.js';
import { DESIGN_FIDELITY } from './design-fidelity-prerequisite.js';
import {
  AUDIT_PERF,
  AUDIT_REQUIRES_HANDOFF,
  AUDIT_SECURITY,
  BUG_ANALYSIS,
  CODE_REVIEW,
  KARPATHY_REVIEW,
  MUT_REPORT,
  PRD_CONTENT,
  QA_INITIATED,
  SECURITY_REVIEW,
  TEST_CASES,
  TEST_REPORT,
  THIRD_PARTY_REVIEW,
  UNIT_TESTS
} from './prerequisite-fragments.js';
import type { ArtifactPrerequisite, RequestType } from './artifact-prerequisites.js';
import type { RequestArtifactRole, RequestArtifactState } from './request-artifact-service.js';

type TransitionKey = `${RequestArtifactRole}:${RequestArtifactState}`;
type PrerequisiteTable = Partial<Record<TransitionKey, ReadonlyArray<ArtifactPrerequisite>>>;

// v2.11.0 D1/D4 trim (Group C Tier 6): no qa:verdict-issued table holds
// qa/security-findings.md or qa/performance-findings.md — peaks-rd's audit
// fan-out owns that evidence. Both constants below are kept for back-compat
// only: `evidence-generator.ts` writes the scoped names, not these.
//
// v2.12.0 Group B Tier 5: at rd:qa-handoff, the v2.11.x security-review +
// perf-baseline slots are replaced by `AUDIT_SECURITY` + `AUDIT_PERF` (the
// new audit-skill outputs). The legacy `AUDIT_SECURITY_LEGACY` /
// `AUDIT_PERF_LEGACY` shims are kept in the same list so the 1-minor-
// release back-compat window still accepts the v2.11.x on-disk layout;
// both the new path (`audit/security.md`) and the legacy path
// (`rd/security-review.md`) satisfy the gate. The audit skills require
// `prd/handoff.md` (`AUDIT_REQUIRES_HANDOFF`).
//
// v2.13.1 Group A: add `MUT_REPORT` (peaks-mut Plan 2 output). The
// gate is the rd-side CLI hard block; CONFIG / DOCS / CHORE retain the
// legacy "no acceptance surface" exemption via MINIMAL_TABLE /
// CONFIG_TABLE.
const FEATURE_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:implemented': [],
  'rd:qa-handoff': [
    CODE_REVIEW,
    AUDIT_REQUIRES_HANDOFF,
    AUDIT_SECURITY,
    AUDIT_PERF,
    KARPATHY_REVIEW,
    THIRD_PARTY_REVIEW,
    MUT_REPORT,
    UNIT_TESTS,
    QA_INITIATED,
    DESIGN_CONFORMANCE,
    DESIGN_FIDELITY
  ],
  'qa:running': [TEST_CASES],
  'qa:verdict-issued': [TEST_CASES, TEST_REPORT]
};

// Bugfix: lighter planning artifact (bug-analysis instead of tech-doc), still requires code review + security review + regression test.
// Performance baseline: required for perf-shaped bugfixes (where the bug IS a
// perf regression). For non-perf bugfixes, RD writes the perf-baseline stub
// with "N/A — no perf surface" — Gate B9 still passes (mustContainAny hit),
// and the stub tells QA Gate A4 to skip the perf diff.
// v2.11.0 D1/D4: SECURITY_FINDINGS dropped from qa:verdict-issued (peaks-rd owns it).
// v2.12.0 Group B Tier 5: security-review + perf-baseline → AUDIT_SECURITY +
// AUDIT_PERF (with legacy shims for 1-minor-release back-compat).
// v2.13.1 Group A: add MUT_REPORT (same rd-side hard block rationale as FEATURE_TABLE).
const BUGFIX_TABLE: PrerequisiteTable = {
  'prd:handed-off': [PRD_CONTENT],
  'rd:implemented': [BUG_ANALYSIS],
  'rd:qa-handoff': [
    BUG_ANALYSIS,
    CODE_REVIEW,
    AUDIT_REQUIRES_HANDOFF,
    AUDIT_SECURITY,
    AUDIT_PERF,
    KARPATHY_REVIEW,
    THIRD_PARTY_REVIEW,
    MUT_REPORT,
    UNIT_TESTS,
    QA_INITIATED,
    DESIGN_CONFORMANCE,
    DESIGN_FIDELITY
  ],
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

export const PREREQUISITES_BY_TYPE: Record<RequestType, PrerequisiteTable> = {
  feature: FEATURE_TABLE,
  bugfix: BUGFIX_TABLE,
  refactor: REFACTOR_TABLE,
  docs: MINIMAL_TABLE,
  config: CONFIG_TABLE,
  chore: MINIMAL_TABLE
};
