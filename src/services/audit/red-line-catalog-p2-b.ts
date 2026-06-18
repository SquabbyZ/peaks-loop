/**
 * Red-line catalog — P2-b entries (Slice #7 L2.4).
 *
 * These 25 entries close the references/*.md + audit-regression
 * gap left by L2.1 (P0), L2.2 (P1), and L2.3 (P2-a). Per spec
 * §5.4, P2-b targets 25-40 lint-style red-lines for
 * references/*.md and the audit regression stage.
 *
 * Enforcer functions live in:
 *   - enforcers/lint-reference-shape.ts (Themes H-K, M-P)
 *   - enforcers/lint-audit-regression.ts (Theme L)
 */
import type { RedLineCatalogEntry } from './red-line-catalog.js';

/** Theme H — Reference structural shape (3 enforcers) */
const REF_H1_TITLE_REQUIRED: RedLineCatalogEntry = {
  id: 'rl-ref-h1-title-required-001',
  rule: 'Reference shape: every references/*.md starts with `# <title>`',
  markers: ['MANDATORY'],
  phrases: ['# ', 'h1 title', 'top heading'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_APPLICABLE_TASK_LEVELS: RedLineCatalogEntry = {
  id: 'rl-ref-applicable-task-levels-declared-001',
  rule: 'Reference shape: every references/*.md declares applicableTaskLevels',
  markers: ['MANDATORY'],
  phrases: ['applicable task levels', 'applies to', 'task levels:'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_SEE_ALSO_SECTION: RedLineCatalogEntry = {
  id: 'rl-ref-see-also-section-001',
  rule: 'Reference shape: every references/*.md has a `## See also` section',
  markers: ['MANDATORY'],
  phrases: ['see also', 'related references', '## see also'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme I — Reference cross-references (3 enforcers) */
const REF_CROSS_REF_RESOLVES: RedLineCatalogEntry = {
  id: 'rl-ref-cross-ref-resolves-001',
  rule: 'Reference integrity: every `../<file>.md` link from a reference resolves',
  markers: ['MANDATORY'],
  phrases: ['cross-reference', 'see also', 'see ./'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_SELF_REFERENCE: RedLineCatalogEntry = {
  id: 'rl-ref-no-self-reference-001',
  rule: 'Reference integrity: no reference file links to itself',
  markers: ['MUST NOT'],
  phrases: ['self reference', 'circular reference', 'recursive link'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_ORPHAN_LINK: RedLineCatalogEntry = {
  id: 'rl-ref-no-orphan-link-001',
  rule: 'Reference integrity: no link to a non-existent file or section',
  markers: ['MUST NOT'],
  phrases: ['orphan link', 'broken link', 'dead link'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme J — Reference size + structure (3 enforcers) */
const REF_LINE_COUNT_LE_800: RedLineCatalogEntry = {
  id: 'rl-ref-line-count-le-800-001',
  rule: 'Reference size: each reference ≤ 800 lines (Karpathy Guidelines §2 Simplicity First)',
  markers: ['MANDATORY'],
  phrases: ['800 lines', 'line count', 'karpathy cap', 'file size'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_H2_COUNT_LE_12: RedLineCatalogEntry = {
  id: 'rl-ref-h2-count-le-12-001',
  rule: 'Reference size: at most 12 `## <heading>` per reference',
  markers: ['MANDATORY'],
  phrases: ['h2 count', '12 h2', 'depth cap'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_OVERVIEW_SECTION_NEAR_TOP: RedLineCatalogEntry = {
  id: 'rl-ref-overview-section-near-top-001',
  rule: 'Reference size: long references (>200 lines) must have `## Overview` within the first 30 lines',
  markers: ['MANDATORY'],
  phrases: ['overview section', 'top of file', '## overview'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme K — loadStrategy behavior (2 enforcers) */
const REF_LOADSTRATEGY_ON_DEMAND_FALLBACK: RedLineCatalogEntry = {
  id: 'rl-ref-loadstrategy-on-demand-fallback-001',
  rule: 'loadStrategy: on-demand references must declare a fallback path',
  markers: ['MANDATORY'],
  phrases: ['on-demand fallback', 'fallback path', 'loadstrategy: on-demand'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_LOADSTRATEGY_ALWAYS_CACHEABLE: RedLineCatalogEntry = {
  id: 'rl-ref-loadstrategy-always-cacheable-001',
  rule: 'loadStrategy: always references must be safe to load unconditionally',
  markers: ['MANDATORY'],
  phrases: ['always-cacheable', 'unconditional load', 'loadstrategy: always'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme L — Audit regression (4 enforcers) */
const AUDIT_CATALOG_STABILITY: RedLineCatalogEntry = {
  id: 'rl-audit-catalog-stability-001',
  rule: 'Audit regression: catalog size has not grown > 20% in the last 90 days',
  markers: ['MANDATORY'],
  phrases: ['catalog stability', 'catalog growth', 'catalog drift'],
  enforcerRef: 'src/services/audit/enforcers/lint-audit-regression.ts',
};

const AUDIT_NO_ORPHAN_ENFORCER: RedLineCatalogEntry = {
  id: 'rl-audit-no-orphan-enforcer-001',
  rule: 'Audit regression: every enforcerRef points to a real file',
  markers: ['MUST NOT'],
  phrases: ['orphan enforcer', 'missing enforcer file', 'enforcerref'],
  enforcerRef: 'src/services/audit/enforcers/lint-audit-regression.ts',
};

const AUDIT_NO_ORPHAN_CATALOG: RedLineCatalogEntry = {
  id: 'rl-audit-no-orphan-catalog-001',
  rule: 'Audit regression: every catalog entry has a non-null enforcerRef (or a documented reason)',
  markers: ['MUST NOT'],
  phrases: ['orphan catalog', 'prose-only entry', 'enforcerref: null'],
  enforcerRef: 'src/services/audit/enforcers/lint-audit-regression.ts',
};

const AUDIT_RUNTIME_BUDGET: RedLineCatalogEntry = {
  id: 'rl-audit-runtime-budget-001',
  rule: 'Audit regression: peaks audit red-lines completes in < 2 seconds on a 100-reference project',
  markers: ['MANDATORY'],
  phrases: ['runtime budget', 'audit performance', '2 second budget'],
  enforcerRef: 'src/services/audit/enforcers/lint-audit-regression.ts',
};

/** Theme M — Inline shell patterns (3 enforcers) */
const REF_NO_BASH_HEREDOC: RedLineCatalogEntry = {
  id: 'rl-ref-no-bash-heredoc-001',
  rule: 'Reference inline shell: no `cat <<EOF` (YAGNI for the demo skill)',
  markers: ['MUST NOT'],
  phrases: ['bash heredoc', 'cat <<eof', 'heredoc pattern'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_SUDO: RedLineCatalogEntry = {
  id: 'rl-ref-no-sudo-001',
  rule: 'Reference inline shell: no `sudo` (peaks-cli is user-scope)',
  markers: ['MUST NOT'],
  phrases: ['no sudo', 'user-scope', 'sudo command'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_CURL_PIPE_BASH: RedLineCatalogEntry = {
  id: 'rl-ref-no-curl-pipe-bash-001',
  rule: 'Reference inline shell: no `curl ... | bash` (LLM supply-chain attack vector)',
  markers: ['MUST NOT'],
  phrases: ['curl pipe bash', 'remote code execution', 'supply-chain'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme N — Code blocks (3 enforcers) */
const REF_CODE_BLOCK_LANGUAGE: RedLineCatalogEntry = {
  id: 'rl-ref-code-block-language-declared-001',
  rule: 'Reference code blocks: every fenced block has a language tag',
  markers: ['MANDATORY'],
  phrases: ['fenced code block', 'language tag', 'typescript | bash | json'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_FAKE_PROMPT: RedLineCatalogEntry = {
  id: 'rl-ref-no-fake-prompt-001',
  rule: 'Reference code blocks: no `# fake prompt` / `$ fake` markers',
  markers: ['MUST NOT'],
  phrases: ['fake prompt', 'placeholder code', 'demo marker'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_ABSOLUTE_PATHS: RedLineCatalogEntry = {
  id: 'rl-ref-no-absolute-paths-001',
  rule: 'Reference code blocks: no `C:\\` or `/usr/local` (use peaks-cli primitives)',
  markers: ['MUST NOT'],
  phrases: ['absolute path', 'c:\\', '/usr/local', 'machine-specific'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme O — Permissions + numbers (2 enforcers) */
const REF_NO_CHMOD_777: RedLineCatalogEntry = {
  id: 'rl-ref-no-chmod-777-001',
  rule: 'Reference inline shell: no `chmod 777` (security red flag)',
  markers: ['MUST NOT'],
  phrases: ['chmod 777', 'world-writable', 'insecure permission'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_NO_MAGIC_NUMBERS: RedLineCatalogEntry = {
  id: 'rl-ref-no-magic-numbers-001',
  rule: 'Reference code blocks: no unsigned integer ≥ 100 that is not a named constant',
  markers: ['MUST NOT'],
  phrases: ['magic number', 'named constant', 'hard-coded threshold'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/** Theme P — Dogfooding (2 enforcers) */
const REF_SKILL_CITES_EVERY_EXISTING: RedLineCatalogEntry = {
  id: 'rl-ref-skill-cites-every-existing-reference-001',
  rule: 'Reference dogfooding: every reference file IS cited in its parent SKILL.md',
  markers: ['MANDATORY'],
  phrases: ['uncited reference', 'dead reference', 'reference not cited'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

const REF_LOADSTRATEGY_MATCHES_SIZE: RedLineCatalogEntry = {
  id: 'rl-ref-loadstrategy-matches-size-001',
  rule: 'Reference dogfooding: loadStrategy matches file size (>5KB → on-demand)',
  markers: ['MANDATORY'],
  phrases: ['loadstrategy matches size', 'context budget', 'on-demand for large'],
  enforcerRef: 'src/services/audit/enforcers/lint-reference-shape.ts',
};

/**
 * The 25 P2-b entries, in stable display order. Spread into
 * RED_LINE_CATALOG (after P2-a's block) so future slices can
 * append without touching this file.
 */
export const RED_LINE_CATALOG_P2_B: readonly RedLineCatalogEntry[] = [
  // Theme H
  REF_H1_TITLE_REQUIRED,
  REF_APPLICABLE_TASK_LEVELS,
  REF_SEE_ALSO_SECTION,
  // Theme I
  REF_CROSS_REF_RESOLVES,
  REF_NO_SELF_REFERENCE,
  REF_NO_ORPHAN_LINK,
  // Theme J
  REF_LINE_COUNT_LE_800,
  REF_H2_COUNT_LE_12,
  REF_OVERVIEW_SECTION_NEAR_TOP,
  // Theme K
  REF_LOADSTRATEGY_ON_DEMAND_FALLBACK,
  REF_LOADSTRATEGY_ALWAYS_CACHEABLE,
  // Theme L
  AUDIT_CATALOG_STABILITY,
  AUDIT_NO_ORPHAN_ENFORCER,
  AUDIT_NO_ORPHAN_CATALOG,
  AUDIT_RUNTIME_BUDGET,
  // Theme M
  REF_NO_BASH_HEREDOC,
  REF_NO_SUDO,
  REF_NO_CURL_PIPE_BASH,
  // Theme N
  REF_CODE_BLOCK_LANGUAGE,
  REF_NO_FAKE_PROMPT,
  REF_NO_ABSOLUTE_PATHS,
  // Theme O
  REF_NO_CHMOD_777,
  REF_NO_MAGIC_NUMBERS,
  // Theme P
  REF_SKILL_CITES_EVERY_EXISTING,
  REF_LOADSTRATEGY_MATCHES_SIZE,
];
