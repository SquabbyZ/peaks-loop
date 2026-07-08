import type Database from "better-sqlite3";
import { z, ZodError } from "zod";
import {
  CrystallizationEventSchema,
  EvidenceBriefSchema,
  type CrystallizationEvent,
  type CrystallizationEventInput,
  type CrystallizationEventStatus,
  type EvidenceBrief,
} from "./crystallization-types.js";
import { BriefSectionError } from "./evidence-brief-builder.js";
import {
  CRYSTALLIZATION_SCHEMA_VERSION,
  ensureCrystallizationEventTable,
  getCrystallizationEvent,
  listCrystallizationEvents,
  newCrystallizationId,
  updateCrystallizationEventStatus,
} from "./crystallization-store.js";
import { insertLoopRelease } from "../loop/loop-release-store.js";
import { LoopReleaseSchema, type LoopReleaseInput } from "../loop/loop-release-types.js";
import { insertLoopBeeRelation } from "../loop/loop-bee-relation-store.js";
import {
  LoopBeeRelationSchema,
  type LoopBeeRelationInput,
} from "../loop/loop-bee-relation-types.js";

/**
 * CrystallizationService — spec §5 (post-run crystallization)
 * + §4.5 + §4.7 + §10 RL-2 / RL-3 / RL-7.
 *
 * Hard rules enforced at THIS layer (defense in depth; the Zod
 * schemas above and the brief refine guard add the second wall):
 *
 *   - AC-4 / RL-2: a crystallization_event is written only when the
 *     candidate task has `task_status === 'completed'` AND
 *     `gates_passed === true` AND `evidence_collected === true`.
 *     Any pre-run attempt (status !== 'completed') is rejected
 *     with `CRYSTALLIZATION_PRE_RUN`. This is the pre-run block
 *     enforced by AC-4, AC-5, AC-6, AC-15, AC-16, AC-17 of the M5
 *     slice.
 *   - AC-6 / RL-3: writing a (loop_release, main_bee_release,
 *     loop_bee_relation) pair happens in a SINGLE TRANSACTION. The
 *     brief persist on crystallization_event also lives inside
 *     the same transaction (the brief is the durable evidence;
 *     dropping either side would break consistency).
 *   - AC-7 / RL-1: this layer never asks the user to hand-author
 *     JSON / manifest / CLI verb; all inputs are typed payloads
 *     the LLM submits on the user's behalf.
 *   - AC-15 / RL-7: the brief is mandatory; the
 *     `EvidenceBriefSchema.refine` guard rejects partial briefs
 *     at the parse boundary.
 *   - AC-16 / RL-7: the brief has all 4 sections
 *     (what_happened / why_it_matters / what_learned /
 *     what_action). The service throws `BriefSectionError` if the
 *     payload fails the guard.
 *
 * Sub-domain error codes:
 *
 *   - CRYSTALLIZATION_PRE_RUN: task_status / gates_passed /
 *     evidence_collected precondition failed.
 *   - CRYSTALLIZATION_INVALID_TASK_STATE: a task input field is
 *     malformed (e.g. unknown task_status).
 *   - MISSING_BRIEF_SECTION: a brief is missing at least one of
 *     its 4 sections (raised from the evidence-brief-builder
 *     refine; surfaced as-is by the service).
 *   - CRYSTALLIZATION_TX_FAILED: a transaction-side effect failed
 *     (FK constraint, duplicate key, …). The service re-raises
 *     richer domain errors first; this is the catch-all for
 *     unexpected SQL errors.
 */

/* ---------------------------------------------------------------------- */
/* Pre-run task gate — AC-4 / RL-2                                        */
/* ---------------------------------------------------------------------- */

export const CRYSTALLIZATION_TASK_STATUSES = [
  "completed",
  "in_progress",
  "scratch",
  "blocked",
  "failed",
] as const;
export type CrystallizationTaskStatus =
  (typeof CRYSTALLIZATION_TASK_STATUSES)[number];

/**
 * The pre-run task state the service requires. Crystallization is
 * GATED on these three flags. The validator rejects any input that
 * does not match. Adding a new flag means a schema-version bump; for
 * now the three are required.
 */
