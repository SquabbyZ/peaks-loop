/**
 * v2.11.0 — Group E (Tier 8) migration types.
 *
 * The migration codemod scans pre-v2.11.0 sessions for `rd/tech-doc.md`
 * files and prepends a YAML banner marking them as deprecated. Files
 * move (physically) is out of scope per Karpathy §3 surgical changes;
 * the immutable peaks-prd handoff at `prd/handoff.md` is the new
 * source of truth, but old files coexist.
 *
 * === Source: peaks-rd/references/writing-handoff-frontmatter.md §"v2.11.0" ===
 *
 * The banner shape is fixed; if a file already carries a `---` frontmatter,
 * the migration skips it (set `reason: 'not-a-tech-doc'`) to avoid clobbering
 * user-authored content.
 */

export type MigrationReason =
  | 'will-deprecate'
  | 'already-deprecated'
  | 'not-a-tech-doc';

export interface MigrationEntry {
  readonly sessionId: string;
  readonly filePath: string;
  readonly fromHash: string;
  readonly toHash: string;
  readonly reason: MigrationReason;
  readonly skippedBytes: number;
}

export interface MigrationPlan {
  readonly projectRoot: string;
  readonly entries: ReadonlyArray<MigrationEntry>;
  readonly willDeprecateCount: number;
  readonly alreadyDeprecatedCount: number;
  readonly notTechDocCount: number;
}

export interface MigrationResult {
  readonly plan: MigrationPlan;
  readonly applied: boolean;
  readonly writtenCount: number;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

export const DEPRECATION_BANNER = [
  '---',
  'deprecated: historical',
  'deprecatedBy: v2.11.0',
  'replacedBy: peaks-prd handoff at .peaks/_runtime/<sessionId>/prd/handoff.md',
  '---',
  ''
].join('\n');
