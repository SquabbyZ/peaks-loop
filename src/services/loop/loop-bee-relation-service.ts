import type Database from "better-sqlite3";
import { ZodError } from "zod";
import {
  LoopBeeRelationSchema,
  type LoopBeeRelation,
  type LoopBeeRelationInput,
  type LoopBeeRelationRole,
} from "./loop-bee-relation-types.js";
import {
  ensureLoopBeeRelationTable,
  insertLoopBeeRelation,
  listLoopBeeRelationsByLoop,
  listLoopBeeRelationsByBee,
  updateLoopBeeRelationRole,
  removeLoopBeeRelation,
  getLoopBeeRelation,
} from "./loop-bee-relation-store.js";

/**
 * Domain error thrown by LoopBeeRelationService when an invariant is
 * violated. The error code is machine-readable; the message is
 * NL-friendly. The CLI layer (M5) maps these into user-facing prompts.
 */
export type LoopBeeRelationIntegrityErrorCode =
  | "LOOP_RETIRED"
  | "DUP_RELATION"
  | "TWO_MAIN_BEES"
  | "FK_LOOP_NOT_FOUND"
  | "FK_BEE_NOT_FOUND";

export class LoopBeeRelationIntegrityError extends Error {
  readonly code: LoopBeeRelationIntegrityErrorCode;
  readonly findings: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    code: LoopBeeRelationIntegrityErrorCode,
    message: string,
    findings: ReadonlyArray<{ path: string; message: string }> = []
  ) {
    super(message);
    this.name = "LoopBeeRelationIntegrityError";
    this.code = code;
    this.findings = findings;
  }
}

/**
 * LoopBeeRelationService — thin service over the loop_bee_relation
 * store. M2 keeps the surface narrow: create / listByLoop / listByBee /
 * updateRole / remove. Promotion, evaluation, and crystallization
 * flows land in later slices.
 *
 * Integrity rules enforced here (spec §4.6 + RL-3):
 *
 *   1. The referenced loop_release row must exist (FK to loop_release.id).
 *      — enforced at DB level (FK constraint).
 *      — surfaced as FK_LOOP_NOT_FOUND for friendlier errors.
 *
 *   2. The referenced bee_release row must exist (FK to bee_release.id).
 *      — enforced at DB level (FK constraint).
 *      — surfaced as FK_BEE_NOT_FOUND for friendlier errors.
 *
 *   3. Cannot relate a bee to a retired loop.
 *      — enforced in service by checking loop_release.lifecycle_status.
 *      — Throws LoopBeeRelationIntegrityError(LOOP_RETIRED).
 *
 *   4. A loop cannot have two `main` bees.
 *      — enforced at DB level via partial unique index.
 *      — surfaced as TWO_MAIN_BEES for friendlier errors.
 *
 *   5. (loop_release_id, bee_release_id) must be unique per row.
 *      — enforced at DB level (UNIQUE).
 *      — surfaced as DUP_RELATION for friendlier errors.
 *
 * The constructor takes an open better-sqlite3 database (the existing
 * `peaks state` boundary) so callers do not have to thread a path
 * through this layer; this matches the LoopReleaseService pattern.
 *
 * All write paths re-validate the input via the Zod schema, mirroring
 * the boundary-check discipline used elsewhere.
 */