export const CrystallizationTaskStateSchema = z.object({
  task_id: z.string().trim().min(1).max(256),
  task_status: z.literal("completed", {
    errorMap: () => ({
      message:
        "task_status must be 'completed' for crystallization (AC-4 / RL-2)",
    }),
  }),
  gates_passed: z.literal(true, {
    errorMap: () => ({
      message:
        "gates_passed must be true for crystallization (AC-4 / RL-2)",
    }),
  }),
  evidence_collected: z.literal(true, {
    errorMap: () => ({
      message:
        "evidence_collected must be true for crystallization (AC-4 / RL-2)",
    }),
  }),
});
export type CrystallizationTaskState = z.infer<
  typeof CrystallizationTaskStateSchema
>;

/* ---------------------------------------------------------------------- */
/* Domain error                                                           */
/* ---------------------------------------------------------------------- */

export type CrystallizationIntegrityErrorCode =
  | "CRYSTALLIZATION_PRE_RUN"
  | "CRYSTALLIZATION_INVALID_TASK_STATE"
  | "CRYSTALLIZATION_TX_FAILED"
  | "MISSING_BRIEF_SECTION";

export class CrystallizationIntegrityError extends Error {
  readonly code: CrystallizationIntegrityErrorCode | "MISSING_BRIEF_SECTION";
  readonly findings: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    code: CrystallizationIntegrityErrorCode,
    message: string,
    findings: ReadonlyArray<{ path: string; message: string }> = []
  ) {
    super(message);
    this.name = "CrystallizationIntegrityError";
    this.code = code;
    this.findings = findings;
  }
}

/* ---------------------------------------------------------------------- */
/* Service                                                                */
/* ---------------------------------------------------------------------- */

export interface CrystallizePayload {
  /** The candidate task state. Must satisfy the pre-run gate. */
  task: CrystallizationTaskState;
  /** The loop_release to create (new). Must include main bee via relation. */
  loop_input: LoopReleaseInput;
  /**
   * The main bee_release to create. Note: bee_release requires a
   * manifest row to keep the existing 4.x schema consistent;
   * `bee_input` here carries ONLY the manifest-level fields the
   * service uses. A future slice will swap in the full
   * retainRelease() flow.
   */
  bee_input: BeeCrystallizeInput;
  /**
   * Optional NL reason the LLM authored; surfaced on the
   * loop_bee_relation row (spec §4.6 `reason`).
   */
  bee_relation_reason: string;
  /**
   * The 4-section evidence brief (spec §4.7).
   */
  evidence_brief: EvidenceBrief;
  /** Optional structured bullets (RL-7: counts may support the brief, not replace it). */
  evidence_bullets?: string[];
  /** Source trace pointers for the brief (spec §4.5). */
  source_trace_pointers?: string[];
  /** Optional evaluator summary (independent scorers — spec §4.5). */
  evaluator_summary?: string;
  /** Optional user decision summary (spec §4.5). */
  user_decision_summary?: string;
  /** Trigger classification (spec §5.4). */
  trigger: CrystallizationEventInput["trigger"];
}

/**
 * Minimum bee_release payload the service needs to create a main bee
 * alongside a loop. The full bee_release schema (see
 * `src/services/skillhub/release-retain.ts`) carries manifest rows,
 * segment refs, file rows, etc.; M5 only writes the bee_release header
 * + a single bee_manifest row sufficient to keep the 4.x FK
 * constraints green. Full bee retaining lands in a future slice.
 *
 * Schema definition is hoisted above the interface so the typed
 * interface can reference the inferred Zod type without forward-
 * reference gymnastics.
 */
const BeeNameSchema = z
  .string()
  .trim()
  .min(1, "bee_name is required")
  .max(200)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, {
    message: "bee_name must be kebab-/snake-case starting with a lowercase letter or digit",
  });

const BeeCrystallizeInputSchema = z.object({
  bee_name: BeeNameSchema,
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, {
      message: "version must be a semver string (e.g. 0.1.0)",
    }),
  description: z.string().trim().min(1).max(4000),
  user_intent_raw: z.string().trim().max(4000).optional(),
  parent_version: z.string().trim().max(64).optional(),
  changelog: z.string().trim().max(8000).optional(),
});

