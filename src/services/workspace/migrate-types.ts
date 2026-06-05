/**
 * Type envelope for the `peaks workspace migrate` CLI command.
 *
 * The migrate command is the downstream-project counterpart to the
 * one-time Phase 5 migration script that ran on the peaks-cli self-host
 * for slice 2026-06-05-change-id-as-unit-of-work. Where
 * `peaks workspace reconcile` only handles the top-level runtime state
 * files (`.peaks/.session.json`, `.peaks/.active-skill.json`,
 * `.peaks/sop-state/` → `.peaks/_runtime/`), `peaks workspace migrate`
 * handles the much bigger case: legacy reviewable content under
 * `.peaks/<session-id>/<role>/<file>` → `.peaks/retrospective/<change-id>/<role>/<file>`.
 *
 * Each legacy session dir typically contains multiple change-ids worth
 * of work (the old layout allowed one session to host several slices).
 * Change-id resolution uses a 4-tier per-file heuristic (filename
 * regex → content H1 → body frontmatter → per-session fallback to the
 * most-recent `<change-id>` in `rd/requests/`).
 *
 * Types are hand-rolled, no new top-level dependencies.
 */

export type MigrateFilePlan = {
  /** Absolute source path (under `.peaks/<session-id>/...`). */
  from: string;
  /** Absolute target path (under `.peaks/retrospective/<change-id>/...`). */
  to: string;
  /** The session dir this file came from. */
  sessionId: string;
  /** The change-id the file is being routed to. */
  changeId: string;
  /** The role inferred from the file's path (rd/qa/prd/ui/sc). */
  role: 'prd' | 'ui' | 'rd' | 'qa' | 'sc' | 'system' | 'unknown';
  /** Path of the file relative to the session dir, e.g. `rd/tech-doc.md`. */
  relativePath: string;
  /**
   * Which tier of the 4-tier heuristic produced the change-id. Null
   * when the file is not a per-slice artifact (e.g. cross-cutting
   * `rd/project-scan.md` or `qa/.initiated`).
   */
  source:
    | 'filename-regex'
    | 'content-h1'
    | 'content-frontmatter'
    | 'session-fallback'
    | 'cross-cutting'
    | null;
  /** True if the file was skipped (e.g. `session.json`, cross-cutting, conflict). */
  skipped?: boolean;
  /** Why the file was skipped (only set when `skipped === true`). */
  skipReason?: 'transient-runtime' | 'conflict' | 'no-change-id' | 'unsupported-role';
};

export type MigrateSessionPlan = {
  sessionId: string;
  /** Absolute path to the session dir. */
  path: string;
  /** True if the dir is empty / only has `session.json`. */
  empty: boolean;
  /** All files in the dir, planned. */
  files: MigrateFilePlan[];
  /** The fallback change-id derived from the session's most recent `rd/requests/` entry. Null if no requests exist. */
  fallbackChangeId: string | null;
};

export type MigrateResult = {
  /** Absolute project root the command operated on. */
  projectRoot: string;
  /** All discovered legacy session dirs, sorted by name. */
  sessions: MigrateSessionPlan[];
  /** All moves the apply step WOULD perform (only populated when `apply === false` as well, for symmetry). */
  wouldMove: MigrateFilePlan[];
  /** All moves actually performed (only populated when `apply === true`). */
  moved: MigrateFilePlan[];
  /** Sessions that became empty after the move and were/will be removed. */
  deletedSessions: string[];
  /** Sessions that WOULD become empty (dry-run only). */
  wouldDeleteSessions: string[];
  /** Files that already exist at the target (collision). Dry-run reports; apply skips + warns. */
  conflicts: Array<{ from: string; to: string; reason: string }>;
  /** Whether `--apply` was set. */
  apply: boolean;
  /** Total files moved or scheduled to move. */
  totalFilesMoved: number;
};

export type MigrateOptions = {
  projectRoot: string;
  /** When true, actually `git mv` the files + `rm -rf` the emptied session dirs. */
  apply: boolean;
};