export class LoopBeeRelationService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // Idempotent — safe to call on every constructor invocation; the
    // openStateDb pipeline already applied the SQL migration, but a
    // caller-built DB (e.g. tests) needs this.
    ensureLoopBeeRelationTable(this.db);
  }

  /**
   * Persist a new LoopBeeRelation row.
   *
   * Throws:
   *   - ZodError if the input fails schema validation.
   *   - LoopBeeRelationIntegrityError(LOOP_RETIRED) if the loop's
   *     lifecycle_status is "retired".
   *   - LoopBeeRelationIntegrityError(FK_LOOP_NOT_FOUND) if the loop
   *     row does not exist.
   *   - LoopBeeRelationIntegrityError(FK_BEE_NOT_FOUND) if the bee
   *     row does not exist.
   *   - LoopBeeRelationIntegrityError(DUP_RELATION) if a relation
   *     for the same (loop, bee) already exists.
   *   - LoopBeeRelationIntegrityError(TWO_MAIN_BEES) if a `main` row
   *     already exists for the loop.
   */
  create(input: LoopBeeRelationInput): LoopBeeRelation {
    const parsed = LoopBeeRelationSchema.omit({
      id: true,
      created_at: true,
    }).parse(input) as Omit<LoopBeeRelation, "id" | "created_at">;

    // (a) Verify the loop_release row exists and is not retired.
    const loopRow = this.db
      .prepare(
        "SELECT lifecycle_status FROM loop_release WHERE id = ?"
      )
      .get(parsed.loop_release_id) as
      | { lifecycle_status: string }
      | undefined;
    if (!loopRow) {
      throw new LoopBeeRelationIntegrityError(
        "FK_LOOP_NOT_FOUND",
        `loop_release row '${parsed.loop_release_id}' does not exist`,
        [{ path: "loop_release_id", message: "loop_release row not found" }]
      );
    }
    if (loopRow.lifecycle_status === "retired") {
      throw new LoopBeeRelationIntegrityError(
        "LOOP_RETIRED",
        `cannot relate bee to retired loop '${parsed.loop_release_id}'`,
        [
          {
            path: "loop_release_id",
            message:
              "loop_release.lifecycle_status is 'retired'; retirement severs new relations",
          },
        ]
      );
    }

    // (b) Verify the bee_release row exists.
    const beeRow = this.db
      .prepare("SELECT id FROM bee_release WHERE id = ?")
      .get(parsed.bee_release_id) as { id: number } | undefined;
    if (!beeRow) {
      throw new LoopBeeRelationIntegrityError(
        "FK_BEE_NOT_FOUND",
        `bee_release row ${parsed.bee_release_id} does not exist`,
        [
          {
            path: "bee_release_id",
            message: "bee_release row not found",
          },
        ]
      );
    }

    // (c) Insert; the storage-layer partial unique index will raise
    // SQLITE_CONSTRAINT if (a) another `main` row exists for this
    // loop, or (b) the same (loop, bee) pair already exists. Map those
    // to friendly error codes.
    try {
      return insertLoopBeeRelation(this.db, parsed);
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? (err as { code: unknown }).code
          : undefined;
      // Partial unique index on (loop_release_id) WHERE role='main'.
      // better-sqlite3 surfaces this as SQLITE_CONSTRAINT_UNIQUE with
      // a message naming only `loop_bee_relation.loop_release_id`
      // (the column the partial index covers), NOT the index name.
      // It is distinguished from the (loop_release_id, bee_release_id)
      // composite UNIQUE violation by the absence of bee_release_id
      // in the message.
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("loop_bee_relation.bee_release_id")) {
          // Composite UNIQUE(loop_release_id, bee_release_id).
          throw new LoopBeeRelationIntegrityError(
            "DUP_RELATION",
            `relation between loop '${parsed.loop_release_id}' and bee ${parsed.bee_release_id} already exists`,
            [
              {
                path: "loop_release_id,bee_release_id",
                message: "duplicate relation",
              },
            ]
          );
        }
        // Otherwise: partial unique index on (loop_release_id) WHERE role='main'.
        throw new LoopBeeRelationIntegrityError(
          "TWO_MAIN_BEES",
          `loop '${parsed.loop_release_id}' already has a main bee`,
          [
            {
              path: "role",
              message:
                "at most one main bee per loop; promote / retire the existing main first",
            },
          ]
        );
      }
      // FK violations from better-sqlite3 (foreign_keys = ON).
      if (code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
        // Distinguish by re-checking which row is missing; the friendly
        // pre-check above should have caught these, but defense in depth.
        const loopStill = this.db
          .prepare("SELECT 1 FROM loop_release WHERE id = ?")
          .get(parsed.loop_release_id);
        if (!loopStill) {
          throw new LoopBeeRelationIntegrityError(
            "FK_LOOP_NOT_FOUND",
            `loop_release row '${parsed.loop_release_id}' does not exist`,
            [{ path: "loop_release_id", message: "FK violation" }]
          );
        }
        throw new LoopBeeRelationIntegrityError(
          "FK_BEE_NOT_FOUND",
          `bee_release row ${parsed.bee_release_id} does not exist`,
          [{ path: "bee_release_id", message: "FK violation" }]
        );
      }
      // Re-throw unexpected errors unchanged.
      throw err;
    }
  }

  /** Read a LoopBeeRelation row by id; returns undefined if absent. */
  read(id: number): LoopBeeRelation | undefined {
    return getLoopBeeRelation(this.db, id);
  }

  /**
   * List relations for a given loop. Filter by `role` when supplied.
   */
  listByLoop(opts: {
    loop_release_id: string;
    role?: LoopBeeRelationRole;
  }): LoopBeeRelation[] {
    return listLoopBeeRelationsByLoop(
      this.db,
      opts.loop_release_id,
      opts.role
    );
  }

  /**
   * List relations for a given bee. Filter by `role` when supplied.
   */
  listByBee(opts: {
    bee_release_id: number;
    role?: LoopBeeRelationRole;
  }): LoopBeeRelation[] {
    return listLoopBeeRelationsByBee(this.db, opts.bee_release_id, opts.role);
  }

  /**
   * Update the role of an existing relation. The storage-level partial
   * unique index on `main` re-asserts "at most one main per loop" if
   * the new role is `main`. Returns the updated row or undefined if
   * the id is absent.
   */
  updateRole(id: number, newRole: LoopBeeRelationRole): LoopBeeRelation | undefined {
    // The TS type already enforces the four-value union. Try update;
    // if partial unique index trips, raise friendly error.
    try {
      return updateLoopBeeRelationRole(this.db, id, newRole);
    } catch (err: unknown) {
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? (err as { code: unknown }).code
          : undefined;
      if (code === "SQLITE_CONSTRAINT_UNIQUE") {
        const existing = getLoopBeeRelation(this.db, id);
        const loopId = existing?.loop_release_id ?? "<unknown>";
        throw new LoopBeeRelationIntegrityError(
          "TWO_MAIN_BEES",
          `loop '${loopId}' already has a main bee`,
          [{ path: "role", message: "at most one main bee per loop" }]
        );
      }
      throw err;
    }
  }

  /** Remove a relation by id. Returns true if a row was deleted. */
  remove(id: number): boolean {
    return removeLoopBeeRelation(this.db, id);
  }
}

/**
 * Convenience: re-export the Zod error class guard so callers can do
 * `if (err instanceof ZodError)`. Avoids forcing every caller to import
 * zod directly.
 */
export function isZodError(err: unknown): err is ZodError {
  return err instanceof ZodError;
}