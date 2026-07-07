/**
 * Red-line audit framework — types.
 *
 * Spec: docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md §5
 * PRD:  .peaks/_runtime/2026-06-11-session-f0312d/prd/requests/001-001-l2-1-redlines-audit.md
 * OpenSpec: openspec/changes/2026-06-11-l2-1-redlines-audit/
 *
 * The audit framework classifies MANDATORY / BLOCKING / MUST NOT / RED LINE
 * markers across skills/, .claude/rules/, and openspec/changes/. Each
 * discovered red line is tagged with its backing (cli-backed / partial /
 * prose-only) so the L2 redesign can track the prose-only ratio over time.
 */

export type RedLineMarker = 'MANDATORY' | 'BLOCKING' | 'MUST NOT' | 'RED LINE';

export type RedLineBacking = 'cli-backed' | 'partial' | 'prose-only';

export interface RedLineSource {
  /** Path relative to project root, posix-style (forward slashes). */
  readonly file: string;
  readonly line: number;
  readonly marker: RedLineMarker;
  /** ±2 lines of surrounding context for human review. */
  readonly context: string;
}

export interface RedLineEntry {
  /** Stable id, e.g. "rl-code-ban-001". */
  readonly id: string;
  /** Human-readable rule name, e.g. "Code Commit Ban". */
  readonly rule: string;
  readonly source: RedLineSource;
  readonly backing: RedLineBacking;
  /** Relative path to the enforcement file, or null when prose-only. */
  readonly enforcerRef: string | null;
  /**
   * v2.12.1 catalog governance: `true` for entries that are
   * advisory / educational / "discovered-but-not-yet-enforced" and
   * therefore should NOT count toward the prose-only ratio (per spec
   * §10.2 L2 acceptance ≤ 5%). Defaults to `false`; the classifier
   * sets it to `true` for auto-discovered prose-only entries (those
   * without a catalog match, since they have no enforcer template
   * to promote to). Callers that want strict accounting can still
   * read `backing === 'prose-only'` and filter manually.
   *
   * Why: the pre-v2.12.1 catalog treated every MANDATORY/BLOCKING
   * phrase in SKILL.md as a "red line", which produced a 60.1%
   * prose-only ratio (89/148) for what is mostly LLM behavior
   * guidance, not machine-enforceable rules. See
   * `.peaks/memory/2026-06-27-prose-only-catalog-followup.md`.
   */
  readonly informational?: boolean;
}

export interface RedLineAudit {
  readonly totalRedLines: number;
  readonly cliBacked: number;
  readonly partial: number;
  readonly proseOnly: number;
  readonly audit: readonly RedLineEntry[];
  /** Findings from running the 7 file-system enforcers during the scan (L2.4 P2-b). */
  readonly enforcerFindings: readonly EnforcerFinding[];
}

/**
 * Enforcer finding — emitted by an enforcer function that runs as part
 * of the audit scan. Distinct from `RedLineEntry` (which is catalog-matched
 * markdown text). L2.4 P2-b ships this dimension: the audit framework
 * actually invokes the 7 file-system enforcers during a scan, not just
 * catalogs them.
 */
export type EnforcerFindingSeverity = 'pass' | 'warn' | 'fail';

export interface EnforcerFinding {
  readonly enforcerId: string;
  readonly rule: string;
  readonly severity: EnforcerFindingSeverity;
  readonly file: string;
  readonly detail: string;
}

/**
 * A single markdown line discovered by a tree scanner. The classifier turns
 * these into RedLineEntry by matching against the red-line catalog.
 */
export interface MarkdownLine {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface ScanWarning {
  readonly file: string;
  readonly message: string;
}
