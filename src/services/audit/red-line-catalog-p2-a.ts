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

import {
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
  PEAKS_DOCTOR_SKILL_ACKNOWLEDGED,
  CATALOG_TOTAL_LE_45,
  CATALOG_PROSE_ONLY_RATIO
} from './red-line-catalog-p2-a-lint-style.js';
import {
  SKILL_PRESENCE_MANDATORY,
  PRD_SOURCE_SNAPSHOT_PLACEMENT,
  PRD_ARTIFACT_HANDOFF,
  RD_HANDOFF_CONTRACT,
  RD_COVERAGE_DISCIPLINE,
  QA_GATEGUARD_PREFLIGHT,
  QA_RUNTIME_CONTRACT,
  PEAKS_UI_SUPERPOWERS_CHAIN,
  PEAKS_UI_INVOLVEMENT,
  PEAKS_TXT_UPSTREAM,
  PEAKS_PERF_AUDIT_SCOPE,
  PEAKS_RD_RUNTIME_CONTRACT,
  PEAKS_UI_TRANSITION_GATES,
  PEAKS_SC_TRANSITION_GATES,
  PEAKS_TXT_RUNTIME_CONTRACT,
  PEAKS_CODE_RUNTIME_CONTRACT,
  PEAKS_AUDIT_RUNTIME,
  PEAKS_CONTENT_RUNTIME,
  PEAKS_IDE_RUNTIME,
  PEAKS_DOCTOR_RUNTIME,
  PEAKS_ISSUE_FIX_ORCHESTRATOR_RUNTIME,
  PEAKS_SOP_RUNTIME,
  PEAKS_SLICE_DECOMPOSE_RUNTIME
} from './red-line-catalog-p2-a-bee-runtime.js';

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
  // discovered prose-only line. peaks-prd-skill-md-56 was a
  // "MANDATORY first action" marker on a "Skill presence" heading
  // in skills/bee/* SKILL.md. The MANDATORY marker + the heading
  // are now enforced by lint-skill-presence-mandatory.ts.
  SKILL_PRESENCE_MANDATORY,
  // peaks-prd discovered lines (md-292, md-301) with one
  // enforcer. The enforcer pattern-scans the source-snapshot
  // placement guidance + prohibited-paths list.
  PRD_SOURCE_SNAPSHOT_PLACEMENT,
  // peaks-prd discovered lines (md-99 / md-166 / md-193) with
  // one enforcer. The handoff contract requires preserved
  // behavior, step 5.5, and transition verification gates.
  PRD_ARTIFACT_HANDOFF,
  // peaks-rd discovered lines (md-121 / md-127 / md-162) with
  // two enforcers (handoff + coverage discipline).
  RD_HANDOFF_CONTRACT,
  RD_COVERAGE_DISCIPLINE,
  // peaks-qa discovered lines (md-26 gateguard + md-113
  // transition gates + md-165 playwright + md-201 openspec).
  QA_GATEGUARD_PREFLIGHT,
  QA_RUNTIME_CONTRACT,
  // discovered lines (3 peaks-ui + 2 peaks-txt + 1
  // peaks-perf-audit) with four enforcers.
  PEAKS_UI_SUPERPOWERS_CHAIN,
  PEAKS_UI_INVOLVEMENT,
  PEAKS_TXT_UPSTREAM,
  PEAKS_PERF_AUDIT_SCOPE,
  // discovered lines (2 peaks-rd + 1 peaks-sc + 1 peaks-txt +
  // 1 peaks-ui + 1 peaks-ui) with four enforcers in
  // lint-bee-runtime-contract.ts.
  PEAKS_RD_RUNTIME_CONTRACT,
  PEAKS_UI_TRANSITION_GATES,
  PEAKS_SC_TRANSITION_GATES,
  PEAKS_TXT_RUNTIME_CONTRACT,
  // remaining 33 discovered lines (all peaks-code) with one
  // enforcer that checks the peaks-code runbook section-marker
  // skeleton. Single catalog entry; multi-marker enforcer.
  PEAKS_CODE_RUNTIME_CONTRACT,
  // remaining 22 discovered lines (peaks-audit x4,
  // peaks-content x2, peaks-ide x2) closed with 6 enforcers
  // in one file.
  PEAKS_AUDIT_RUNTIME,
  PEAKS_CONTENT_RUNTIME,
  PEAKS_IDE_RUNTIME,
  PEAKS_DOCTOR_RUNTIME,
  PEAKS_ISSUE_FIX_ORCHESTRATOR_RUNTIME,
  PEAKS_SOP_RUNTIME,
  PEAKS_SLICE_DECOMPOSE_RUNTIME
];
