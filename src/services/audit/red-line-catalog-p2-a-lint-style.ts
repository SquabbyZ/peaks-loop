/**
 * P2-a red lines, Themes A-G (spec §5.4): section structure, frontmatter
 * shape, output style, CLI-back gaps, reference integrity, workflow-bound
 * shape and catalog governance. Hoisted verbatim out of
 * `red-line-catalog-p2-a.ts` by the b1 file-size campaign — no `id`, `rule`,
 * `markers`, `phrases` or `enforcerRef` value was edited, and the names are
 * still consumed in the same order by `RED_LINE_CATALOG_P2_A`, which stays
 * exported from the original module.
 */
import type { RedLineCatalogEntry } from './red-line-catalog.js';

/** Theme A — Section structure (5 enforcers). The section-shape and
 *  frontmatter-shape enforcers both live in lint-style.ts (a single
 *  file groups the small per-skill pattern scans). */
export const SECTION_HARD_CONTRACTS: RedLineCatalogEntry = {
  id: 'rl-section-hard-contracts-001',
  rule: 'Section structure: Hard contracts for browser/IO surface',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: [
    'hard contract',
    'hard contracts for browser',
    'hard contracts (blocking)',
    'must be read before'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

export const SECTION_MANDATORY_ARTIFACT: RedLineCatalogEntry = {
  id: 'rl-section-mandatory-artifact-001',
  rule: 'Section structure: Mandatory per-request artifact',
  markers: ['MANDATORY', 'BLOCKING'],
  phrases: ['mandatory per-request artifact', 'mandatory per-slice', 'mandatory .peaks/'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

export const SECTION_DEFAULT_RUNBOOK: RedLineCatalogEntry = {
  id: 'rl-section-default-runbook-001',
  rule: 'Section structure: Default runbook pointer',
  markers: ['MANDATORY'],
  phrases: [
    'default runbook',
    'runbook is in the references',
    'full runbook',
    '## Default runbook'
  ],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

export const SECTION_GATE_INDEX: RedLineCatalogEntry = {
  id: 'rl-section-gate-index-001',
  rule: 'Section structure: Gate index',
  markers: ['MANDATORY'],
  phrases: ['gate index', 'rd gate index', 'qa gate index', 'cli-backed gates'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

export const SECTION_NAMING_AXIOM: RedLineCatalogEntry = {
  id: 'rl-section-naming-axiom-001',
  rule: 'Section structure: Two-axis naming axiom',
  markers: ['MANDATORY'],
  phrases: ['two-axis naming', 'change-id', 'session-id', 'two orthogonal axes'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

/** Theme A wireframe — the "ASCII wireframe" hint from spec §5.4
 *  line 647. The section-order enforcer in lint-style.ts checks
 *  that the canonical sections appear in the documented order. */
export const SECTION_ORDER_WIREFRAME: RedLineCatalogEntry = {
  id: 'rl-section-order-wireframe-001',
  rule: 'Section structure: ASCII wireframe — sections in canonical order',
  markers: ['MANDATORY'],
  phrases: ['wireframe', 'section order', 'canonical order', 'ascii wireframe'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

/** Theme B — Frontmatter shape (3 enforcers). Grouped with Theme A
 *  in lint-style.ts; the loadStrategy check is a helper
 *  `lintReferenceLoadStrategy` that takes the references dir. */
export const FRONTMATTER_PARSEABLE: RedLineCatalogEntry = {
  id: 'rl-frontmatter-skills-md-001',
  rule: 'Frontmatter shape: skills_md parseable frontmatter',
  markers: ['MANDATORY'],
  phrases: ['frontmatter', 'parseable', 'name: peaks-', 'description:'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

export const FRONTMATTER_REFERENCES_LOAD_STRATEGY: RedLineCatalogEntry = {
  id: 'rl-frontmatter-references-load-strategy-001',
  rule: 'Frontmatter shape: references loadStrategy declared',
  markers: ['MANDATORY'],
  phrases: ['loadstrategy', 'load-strategy', 'always | on-demand'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

export const FRONTMATTER_APPLICABLE_TASK_LEVELS: RedLineCatalogEntry = {
  id: 'rl-frontmatter-applicable-task-levels-001',
  rule: 'Frontmatter shape: skill applicable task levels',
  markers: ['MANDATORY'],
  phrases: ['applicabletasklevels', 'task levels invoke', 'applies to'],
  enforcerRef: 'src/services/audit/enforcers/lint-style.ts'
};

/** Theme C — Output style (3 enforcers) */
export const OUTPUT_STYLE_STATUS_HEADER: RedLineCatalogEntry = {
  id: 'rl-output-style-status-header-001',
  rule: 'Output style: Peaks-Loop status header on every response',
  markers: ['MANDATORY'],
  phrases: ['peaks-loop skill:', 'peaks-loop gate:', 'peaks-loop next:', 'status header'],
  enforcerRef: 'src/services/audit/enforcers/lint-output-style.ts'
};

export const OUTPUT_STYLE_NO_FLUFF: RedLineCatalogEntry = {
  id: 'rl-output-style-no-fluff-001',
  rule: 'Output style: no greeting / persona fluff in SKILL.md',
  markers: ['MUST NOT'],
  phrases: ['你好,', '你好!', 'hello, i am', 'i am a', '作为一个', '我是'],
  enforcerRef: 'src/services/audit/enforcers/lint-output-style.ts'
};

export const OUTPUT_STYLE_NO_CLOSING_PROMPT: RedLineCatalogEntry = {
  id: 'rl-output-style-no-closing-prompt-001',
  rule: 'Output style: no closing-prompt flattery',
  markers: ['MUST NOT'],
  phrases: ['let me know if', '如有任何需要', '如有需要', 'feel free to ask', 'do not hesitate'],
  enforcerRef: 'src/services/audit/enforcers/lint-output-style.ts'
};

/** Theme D — CLI-back gaps (4 enforcers) */
export const CLI_BACK_MANDATORY_TEXT: RedLineCatalogEntry = {
  id: 'rl-cli-back-mandatory-text-001',
  rule: 'CLI-back: MANDATORY text has peaks * enforcer in the surrounding ±2 lines',
  markers: ['MANDATORY'],
  phrases: ['mandatory', 'mandatory peaks', 'cli-enforced-by', 'enforced by peaks'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts'
};

export const CLI_BACK_NO_ORPHAN_BLOCKING: RedLineCatalogEntry = {
  id: 'rl-cli-back-no-orphan-blocking-001',
  rule: 'CLI-back: no orphan BLOCKING marker without a peaks * enforcer',
  markers: ['BLOCKING'],
  phrases: ['blocking', 'blocking peaks', 'blocking gate'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts'
};

export const CLI_BACK_NO_ORPHAN_MUST_NOT: RedLineCatalogEntry = {
  id: 'rl-cli-back-no-orphan-must-not-001',
  rule: 'CLI-back: no orphan MUST NOT marker without a peaks * enforcer',
  markers: ['MUST NOT'],
  phrases: ['must not', 'must not peaks', 'must not be'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts'
};

export const CLI_BACK_PROSE_ONLY_THRESHOLD: RedLineCatalogEntry = {
  id: 'rl-cli-back-prose-only-threshold-001',
  rule: 'CLI-back: prose-only ratio must stay ≤ 5%',
  markers: ['MANDATORY'],
  phrases: ['prose-only', 'prose only', 'prose-only ratio', 'prose-only threshold'],
  enforcerRef: 'src/services/audit/enforcers/lint-cli-back.ts'
};

/** Theme E — Reference integrity (4 enforcers) */
export const REF_PATH_RESOLVES: RedLineCatalogEntry = {
  id: 'rl-ref-path-resolves-001',
  rule: 'Reference integrity: every references/<file>.md link resolves',
  markers: ['MANDATORY'],
  phrases: ['see references/', 'see `references/', 'see the references file', '→ see'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts'
};

export const REF_NO_BROKEN_MKDIR: RedLineCatalogEntry = {
  id: 'rl-ref-no-broken-mkdir-001',
  rule: 'Reference integrity: no `mkdir -p` outside the project root',
  markers: ['MUST NOT'],
  phrases: ['mkdir -p', 'mkdir -p /', 'mkdir outside', 'mkdir the'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts'
};

export const REF_NO_PWD_SYMLINK_JUMPS: RedLineCatalogEntry = {
  id: 'rl-ref-no-pwd-symlink-jumps-001',
  rule: 'Reference integrity: no `cd ..` chain jumping outside the project',
  markers: ['MUST NOT'],
  phrases: ['cd ..', 'cd ../..', 'cd ../../..', 'cd outside the project'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts'
};

export const REF_NO_RELATIVE_ARCHIVE_PATHS: RedLineCatalogEntry = {
  id: 'rl-ref-no-relative-archive-paths-001',
  rule: 'Reference integrity: no `cp`/`mv`/`ln` to absolute /tmp paths',
  markers: ['MUST NOT'],
  phrases: ['cp /tmp', 'mv /tmp', 'ln /tmp', 'cp -r /tmp', 'do not use /tmp'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-integrity.ts'
};

/** Theme F — Workflow-bound shape (4 enforcers) */
export const OPENSPEC_PROPOSAL_HAS_AC_BULLETS: RedLineCatalogEntry = {
  id: 'rl-openspec-proposal-has-acceptance-bullets-001',
  rule: 'Workflow: openspec proposal has non-empty Acceptance Criteria bullets',
  markers: ['MANDATORY'],
  phrases: ['acceptance criteria', 'a1 —', 'a2 —', '## acceptance criteria'],
  enforcerRef: 'src/services/audit/enforcers/lint-workflow-shape.ts'
};

export const OPENSPEC_PROPOSAL_HAS_SPEC_CHANGES: RedLineCatalogEntry = {
  id: 'rl-openspec-proposal-has-spec-changes-001',
  rule: 'Workflow: openspec proposal has Spec reference (canonical) link',
  markers: ['MANDATORY'],
  phrases: ['spec reference (canonical)', 'spec reference', 'see the spec'],
  enforcerRef: 'src/services/audit/enforcers/lint-workflow-shape.ts'
};

// (Removed in v2.11.0 Group A: TECH_DOC_PRESENCE_PRE_RD catalog entry —
// the enforcer function it pointed to (lintTechDocPresenceShape in
// lint-workflow-shape.ts) was removed in the same slice.)

export const PEAKS_DOCTOR_SKILL_ACKNOWLEDGED: RedLineCatalogEntry = {
  id: 'rl-peaks-doctor-skill-acknowledged-001',
  rule: 'Workflow: skill that writes a request artifact acknowledges peaks doctor',
  markers: ['MANDATORY'],
  phrases: ['peaks doctor', 'peaks-doctor', 'doctor scan', 'doctor route'],
  enforcerRef: 'src/services/audit/enforcers/lint-workflow-shape.ts'
};

/** Theme G — Catalog governance (2 enforcers). The catalog-size
 *  enforcer was already planned; the prose-only-ratio enforcer is
 *  the partner check that flags when the catalog has too many
 *  prose-only entries (i.e. when CLI-back coverage is regressing). */
export const CATALOG_TOTAL_LE_45: RedLineCatalogEntry = {
  id: 'rl-catalog-total-001',
  rule: 'Catalog governance: catalog size must grow to ≥ 40 (L2.3 P2-a target)',
  markers: ['MANDATORY'],
  phrases: ['total red lines', 'totalredlines', 'catalog size', 'catalog grows'],
  enforcerRef: 'src/services/audit/enforcers/lint-catalog-governance.ts'
};

export const CATALOG_PROSE_ONLY_RATIO: RedLineCatalogEntry = {
  id: 'rl-catalog-prose-only-ratio-001',
  rule: 'Catalog governance: prose-only ratio must stay ≤ 5% (per §10.2 L2 acceptance)',
  markers: ['MANDATORY'],
  phrases: ['prose-only ratio', 'prose-only threshold', 'prose-only ≤ 5%', 'prose-only < 10%'],
  enforcerRef: 'src/services/audit/enforcers/lint-catalog-governance.ts'
};
