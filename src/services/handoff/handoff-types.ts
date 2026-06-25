/**
 * Handoff frontmatter schema — types.
 *
 * Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass.md
 *       Phase 1, Task 4 (Handoff frontmatter types + parser + writer).
 *
 * A handoff artifact is a markdown file with a YAML frontmatter block
 * carrying structured fields (rid, slice_id, status, ...) followed by a
 * prose body. The frontmatter is the source of truth for downstream
 * automation (peaks-rd, peaks-qa); the body is human/agent prose.
 *
 * Two schema versions exist:
 *   - "0" — legacy handoff (no frontmatter block). Fields default to
 *           `rid='unknown'`, `slice_id='unknown'`, `agent_id='unknown'`,
 *           `status='unknown'`, `created_at=epoch`.
 *   - "1" — current schema. All required fields must be present; the
 *           parser throws `IncompleteHandoffError` if any are missing.
 */

export type HandoffStatus = 'done' | 'failed' | 'partial' | 'blocked' | 'unknown';
export type HandoffTestResult = 'pass' | 'fail' | 'inconclusive' | null;
export type HandoffSchemaVersion = '0' | '1';

export interface HandoffFrontmatter {
  readonly rid: string;
  readonly slice_id: string;
  readonly agent_id: string;
  readonly schema_version: HandoffSchemaVersion;
  readonly status: HandoffStatus;
  readonly created_at: string;
  readonly duration_seconds?: number;
  readonly files_changed?: readonly string[];
  readonly lines_added?: number;
  readonly lines_removed?: number;
  readonly test_result?: HandoffTestResult;
  readonly coverage?: number;
  readonly errors?: readonly string[];
  readonly warnings?: readonly string[];
  readonly blockers?: readonly string[];
  readonly upstream_dependencies?: readonly string[];
}
