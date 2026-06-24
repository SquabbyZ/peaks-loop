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
 * `.peaks/_runtime/<session-id>/<role>/<file>` → `.peaks/retrospective/<change-id>/<role>/<file>`.
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
  /** Absolute source path (under `.peaks/_runtime/<session-id>/...`). */
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

export type MigrateOptions = {
  projectRoot: string;
  /** When true, actually `git mv` the files + `rm -rf` the emptied session dirs. */
  apply: boolean;
  /**
   * Slice 003 (2026-06-06-session-layout-canonicalize): when true, the
   * command performs the **session-dir consolidation** — moves every
   * top-level `.peaks/_runtime/<sid>/` to `.peaks/_runtime/<sid>/`. Idempotent;
   * conflicts (target exists with different content) are logged but
   * never overwrite. With `apply: false` (the default), the response
   * lists what WOULD move + the conflicts.
   *
   * Mutually exclusive with the reviewable-content migration: the
   * `--to-runtime` step is the data side of slice 003, while the
   * default `migrate` step is the cross-cutting content side
   * (reviewable files → retrospective). Both run when both flags are
   * set; the order is `--to-runtime` first (so the cross-cutting
   * step sees the canonical tree) and then the reviewable-content
   * step.
   */
  toRuntime?: boolean;
};

export type MigrateToRuntimeFilePlan = {
  /** Absolute source path (top-level `.peaks/_runtime/<sid>/`). */
  from: string;
  /** Absolute target path (`.peaks/_runtime/<sid>/`). */
  to: string;
  /** The session id the dir belongs to. */
  sessionId: string;
  /** 'moved' or 'skipped-already-canonical' or 'conflict'. */
  action: 'moved' | 'skipped-already-canonical' | 'conflict-target-exists-with-different-content' | 'f15-conflict-project-scan';
  /** Human-readable reason for the action (for the conflicts list). */
  reason: string;
};

export type MigrateResult = {
  /** Absolute project root the command operated on. */
  projectRoot: string;
  /** All discovered legacy session dirs, sorted by name. */
  sessions: MigrateSessionPlan[];
  /** All moves the apply step WOULD perform (only populated when `apply: false` as well, for symmetry). */
  wouldMove: MigrateFilePlan[];
  /** All moves actually performed (only populated when `apply: true`). */
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
  /**
   * Slice 003: per-session-dir move plans for the `--to-runtime` step.
   * Empty when `toRuntime` was not set. Conflicts include both the
   * top-level/<sid>/ → _runtime/<sid>/ collisions AND the F15 carve-out
   * for `rd/project-scan.md`.
   */
  toRuntimePlans?: MigrateToRuntimeFilePlan[];
  toRuntimeMoved?: string[];
  toRuntimeSkipped?: string[];
  toRuntimeConflicts?: Array<{ from: string; to: string; reason: string }>;
};