export interface BeeCrystallizeInput {
  bee_name: z.infer<typeof BeeNameSchema>;
  version: string;
  description: string;
  user_intent_raw?: string;
  parent_version?: string;
  changelog?: string;
}

/**
 * The crystallization result. The brief is returned AS PERSISTED
 * (re-parsed through the schema) so callers receive the canonical
 * shape, not the loose payload.
 */
export interface CrystallizationResult {
  loop_release_id: string;
  bee_release_id: number;
  loop_bee_relation_id: number;
  crystallization_event_id: string;
  loop_release_lifecycle_status: CrystallizationEventStatus;
}

/**
 * Service interface for the post-run crystallization flow.
 */
export class CrystallizationService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // Idempotent — safe to call on every constructor invocation; the
    // openStateDb pipeline already applied the SQL migration, but a
    // caller-built DB (e.g. tests) needs this.
    ensureCrystallizationEventTable(this.db);
  }

  /**
   * Read a CrystallizationEvent by id.
   */
  read(id: string): CrystallizationEvent | undefined {
    return getCrystallizationEvent(this.db, id);
  }

  /**
   * List events. Filter by lifecycle_status and/or the FK pointer
   * columns. When no filters are supplied, lists ALL events
   * (newest-first).
   */
  list(opts: Parameters<typeof listCrystallizationEvents>[1] = {}) {
    return listCrystallizationEvents(this.db, opts);
  }

  /**
   * Update a crystallization event's lifecycle_status. Always allowed
   * (no schema-version gate). Returns the updated row or undefined if
   * the id is absent.
   *
   * A `stable` transition is the natural post-crystallization state;
   * the service does NOT enforce user-confirmation here (per spec
   * §5.6 promotion happens on a separate `peaks loop promote` path).
   * `retired` is the dispose path (`peaks asset dispose`).
   */
  updateStatus(
    id: string,
    next: CrystallizationEventStatus
  ): CrystallizationEvent | undefined {
    return updateCrystallizationEventStatus(this.db, id, next);
  }

  /**
   * Pre-run gate: throws if any of `task_status`, `gates_passed`,
   * `evidence_collected` is not as required. Called from
   * `crystallize` BEFORE the transaction begins.
   *
   * Reachable as a public method so the CLI / tests can probe the
   * gate in isolation.
   */
  assertReady(task: CrystallizationTaskState): CrystallizationTaskState {
    let parsed: CrystallizationTaskState;
    try {
      parsed = CrystallizationTaskStateSchema.parse(task);
    } catch (err) {
      if (err instanceof ZodError) {
        const findings = err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        }));
        const first = err.issues[0];
        throw new CrystallizationIntegrityError(
          "CRYSTALLIZATION_PRE_RUN",
          `pre-run gate failed: ${first?.message ?? "invalid task state"}`,
          findings
        );
      }
      throw err;
    }
    // Defense in depth — re-assert at the service boundary.
    if (
      parsed.task_status !== "completed" ||
      parsed.gates_passed !== true ||
      parsed.evidence_collected !== true
    ) {
      throw new CrystallizationIntegrityError(
        "CRYSTALLIZATION_PRE_RUN",
        "pre-run gate failed: task must be completed with gates_passed=true AND evidence_collected=true (AC-4 / RL-2)",
        [
          {
            path: "task",
            message:
              "task_status must equal 'completed' and gates_passed and evidence_collected must both be true",
          },
        ]
      );
    }
    return parsed;
  }

  /**
   * Run the post-run crystallization flow.
   *
   * Steps (all in ONE better-sqlite3 transaction, atomic):
   *
   *   1. Pre-run gate (task must be completed / gates_passed /
   *      evidence_collected).
   *   2. Re-validate the 4-section brief (EvidenceBriefSchema.parse,
   *      EvidenceBriefSchema.refine).
   *   3. Insert loop_release.
   *   4. Insert bee_release header (+ a single bee_manifest row to
   *      keep the 4.x FK contract).
   *   5. Insert loop_bee_relation row with role='main'.
   *   6. Insert crystallization_event with the brief persisted.
   *
   * Returns the four ids + the new loop's lifecycle_status. On any
   * failure the transaction is rolled back and the partial rows
   * disappear.
   *
   * Throws:
   *   - CrystallizationIntegrityError(CRYSTALLIZATION_PRE_RUN) on
   *     the pre-run gate.
   *   - BriefSectionError or ZodError if the brief is malformed;
   *     surfaced as
   *     CrystallizationIntegrityError(MISSING_BRIEF_SECTION).
   *   - CrystallizationIntegrityError(CRYSTALLIZATION_TX_FAILED)
   *     on any SQL transaction failure.
   */
  crystallize(payload: CrystallizePayload): CrystallizationResult {
    const task = this.assertReady(payload.task);

    // Re-validate the 4-section brief up-front; the schema refines
    // guard rejects partial briefs. This is the AC-15 / AC-16 / AC-17
    // gate.
    let brief: EvidenceBrief;
    try {
      brief = payload.evidence_brief;
      // Defensive re-parse even though the input is typed; ensures
      // `parse()` runs the .refine() guard.
      EvidenceBriefSchema.parse(brief);
    } catch (err) {
      if (err instanceof ZodError || err instanceof BriefSectionError) {
        const findings =
          err instanceof ZodError
            ? err.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              }))
            : err.findings;
        throw new CrystallizationIntegrityError(
          "MISSING_BRIEF_SECTION",
          "evidence_brief is missing at least one of the 4 required sections (spec §4.7 / RL-7)",
          [...findings]
        );
      }
      throw err;
    }

    // Re-validate loop_input via Zod so a hand-crafted caller input
    // cannot bypass the schema. (M8 dogfood follow-up.)
    const loopRow = LoopReleaseSchema.parse(payload.loop_input);

    // Re-validate bee_input.
    const beeRow = BeeCrystallizeInputSchema.parse(payload.bee_input);

    // Loop-bee relation input (the relation's `reason` is the NL
    // account the LLM authored). We validate the shape WITHOUT
    // bee_release_id (which is filled in by the bee insert below),
    // then validate the final tuple after the SQL writes.
    const relationInputShape = LoopBeeRelationSchema.omit({
      id: true,
      created_at: true,
      bee_release_id: true,
    }).parse({
      loop_release_id: loopRow.id,
      role: "main",
      reason: payload.bee_relation_reason,
    });

    const eventId = newCrystallizationId();
    const eventCreatedAt = new Date().toISOString();

    let loopReleaseId = loopRow.id;
    let beeReleaseId = -1;
    let relationId = -1;
    let eventPersistedId = eventId;

    const tx = this.db.transaction(() => {
      // 1. Insert loop_release.
      insertLoopRelease(this.db, loopRow);

      // 2. Insert bee_release header. The existing
      // `retainRelease` adds segment_ref / file / change rows; the
      // minimal crystallization write here only opens the bee_release
      // header row + a bee_manifest row. Future slices can promote
      // the bee retain path to a richer flow.
      const beeInsert = this.db.prepare(
        `INSERT INTO bee_release (
           bee_name, version, source, archived_at, archived_by,
           user_intent_raw, description, parent_version, changelog,
           shareable, desktop_visible
         ) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, 1, 1)`
      );
      const beeInfo = beeInsert.run(
        beeRow.bee_name,
        beeRow.version,
        eventCreatedAt,
        "llm",
        beeRow.user_intent_raw ?? null,
        beeRow.description,
        beeRow.parent_version ?? null,
        beeRow.changelog ?? null
      );
      beeReleaseId = Number(beeInfo.lastInsertRowid);

      // Update the bee_release_pointer row so the latest version is
      // discoverable via list tooling.
      this.db
        .prepare(
          `INSERT OR REPLACE INTO bee_release_pointer (bee_name, latest_version, released_at) VALUES (?, ?, ?)`
        )
        .run(beeRow.bee_name, beeRow.version, eventCreatedAt);

      // 3. Insert bee_manifest stub. Mirrors `retainRelease` minimum
      // surface: promotion = 'candidate', requires_human = 0,
      // requires_smoke = 0. Min-cycles left NULL.
      this.db
        .prepare(
          `INSERT INTO bee_manifest (
             release_id, schema_version, description, segments_json,
             entrypoint_preamble, promotion, min_cycles,
             requires_human, requires_smoke, retire_on_misses
           ) VALUES (?, ?, ?, '[]', '', 'candidate', NULL, 0, 0, NULL)`
        )
        .run(
          beeReleaseId,
          "peaks.bee/1",
          beeRow.description
        );

      // 4. Insert the loop_bee_relation row (FKs now valid). Re-parse
      // through the input schema so the bee_release_id is validated
      // too — defense in depth. `id` is autoincrement (not in input).
      const fullRelation = LoopBeeRelationSchema.omit({
        id: true,
        created_at: true,
      }).parse({
        loop_release_id: relationInputShape.loop_release_id,
        bee_release_id: beeReleaseId,
        role: relationInputShape.role,
        reason: relationInputShape.reason,
        schema_version: "peaks.loop-bee-relation/1",
      });
      const relationRow = insertLoopBeeRelation(this.db, fullRelation);
      relationId = relationRow.id;

      // 5. Persist the crystallization_event row with the brief inline
      // (the brief is the durable evidence — AC-17).
      const eventInput: CrystallizationEventInput = {
        trigger: payload.trigger,
        evidence_brief: brief,
        evidence_bullets: payload.evidence_bullets ?? [],
        source_trace_pointers: payload.source_trace_pointers ?? [],
        evaluator_summary: payload.evaluator_summary ?? "",
        user_decision_summary: payload.user_decision_summary ?? "",
        created_loop_release_id: loopReleaseId,
        created_bee_release_id: beeReleaseId,
        // updated_* are not set on a CREATE crystallization; they will
        // be set on future UPDATE crystallizations.
        lifecycle_status: "candidate",
      };
      const persisted = insertCrystallizationEventRaw(
        this.db,
        eventInput,
        eventId,
        eventCreatedAt
      );
      eventPersistedId = persisted.id;
    });

    try {
      tx();
    } catch (err) {
      // Map known SQLite constraint errors to friendlier codes; raise
      // CrystallizationIntegrityError so the CLI can render the JSON
      // envelope.
      if (
        err instanceof CrystallizationIntegrityError ||
        err instanceof BriefSectionError
      ) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new CrystallizationIntegrityError(
        "CRYSTALLIZATION_TX_FAILED",
        `crystallization transaction failed: ${message}`,
        [
          {
            path: "tx",
            message:
              "transaction rolled back; verify loop/bee ids are unique and FK targets exist",
          },
        ]
      );
    }

    // Silence the unused-variable lint; the parsed task is the source
    // of truth at the entry boundary.
    void task;

    return {
      loop_release_id: loopReleaseId,
      bee_release_id: beeReleaseId,
      loop_bee_relation_id: relationId,
      crystallization_event_id: eventPersistedId,
      loop_release_lifecycle_status: "candidate",
    };
  }
}

