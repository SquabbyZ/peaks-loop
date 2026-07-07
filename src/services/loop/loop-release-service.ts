import type Database from "better-sqlite3";
import {
  LoopReleaseSchema,
  type LoopRelease,
  type LoopReleaseInput,
  type LoopReleaseLifecycleStatus,
} from "./loop-release-types.js";
import {
  ensureLoopReleaseTable,
  insertLoopRelease,
  getLoopRelease,
  listLoopReleasesByStatus,
  searchLoopReleasesByScenario,
} from "./loop-release-store.js";

/**
 * Thin service wrapper around the loop_release store. M1 keeps the
 * surface tiny on purpose: create / read / list / search. Promotion,
 * retirement, evaluation, and the `loop_bee_relation` joins are
 * deliberately deferred to M2 / M4 / M5 — shipping them here would
 * lock in an interface that the ratchet has not yet ratified.
 *
 * The constructor takes an open better-sqlite3 database (the existing
 * `peaks state` boundary) so callers do not have to thread a path
 * through this layer; this matches the `retainRelease` pattern in
 * `src/services/skillhub/release-retain.ts`.
 *
 * All write paths re-validate the input via the Zod schema, mirroring
 * the boundary-check discipline used elsewhere (e.g.
 * `lintManifestStrict` in `src/services/sediment/manifest-lint.ts`).
 */
export class LoopReleaseService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // Idempotent — safe to call on every constructor invocation; the
    // openStateDb pipeline already applied the SQL migration, but a
    // caller-built DB (e.g. tests) needs this.
    ensureLoopReleaseTable(this.db);
  }

  /**
   * Persist a new LoopRelease row. Re-validates the input via the
   * Zod schema; throws ZodError on failure.
   */
  create(input: LoopReleaseInput): LoopRelease {
    const row = LoopReleaseSchema.parse(input) as LoopRelease;
    insertLoopRelease(this.db, row);
    return row;
  }

  /** Read a LoopRelease row by id; returns undefined if absent. */
  read(id: string): LoopRelease | undefined {
    return getLoopRelease(this.db, id);
  }

  /**
   * List LoopRelease rows. Filter by `status` when supplied; without
   * it, returns ALL rows (across `candidate` / `stable` / `retired`).
   * Sort is newest-first by `archived_at`.
   */
  list(opts: { status?: LoopReleaseLifecycleStatus } = {}): LoopRelease[] {
    if (opts.status) return listLoopReleasesByStatus(this.db, opts.status);
    const all: LoopReleaseLifecycleStatus[] = ["candidate", "stable", "retired"];
    const out: LoopRelease[] = [];
    for (const s of all) out.push(...listLoopReleasesByStatus(this.db, s));
    return out;
  }

  /**
   * Search LoopRelease rows whose `scenario` contains the query
   * string (case-insensitive substring match via LIKE). Filter by
   * `status` to scope the search.
   */
  search(opts: {
    query: string;
    status?: LoopReleaseLifecycleStatus;
  }): LoopRelease[] {
    const hits = searchLoopReleasesByScenario(this.db, opts.query);
    if (!opts.status) return hits;
    return hits.filter((r) => r.lifecycle_status === opts.status);
  }
}