/**
 * P2-a red lines that bind a specific peaks-* bee: the prose-only-sweep
 * entries (slice 2026-07-29-rid-prose-only-sweep-001 … -010) that make a
 * SKILL.md declare its own runtime contract. Hoisted verbatim out of
 * `red-line-catalog-p2-a.ts` by the b1 file-size campaign — no `id`, `rule`,
 * `markers`, `phrases` or `enforcerRef` value was edited, and the names are
 * still consumed in the same order by `RED_LINE_CATALOG_P2_A`, which stays
 * exported from the original module.
 */
import type { RedLineCatalogEntry } from './red-line-catalog.js';

export const SKILL_PRESENCE_MANDATORY: RedLineCatalogEntry = {
  id: 'rl-skill-presence-mandatory-001',
  rule: 'peaks-* bee SKILL.md must declare `## Skill presence (MANDATORY first action)` heading + body',
  markers: ['MANDATORY'],
  phrases: [
    'skill presence (mandatory first action)',
    'skill presence ( first action',
    'immediately run:'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-skill-presence-mandatory.ts'
};

export const PRD_SOURCE_SNAPSHOT_PLACEMENT: RedLineCatalogEntry = {
  id: 'rl-prd-source-snapshot-placement-001',
  rule: 'peaks-prd SKILL.md must declare `## Document snapshot placement (BLOCKING)` heading + Prohibited paths + .peaks/_runtime/<session-id>/prd/source/ path',
  markers: ['BLOCKING'],
  phrases: ['document snapshot placement', 'prohibited paths', 'prd/source/'],
  enforcerRef: 'src/services/audit/enforcers/lint-prd-source-snapshot.ts'
};

export const PRD_ARTIFACT_HANDOFF: RedLineCatalogEntry = {
  id: 'rl-prd-artifact-handoff-001',
  rule: 'peaks-prd SKILL.md must declare the artifact handoff contract (Preserved behavior + step 5.5 + Transition verification gates)',
  markers: ['BLOCKING'],
  phrases: [
    'preserved behavior',
    '5.5 — write the immutable handoff',
    'transition verification gates'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-prd-artifact-handoff.ts'
};

export const RD_HANDOFF_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-rd-handoff-contract-001',
  rule: 'peaks-rd must not hand off to QA without a non-empty RD artifact under rd/requests/',
  markers: ['BLOCKING'],
  phrases: ['do not hand off to qa without', 'tech-doc', 'perf-baseline'],
  enforcerRef: 'src/services/audit/enforcers/lint-rd-handoff-coverage.ts'
};

export const RD_COVERAGE_DISCIPLINE: RedLineCatalogEntry = {
  id: 'rl-rd-coverage-discipline-001',
  rule: 'peaks-rd SKILL.md must declare the coverage discipline (100% target + no-padding rule)',
  markers: ['MANDATORY'],
  phrases: ['100% coverage target on testable files', 'must not write coverage-padding tests'],
  enforcerRef: 'src/services/audit/enforcers/lint-rd-handoff-coverage.ts'
};

export const QA_GATEGUARD_PREFLIGHT: RedLineCatalogEntry = {
  id: 'rl-qa-gateguard-preflight-001',
  rule: 'peaks-qa SKILL.md must declare the gateguard-fact-force pre-flight BLOCKING section',
  markers: ['BLOCKING'],
  phrases: ['gateguard-fact-force conflict', 'pre-flight'],
  enforcerRef: 'src/services/audit/enforcers/lint-qa-gateguard-and-runtime.ts'
};

export const QA_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-qa-runtime-contract-001',
  rule: 'peaks-qa SKILL.md must declare the runtime contract (transition gates + Playwright MCP fallback + OpenSpec integration)',
  markers: ['BLOCKING', 'MANDATORY'],
  phrases: [
    'transition verification gates',
    'playwright mcp is unavailable',
    'when the target repository has openspec/'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-qa-gateguard-and-runtime.ts'
};

export const PEAKS_UI_SUPERPOWERS_CHAIN: RedLineCatalogEntry = {
  id: 'rl-peaks-ui-superpowers-chain-001',
  rule: 'peaks-ui SKILL.md must declare the superpowers chain refusal + reference-material contract',
  markers: ['BLOCKING'],
  phrases: [
    'MUST NOT follow the superpowers chain',
    'superpowers skills remain available as reference material'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts'
};

export const PEAKS_UI_INVOLVEMENT: RedLineCatalogEntry = {
  id: 'rl-peaks-ui-involvement-001',
  rule: 'peaks-ui SKILL.md must declare the UI-involvement identification block',
  markers: ['MANDATORY'],
  phrases: ['identify ui involvement'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts'
};

export const PEAKS_TXT_UPSTREAM: RedLineCatalogEntry = {
  id: 'rl-peaks-txt-upstream-001',
  rule: 'peaks-txt SKILL.md must declare the upstream-inspection + memory-block contract',
  markers: ['MANDATORY'],
  phrases: [
    'inspect upstream skill content before applying any method',
    'memory block embedding rule'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts'
};

export const PEAKS_PERF_AUDIT_SCOPE: RedLineCatalogEntry = {
  id: 'rl-peaks-perf-audit-scope-001',
  rule: 'peaks-perf-audit SKILL.md must declare the non-perf MUST NOT invoke clause',
  markers: ['MUST NOT'],
  phrases: ['MUST NOT invoke this skill', 'non-perf'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts'
};

export const PEAKS_RD_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-peaks-rd-runtime-contract-001',
  rule: 'peaks-rd SKILL.md must declare the runtime contract (OpenSpec usage + Frontend project generation)',
  markers: ['BLOCKING', 'MUST NOT'],
  phrases: ['use openspec when the', 'rd work creates a frontend application'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts'
};

export const PEAKS_UI_TRANSITION_GATES: RedLineCatalogEntry = {
  id: 'rl-peaks-ui-transition-gates-001',
  rule: 'peaks-ui SKILL.md must declare the Transition verification gates section',
  markers: ['MANDATORY'],
  phrases: ['transition verification gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts'
};

export const PEAKS_SC_TRANSITION_GATES: RedLineCatalogEntry = {
  id: 'rl-peaks-sc-transition-gates-001',
  rule: 'peaks-sc SKILL.md must declare the Transition verification gates section',
  markers: ['MANDATORY'],
  phrases: ['transition verification gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts'
};

export const PEAKS_TXT_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-peaks-txt-runtime-contract-001',
  rule: 'peaks-txt SKILL.md must declare the runtime contract (Transition verification gates + Memory block embedding rule)',
  markers: ['MANDATORY'],
  phrases: ['transition verification gates', 'memory block embedding rule'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts'
};

export const PEAKS_CODE_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-peaks-code-runtime-contract-001',
  rule: 'peaks-code SKILL.md must declare the runbook section-marker skeleton (Scope, no auto-compact, superpowers bridge, npm-contract, startup sequence, step 0.8 job-shape, local intermediate artifact workspace, pre-rd project scan checklist, step 11 memory sediment, --enforce-job-mode v3.1.2).',
  markers: ['BLOCKING', 'MANDATORY'],
  phrases: [
    'scope (rl-8',
    'no auto-compact prose ban',
    'peaks-loop superpowers 协作边界',
    'npm-contract boundary',
    'peaks-loop startup sequence',
    'step 0.8',
    'peaks-loop local intermediate artifact workspace',
    'peaks-loop pre-rd project scan checklist',
    'step 11',
    'enforce-job-mode (v3.1.2)'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-code-runtime.ts'
};

/**
 * The 25 P2-a entries, in stable display order. Appending to a single
 * readonly array keeps the catalog growable: future slices (L2.4, L3.x)
 * can spread this list into RED_LINE_CATALOG and add their own without
 * touching this file.
 */
export const PEAKS_AUDIT_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-audit-runtime-001',
  rule: 'peaks-audit SKILL.md must declare the audit-runtime contract (machine-readable audit log, six-dimension audit, author identity)',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: [
    'audit log is machine-readable',
    'six dimensions',
    '6 dimensions',
    'author identity.*local gitconfig'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};

export const PEAKS_CONTENT_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-content-runtime-001',
  rule: 'peaks-content SKILL.md must declare the content-runtime contract (what this skill do, failure mode, each red line is written)',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: ['what this skill do', 'failure mode', 'each red line is written'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};

export const PEAKS_IDE_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-ide-runtime-001',
  rule: 'peaks-ide SKILL.md must declare the ide-runtime contract (for any consumer, what this skill do, general workflow-gating tool)',
  markers: ['MANDATORY'],
  phrases: [
    'for any consumer of the v2 envelope',
    'what this skill do',
    'general workflow-gating tool'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};

export const PEAKS_DOCTOR_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-doctor-runtime-001',
  rule: 'peaks-doctor SKILL.md must declare the doctor-orchestrator marker',
  markers: ['MANDATORY'],
  phrases: ['peaks-loop doctor is a doctor orchestrator'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};

export const PEAKS_ISSUE_FIX_ORCHESTRATOR_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-issue-fix-orchestrator-runtime-001',
  rule: 'peaks-issue-fix-orchestrator SKILL.md must declare the deviation note + autonomous work proceed markers',
  markers: ['MANDATORY'],
  phrases: ['deviation note', 'autonomous work proceed'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};

export const PEAKS_SOP_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-sop-runtime-001',
  rule: 'peaks-sop SKILL.md must declare the sop-runtime contract (each red line below, sop lint reports findings)',
  markers: ['MANDATORY'],
  phrases: ['each red line below is written', 'sop lint reports findings'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};

export const PEAKS_SLICE_DECOMPOSE_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-slice-decompose-runtime-001',
  rule: 'peaks-slice-decompose SKILL.md must declare the slice-decompose contract (what this skill do, failure mode)',
  markers: ['MANDATORY'],
  phrases: ['what this skill do', 'failure mode ('],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts'
};