/* ---------------------------------------------------------------------- */
/* Internal: thin writer that injects the deterministic eventId +         */
/*           created_at so the crystallization flow can land all rows in  */
/*           one tx before any non-idempotent residue lands.              */
/* ---------------------------------------------------------------------- */

function insertCrystallizationEventRaw(
  db: Database.Database,
  row: CrystallizationEventInput,
  id: string,
  createdAt: string
): CrystallizationEvent {
  const persisted = CrystallizationEventSchema.parse({
    ...row,
    id,
    schema_version: CRYSTALLIZATION_SCHEMA_VERSION,
    created_at: createdAt,
  }) as CrystallizationEvent;
  const stmt = db.prepare(
    `INSERT INTO crystallization_event (
       id, trigger, evidence_brief_json, evidence_bullets_json,
       source_trace_pointers_json, evaluator_summary,
       user_decision_summary,
       created_loop_release_id, updated_loop_release_id,
       created_bee_release_id, updated_bee_release_id,
       lifecycle_status, schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    persisted.id,
    persisted.trigger,
    JSON.stringify(persisted.evidence_brief),
    JSON.stringify(persisted.evidence_bullets),
    JSON.stringify(persisted.source_trace_pointers),
    persisted.evaluator_summary,
    persisted.user_decision_summary,
    persisted.created_loop_release_id ?? null,
    persisted.updated_loop_release_id ?? null,
    persisted.created_bee_release_id ?? null,
    persisted.updated_bee_release_id ?? null,
    persisted.lifecycle_status,
    persisted.schema_version,
    persisted.created_at
  );
  return persisted;
}
