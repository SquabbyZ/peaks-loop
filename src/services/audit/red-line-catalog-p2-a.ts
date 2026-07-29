/**
 * Red-line catalog — P2-a entries (Slice #6 L2.3).
 *
 * These 25 entries close the lint-style gap left by L2.1 (P0) and
 * L2.2 (P1). Per spec §5.4, P2-a targets 25-40 lint-style red-lines
 * for SKILL.md, references/, and openspec/. They are small,
 * pattern-based, and reference the existing CLI surface (no new
 * runtime dependencies).
 *
 * Enforcer functions live in `enforcers/lint-style-*.ts` and are
 * wired into the audit framework via the same `enforcerRef`
 * discovery path as the P0 / P1 entries.
 */
import type { RedLineCatalogEntry } from './red-line-catalog.js';

/** Theme A — Section structure (5 enforcers). The section-shape and
 *  frontmatter-shape enforcers both live in lint-style.ts (a single
 *  file groups the small per-skill pattern scans). */
const SECTION_HARD_CONTRACTS: RedLineCatalogEntry = {
  id: 'rl-section-hard-contracts-001',
  rule: 'Section structure: Hard contracts for browser/IO surface',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: ['hard contract', 'hard contracts for browser', 'hard contracts (blocking)', 'must be read before'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

const SECTION_MANDATORY_ARTIFACT: RedLineCatalogEntry = {
  id: 'rl-section-mandatory-artifact-001',
  rule: 'Section structure: Mandatory per-request artifact',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: ['mandatory per-request artifact', 'mandatory per-slice', 'mandatory .peaks/'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

const SECTION_DEFAULT_RUNBOOK: RedLineCatalogEntry = {
  id: 'rl-section-default-runbook-001',
  rule: 'Section structure: Default runbook pointer',
  markers: ['MANDATORY'],
  phrases: ['default runbook', 'runbook is in the references', 'full runbook', '## Default runbook'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

const SECTION_GATE_INDEX: RedLineCatalogEntry = {
  id: 'rl-section-gate-index-001',
  rule: 'Section structure: Gate index',
  markers: ['MANDATORY'],
  phrases: ['gate index', 'rd gate index', 'qa gate index', 'cli-backed gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

const SECTION_NAMING_AXIOM: RedLineCatalogEntry = {
  id: 'rl-section-naming-axiom-001',
  rule: 'Section structure: Two-axis naming axiom',
  markers: ['MANDATORY'],
  phrases: ['two-axis naming', 'change-id', 'session-id', 'two orthogonal axes'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

/** Theme A wireframe — the "ASCII wireframe" hint from spec §5.4
 *  line 647. The section-order enforcer in lint-style.ts checks
 *  that the canonical sections appear in the documented order. */
const SECTION_ORDER_WIREFRAME: RedLineCatalogEntry = {
  id: 'rl-section-order-wireframe-001',
  rule: 'Section structure: ASCII wireframe — sections in canonical order',
  markers: ['MANDATORY'],
  phrases: ['wireframe', 'section order', 'canonical order', 'ascii wireframe'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

/** Theme B — Frontmatter shape (3 enforcers). Grouped with Theme A
 *  in lint-style.ts; the loadStrategy check is a helper
 *  `lintReferenceLoadStrategy` that takes the references dir. */
const FRONTMATTER_PARSEABLE: RedLineCatalogEntry = {
  id: 'rl-frontmatter-skills-md-001',
  rule: 'Frontmatter shape: skills_md parseable frontmatter',
  markers: ['MANDATORY'],
  phrases: ['frontmatter', 'parseable', 'name: peaks-', 'description:'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

const FRONTMATTER_REFERENCES_LOAD_STRATEGY: RedLineCatalogEntry = {
  id: 'rl-frontmatter-references-load-strategy-001',
  rule: 'Frontmatter shape: references loadStrategy declared',
  markers: ['MANDATORY'],
  phrases: ['loadstrategy', 'load-strategy', 'always | on-demand'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

const FRONTMATTER_APPLICABLE_TASK_LEVELS: RedLineCatalogEntry = {
  id: 'rl-frontmatter-applicable-task-levels-001',
  rule: 'Frontmatter shape: skill applicable task levels',
  markers: ['MANDATORY'],
  phrases: ['applicabletasklevels', 'task levels invoke', 'applies to'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts',
};

/** Theme C — Output style (3 enforcers) */
const OUTPUT_STYLE_STATUS_HEADER: RedLineCatalogEntry = {
  id: 'rl-output-style-status-header-001',
  rule: 'Output style: Peaks-Loop status header on every response',
  markers: ['MANDATORY'],
  phrases: ['peaks-loop skill:', 'peaks-loop gate:', 'peaks-loop next:', 'status header'],
  enforcerRef: 'src/services/audit/enforcers/lint-output-style.ts',
};

const OUTPUT_STYLE_NO_FLUFF: RedLineCatalogEntry = {
  id: 'rl-output-style-no-fluff-001',
  rule: 'Output style: no greeting / persona fluff in SKILL.md',
  markers: ['MUST NOT'],
  phrases: ['你好,', '你好!', 'hello, i am', 'i am a', '作为一个', '我是'],
  enforcerRef: 'src/services/audit/enforcers/lint-output-style.ts',
};

const OUTPUT_STYLE_NO_CLOSING_PROMPT: RedLineCatalogEntry = {
  id: 'rl-output-style-no-closing-prompt-001',
  rule: 'Output style: no closing-prompt flattery',
  markers: ['MUST NOT'],
  phrases: ['let me know if', '如有任何需要', '如有需要', 'feel free to ask', 'do not hesitate'],
  enforcerRef: 'src/services/audit/enforcers/lint-output-style.ts',
};

/** Theme D — CLI-back gaps (4 enforcers) */
const CLI_BACK_MANDATORY_TEXT: RedLineCatalogEntry = {
  id: 'rl-cli-back-mandatory-text-001',
  rule: 'CLI-back: MANDATORY text has peaks * enforcer in the surrounding ±2 lines',
  markers: ['MANDATORY'],
  phrases: ['mandatory', 'mandatory peaks', 'cli-enforced-by', 'enforced by peaks'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts',
};

const CLI_BACK_NO_ORPHAN_BLOCKING: RedLineCatalogEntry = {
  id: 'rl-cli-back-no-orphan-blocking-001',
  rule: 'CLI-back: no orphan BLOCKING marker without a peaks * enforcer',
  markers: ['BLOCKING'],
  phrases: ['blocking', 'blocking peaks', 'blocking gate'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts',
};

const CLI_BACK_NO_ORPHAN_MUST_NOT: RedLineCatalogEntry = {
  id: 'rl-cli-back-no-orphan-must-not-001',
  rule: 'CLI-back: no orphan MUST NOT marker without a peaks * enforcer',
  markers: ['MUST NOT'],
  phrases: ['must not', 'must not peaks', 'must not be'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts',
};

const CLI_BACK_PROSE_ONLY_THRESHOLD: RedLineCatalogEntry = {
  id: 'rl-cli-back-prose-only-threshold-001',
  rule: 'CLI-back: prose-only ratio must stay ≤ 5%',
  markers: ['MANDATORY'],
  phrases: ['prose-only', 'prose only', 'prose-only ratio', 'prose-only threshold'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts',
};

/** Theme E — Reference integrity (4 enforcers) */
const REF_PATH_RESOLVES: RedLineCatalogEntry = {
  id: 'rl-ref-path-resolves-001',
  rule: 'Reference integrity: every references/<file>.md link resolves',
  markers: ['MANDATORY'],
  phrases: ['see references/', 'see `references/', 'see the references file', '→ see'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts',
};

const REF_NO_BROKEN_MKDIR: RedLineCatalogEntry = {
  id: 'rl-ref-no-broken-mkdir-001',
  rule: 'Reference integrity: no `mkdir -p` outside the project root',
  markers: ['MUST NOT'],
  phrases: ['mkdir -p', 'mkdir -p /', 'mkdir outside', 'mkdir the'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts',
};

const REF_NO_PWD_SYMLINK_JUMPS: RedLineCatalogEntry = {
  id: 'rl-ref-no-pwd-symlink-jumps-001',
  rule: 'Reference integrity: no `cd ..` chain jumping outside the project',
  markers: ['MUST NOT'],
  phrases: ['cd ..', 'cd ../..', 'cd ../../..', 'cd outside the project'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts',
};

const REF_NO_RELATIVE_ARCHIVE_PATHS: RedLineCatalogEntry = {
  id: 'rl-ref-no-relative-archive-paths-001',
  rule: 'Reference integrity: no `cp`/`mv`/`ln` to absolute /tmp paths',
  markers: ['MUST NOT'],
  phrases: ['cp /tmp', 'mv /tmp', 'ln /tmp', 'cp -r /tmp', 'do not use /tmp'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts',
};

/** Theme F — Workflow-bound shape (4 enforcers) */
const OPENSPEC_PROPOSAL_HAS_AC_BULLETS: RedLineCatalogEntry = {
  id: 'rl-openspec-proposal-has-acceptance-bullets-001',
  rule: 'Workflow: openspec proposal has non-empty Acceptance Criteria bullets',
  markers: ['MANDATORY'],
  phrases: ['acceptance criteria', 'a1 —', 'a2 —', '## acceptance criteria'],
  enforcerRef: 'src/services/audit/enforcers/lint-workflow-shape.ts',
};

const OPENSPEC_PROPOSAL_HAS_SPEC_CHANGES: RedLineCatalogEntry = {
  id: 'rl-openspec-proposal-has-spec-changes-001',
  rule: 'Workflow: openspec proposal has Spec reference (canonical) link',
  markers: ['MANDATORY'],
  phrases: ['spec reference (canonical)', 'spec reference', 'see the spec'],
  enforcerRef: 'src/services/audit/enforcers/lint-workflow-shape.ts',
};

// (Removed in v2.11.0 Group A: TECH_DOC_PRESENCE_PRE_RD catalog entry —
// the enforcer function it pointed to (lintTechDocPresenceShape in
// lint-workflow-shape.ts) was removed in the same slice.)

const PEAKS_DOCTOR_SKILL_ACKNOWLEDGED: RedLineCatalogEntry = {
  id: 'rl-peaks-doctor-skill-acknowledged-001',
  rule: 'Workflow: skill that writes a request artifact acknowledges peaks doctor',
  markers: ['MANDATORY'],
  phrases: ['peaks doctor', 'peaks-doctor', 'doctor scan', 'doctor route'],
  enforcerRef: 'src/services/audit/enforcers/lint-workflow-shape.ts',
};

/** Theme G — Catalog governance (2 enforcers). The catalog-size
 *  enforcer was already planned; the prose-only-ratio enforcer is
 *  the partner check that flags when the catalog has too many
 *  prose-only entries (i.e. when CLI-back coverage is regressing). */
const CATALOG_TOTAL_LE_45: RedLineCatalogEntry = {
  id: 'rl-catalog-total-001',
  rule: 'Catalog governance: catalog size must grow to ≥ 40 (L2.3 P2-a target)',
  markers: ['MANDATORY'],
  phrases: ['total red lines', 'totalredlines', 'catalog size', 'catalog grows'],
  enforcerRef: 'src/services/audit/enforcers/lint-catalog-governance.ts',
};

const CATALOG_PROSE_ONLY_RATIO: RedLineCatalogEntry = {
  id: 'rl-catalog-prose-only-ratio-001',
  rule: 'Catalog governance: prose-only ratio must stay ≤ 5% (per §10.2 L2 acceptance)',
  markers: ['MANDATORY'],
  phrases: ['prose-only ratio', 'prose-only threshold', 'prose-only ≤ 5%', 'prose-only < 10%'],
  enforcerRef: 'src/services/audit/enforcers/lint-catalog-governance.ts',
};

const SKILL_PRESENCE_MANDATORY: RedLineCatalogEntry = {
  id: 'rl-skill-presence-mandatory-001',
  rule: 'peaks-* bee SKILL.md must declare `## Skill presence (MANDATORY first action)` heading + body',
  markers: ['MANDATORY'],
  phrases: ['skill presence (mandatory first action)', 'skill presence ( first action', 'immediately run:'],
  enforcerRef: 'src/services/audit/enforcers/lint-skill-presence-mandatory.ts',
};

const PRD_SOURCE_SNAPSHOT_PLACEMENT: RedLineCatalogEntry = {
  id: 'rl-prd-source-snapshot-placement-001',
  rule: 'peaks-prd SKILL.md must declare `## Document snapshot placement (BLOCKING)` heading + Prohibited paths + .peaks/_runtime/<session-id>/prd/source/ path',
  markers: ['BLOCKING'],
  phrases: ['document snapshot placement', 'prohibited paths', 'prd/source/'],
  enforcerRef: 'src/services/audit/enforcers/lint-prd-source-snapshot.ts',
};

const PRD_ARTIFACT_HANDOFF: RedLineCatalogEntry = {
  id: 'rl-prd-artifact-handoff-001',
  rule: 'peaks-prd SKILL.md must declare the artifact handoff contract (Preserved behavior + step 5.5 + Transition verification gates)',
  markers: ['BLOCKING'],
  phrases: ['preserved behavior', '5.5 — write the immutable handoff', 'transition verification gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-prd-artifact-handoff.ts',
};

const RD_HANDOFF_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-rd-handoff-contract-001',
  rule: 'peaks-rd SKILL.md must declare the QA-handoff BLOCKING contract (tech-doc + perf-baseline)',
  markers: ['BLOCKING'],
  phrases: ['do not hand off to qa without', 'tech-doc', 'perf-baseline'],
  enforcerRef: 'src/services/audit/enforcers/lint-rd-handoff-coverage.ts',
};

const RD_COVERAGE_DISCIPLINE: RedLineCatalogEntry = {
  id: 'rl-rd-coverage-discipline-001',
  rule: 'peaks-rd SKILL.md must declare the coverage discipline (100% target + no-padding rule)',
  markers: ['MANDATORY'],
  phrases: ['100% coverage target on testable files', 'must not write coverage-padding tests'],
  enforcerRef: 'src/services/audit/enforcers/lint-rd-handoff-coverage.ts',
};

const QA_GATEGUARD_PREFLIGHT: RedLineCatalogEntry = {
  id: 'rl-qa-gateguard-preflight-001',
  rule: 'peaks-qa SKILL.md must declare the gateguard-fact-force pre-flight BLOCKING section',
  markers: ['BLOCKING'],
  phrases: ['gateguard-fact-force conflict', 'pre-flight'],
  enforcerRef: 'src/services/audit/enforcers/lint-qa-gateguard-and-runtime.ts',
};

const QA_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-qa-runtime-contract-001',
  rule: 'peaks-qa SKILL.md must declare the runtime contract (transition gates + Playwright MCP fallback + OpenSpec integration)',
  markers: ['BLOCKING', 'MANDATORY'],
  phrases: ['transition verification gates', 'playwright mcp is unavailable', 'when the target repository has openspec/'],
  enforcerRef: 'src/services/audit/enforcers/lint-qa-gateguard-and-runtime.ts',
};

const PEAKS_UI_SUPERPOWERS_CHAIN: RedLineCatalogEntry = {
  id: 'rl-peaks-ui-superpowers-chain-001',
  rule: 'peaks-ui SKILL.md must declare the superpowers chain refusal + reference-material contract',
  markers: ['BLOCKING'],
  phrases: ['MUST NOT follow the superpowers chain', 'superpowers skills remain available as reference material'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts',
};

const PEAKS_UI_INVOLVEMENT: RedLineCatalogEntry = {
  id: 'rl-peaks-ui-involvement-001',
  rule: 'peaks-ui SKILL.md must declare the UI-involvement identification block',
  markers: ['MANDATORY'],
  phrases: ['identify ui involvement'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts',
};

const PEAKS_TXT_UPSTREAM: RedLineCatalogEntry = {
  id: 'rl-peaks-txt-upstream-001',
  rule: 'peaks-txt SKILL.md must declare the upstream-inspection + memory-block contract',
  markers: ['MANDATORY'],
  phrases: ['inspect upstream skill content before applying any method', 'memory block embedding rule'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts',
};

const PEAKS_PERF_AUDIT_SCOPE: RedLineCatalogEntry = {
  id: 'rl-peaks-perf-audit-scope-001',
  rule: 'peaks-perf-audit SKILL.md must declare the non-perf MUST NOT invoke clause',
  markers: ['MUST NOT'],
  phrases: ['MUST NOT invoke this skill', 'non-perf'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-ui-sc-txt-runtime.ts',
};

const PEAKS_RD_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-peaks-rd-runtime-contract-001',
  rule: 'peaks-rd SKILL.md must declare the runtime contract (OpenSpec usage + Frontend project generation)',
  markers: ['BLOCKING', 'MUST NOT'],
  phrases: ['use openspec when the', 'rd work creates a frontend application'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts',
};

const PEAKS_UI_TRANSITION_GATES: RedLineCatalogEntry = {
  id: 'rl-peaks-ui-transition-gates-001',
  rule: 'peaks-ui SKILL.md must declare the Transition verification gates section',
  markers: ['MANDATORY'],
  phrases: ['transition verification gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts',
};

const PEAKS_SC_TRANSITION_GATES: RedLineCatalogEntry = {
  id: 'rl-peaks-sc-transition-gates-001',
  rule: 'peaks-sc SKILL.md must declare the Transition verification gates section',
  markers: ['MANDATORY'],
  phrases: ['transition verification gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts',
};

const PEAKS_TXT_RUNTIME_CONTRACT: RedLineCatalogEntry = {
  id: 'rl-peaks-txt-runtime-contract-001',
  rule: 'peaks-txt SKILL.md must declare the runtime contract (Transition verification gates + Memory block embedding rule)',
  markers: ['MANDATORY'],
  phrases: ['transition verification gates', 'memory block embedding rule'],
  enforcerRef: 'src/services/audit/enforcers/lint-bee-runtime-contract.ts',
};

const PEAKS_CODE_RUNTIME_CONTRACT: RedLineCatalogEntry = {
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
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-code-runtime.ts',
};

/**
 * The 25 P2-a entries, in stable display order. Appending to a single
 * readonly array keeps the catalog growable: future slices (L2.4, L3.x)
 * can spread this list into RED_LINE_CATALOG and add their own without
 * touching this file.
 */
const PEAKS_AUDIT_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-audit-runtime-001',
  rule: 'peaks-audit SKILL.md must declare the audit-runtime contract (machine-readable audit log, six-dimension audit, author identity)',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: ['audit log is machine-readable', 'six dimensions', '6 dimensions', 'author identity.*local gitconfig'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};

const PEAKS_CONTENT_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-content-runtime-001',
  rule: 'peaks-content SKILL.md must declare the content-runtime contract (what this skill do, failure mode, each red line is written)',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: ['what this skill do', 'failure mode', 'each red line is written'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};

const PEAKS_IDE_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-ide-runtime-001',
  rule: 'peaks-ide SKILL.md must declare the ide-runtime contract (for any consumer, what this skill do, general workflow-gating tool)',
  markers: ['MANDATORY'],
  phrases: ['for any consumer of the v2 envelope', 'what this skill do', 'general workflow-gating tool'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};

const PEAKS_DOCTOR_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-doctor-runtime-001',
  rule: 'peaks-doctor SKILL.md must declare the doctor-orchestrator marker',
  markers: ['MANDATORY'],
  phrases: ['peaks-loop doctor is a doctor orchestrator'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};

const PEAKS_ISSUE_FIX_ORCHESTRATOR_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-issue-fix-orchestrator-runtime-001',
  rule: 'peaks-issue-fix-orchestrator SKILL.md must declare the deviation note + autonomous work proceed markers',
  markers: ['MANDATORY'],
  phrases: ['deviation note', 'autonomous work proceed'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};

const PEAKS_SOP_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-sop-runtime-001',
  rule: 'peaks-sop SKILL.md must declare the sop-runtime contract (each red line below, sop lint reports findings)',
  markers: ['MANDATORY'],
  phrases: ['each red line below is written', 'sop lint reports findings'],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};

const PEAKS_SLICE_DECOMPOSE_RUNTIME: RedLineCatalogEntry = {
  id: 'rl-peaks-slice-decompose-runtime-001',
  rule: 'peaks-slice-decompose SKILL.md must declare the slice-decompose contract (what this skill do, failure mode)',
  markers: ['MANDATORY'],
  phrases: ['what this skill do', 'failure mode ('],
  enforcerRef: 'src/services/audit/enforcers/lint-peaks-skill-runtime.ts',
};
export const RED_LINE_CATALOG_P2_A: readonly RedLineCatalogEntry[] = [
  SECTION_HARD_CONTRACTS,
  SECTION_MANDATORY_ARTIFACT,
  SECTION_DEFAULT_RUNBOOK,
  SECTION_GATE_INDEX,
  SECTION_NAMING_AXIOM,
  SECTION_ORDER_WIREFRAME,
  FRONTMATTER_PARSEABLE,
  FRONTMATTER_REFERENCES_LOAD_STRATEGY,
  FRONTMATTER_APPLICABLE_TASK_LEVELS,
  OUTPUT_STYLE_STATUS_HEADER,
  OUTPUT_STYLE_NO_FLUFF,
  OUTPUT_STYLE_NO_CLOSING_PROMPT,
  CLI_BACK_MANDATORY_TEXT,
  CLI_BACK_NO_ORPHAN_BLOCKING,
  CLI_BACK_NO_ORPHAN_MUST_NOT,
  CLI_BACK_PROSE_ONLY_THRESHOLD,
  REF_PATH_RESOLVES,
  REF_NO_BROKEN_MKDIR,
  REF_NO_PWD_SYMLINK_JUMPS,
  REF_NO_RELATIVE_ARCHIVE_PATHS,
  OPENSPEC_PROPOSAL_HAS_AC_BULLETS,
  OPENSPEC_PROPOSAL_HAS_SPEC_CHANGES,
  // (Removed in v2.11.0 Group A: TECH_DOC_PRESENCE_PRE_RD)
  PEAKS_DOCTOR_SKILL_ACKNOWLEDGED,
  CATALOG_TOTAL_LE_45,
  CATALOG_PROSE_ONLY_RATIO,
  // Slice 2026-07-29-rid-prose-only-sweep-001: close the first
  // discovered prose-only line. peaks-prd-skill-md-56 was a
  // "MANDATORY first action" marker on a "Skill presence" heading
  // in skills/bee/* SKILL.md. The MANDATORY marker + the heading
  // are now enforced by lint-skill-presence-mandatory.ts.
  SKILL_PRESENCE_MANDATORY,
  // Slice 2026-07-29-rid-prose-only-sweep-002: close two more
  // peaks-prd discovered lines (md-292, md-301) with one
  // enforcer. The enforcer pattern-scans the source-snapshot
  // placement guidance + prohibited-paths list.
  PRD_SOURCE_SNAPSHOT_PLACEMENT,
  // Slice 2026-07-29-rid-prose-only-sweep-004: close three
  // peaks-prd discovered lines (md-99 / md-166 / md-193) with
  // one enforcer. The handoff contract requires preserved
  // behavior, step 5.5, and transition verification gates.
  PRD_ARTIFACT_HANDOFF,
  // Slice 2026-07-29-rid-prose-only-sweep-005: close three
  // peaks-rd discovered lines (md-121 / md-127 / md-162) with
  // two enforcers (handoff + coverage discipline).
  RD_HANDOFF_CONTRACT,
  RD_COVERAGE_DISCIPLINE,
  // Slice 2026-07-29-rid-prose-only-sweep-006: close four
  // peaks-qa discovered lines (md-26 gateguard + md-113
  // transition gates + md-165 playwright + md-201 openspec).
  QA_GATEGUARD_PREFLIGHT,
  QA_RUNTIME_CONTRACT,
  // Slice 2026-07-29-rid-prose-only-sweep-007: close six more
  // discovered lines (3 peaks-ui + 2 peaks-txt + 1
  // peaks-perf-audit) with four enforcers.
  PEAKS_UI_SUPERPOWERS_CHAIN,
  PEAKS_UI_INVOLVEMENT,
  PEAKS_TXT_UPSTREAM,
  PEAKS_PERF_AUDIT_SCOPE,
  // Slice 2026-07-29-rid-prose-only-sweep-008: close six more
  // discovered lines (2 peaks-rd + 1 peaks-sc + 1 peaks-txt +
  // 1 peaks-ui + 1 peaks-ui) with four enforcers in
  // lint-bee-runtime-contract.ts.
  PEAKS_RD_RUNTIME_CONTRACT,
  PEAKS_UI_TRANSITION_GATES,
  PEAKS_SC_TRANSITION_GATES,
  PEAKS_TXT_RUNTIME_CONTRACT,
  // Slice 2026-07-29-rid-prose-only-sweep-009: close 13 of the
  // remaining 33 discovered lines (all peaks-code) with one
  // enforcer that checks the peaks-code runbook section-marker
  // skeleton. Single catalog entry; multi-marker enforcer.
  PEAKS_CODE_RUNTIME_CONTRACT,
  // Slice 2026-07-29-rid-prose-only-sweep-010: 8 of the
  // remaining 22 discovered lines (peaks-audit x4,
  // peaks-content x2, peaks-ide x2) closed with 6 enforcers
  // in one file.
  PEAKS_AUDIT_RUNTIME,
  PEAKS_CONTENT_RUNTIME,
  PEAKS_IDE_RUNTIME,
  PEAKS_DOCTOR_RUNTIME,
  PEAKS_ISSUE_FIX_ORCHESTRATOR_RUNTIME,
  PEAKS_SOP_RUNTIME,
  PEAKS_SLICE_DECOMPOSE_RUNTIME,
];

