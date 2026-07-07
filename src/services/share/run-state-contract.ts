/**
 * run-state-contract.ts — locked read-only shape for the desktop
 * client (spec §7A.3 / §10 RL-9).
 *
 * The desktop client observes an in-flight bee through a single
 * JSON file. This module locks the shape so the desktop can render
 * progress without holding a lock on the asset:
 *
 *   {
 *     bee_id:                    string,
 *     status:                    "running" | "paused" | "done" | "failed" | "blocked",
 *     current_step:              string,
 *     started_at:                ISO8601 string,
 *     updated_at:                ISO8601 string,
 *     last_evaluator_verdict:    string | null,
 *     last_user_choice:          string | null
 *   }
 *
 * Hard rules (spec §7A.3):
 *   - The contract is read-only for the desktop client. Only the
 *     running bee (and peaks CLI) may write it.
 *   - The shape is locked — adding a field is a schema-version
 *     bump; removing or renaming a field is a breaking change.
 *
 * This module exposes:
 *   - A Zod schema (`RunStateContractSchema`) that validates the
 *     shape with strict rules (no extra keys, exact enum for
 *     status).
 *   - A type alias (`RunStateContract`).
 *   - A constructor-like factory (for testing / fixtures).
 *
 * It does NOT expose any mutation helpers — there are no setters,
 * because the contract is read-only at the desktop. The running
 * bee writes the file via the existing dispatch flow; the desktop
 * client reads via a separate channel.
 */

import { z } from "zod";

/* ---------------------------------------------------------------------- */
/* Shape contract                                                            */
/* ---------------------------------------------------------------------- */

/**
 * The five status values an in-flight bee may report. The
 * desktop-client UI renders the status badge; only the running bee
 * transitions between them.
 */
export const RUN_STATE_STATUSES = [
  "running",
  "paused",
  "done",
  "failed",
  "blocked",
] as const;
export type RunStateStatus = (typeof RUN_STATE_STATUSES)[number];

/**
 * RunStateContract — the locked read-only shape (spec §7A.3).
 *
 * Notes:
 *   - `bee_id`, `current_step`: non-empty NL strings.
 *   - `started_at`, `updated_at`: ISO8601; updated_at >= started_at
 *     is the caller's job (the schema does not check ordering
 *     because a clock skew between the dispatcher and the receiver
 *     is a transient runtime issue, not a shape invariant).
 *   - `last_evaluator_verdict`: optional NL string; null when no
 *     evaluator has fired yet.
 *   - `last_user_choice`: optional NL choice summary; null when
 *     the user has not made a pick yet.
 *
 * `.strict()` rejects unknown keys — adding a field is a
 * schema-version bump, not a quiet extension.
 */
export const RunStateContractSchema = z
  .object({
    /** Stable bee id (kebab-case). */
    bee_id: z.string().min(1).max(64),
    /** Current run status (running / paused / done / failed / blocked). */
    status: z.enum(RUN_STATE_STATUSES),
    /** Current step name; NL short label. */
    current_step: z.string().min(1).max(256),
    /** ISO8601 timestamp the run started. */
    started_at: z.string().datetime(),
    /** ISO8601 timestamp of the latest update. */
    updated_at: z.string().datetime(),
    /** NL summary of the latest evaluator verdict (or null when none). */
    last_evaluator_verdict: z.string().max(4000).nullable(),
    /** NL summary of the latest user choice (or null when none). */
    last_user_choice: z.string().max(4000).nullable(),
  })
  .strict();
export type RunStateContract = z.infer<typeof RunStateContractSchema>;

/* ---------------------------------------------------------------------- */
/* Validation helpers (read-only at the surface)                              */
/* ---------------------------------------------------------------------- */

/**
 * Strict-parse an unknown value as a RunStateContract. Throws
 * `ZodError` on failure. The desktop client uses this at the read
 * boundary; the running bee writes the file via the existing
 * dispatch flow (separate write path).
 */
export function parseRunStateContract(input: unknown): RunStateContract {
  return RunStateContractSchema.parse(input) as RunStateContract;
}

/**
 * Safe-parse twin — same Result-like envelope shape used elsewhere.
 */
export function safeParseRunStateContract(
  input: unknown
):
  | { ok: true; contract: RunStateContract }
  | { ok: false; findings: Array<{ path: string; message: string }> } {
  const r = RunStateContractSchema.safeParse(input);
  if (r.success) return { ok: true, contract: r.data as RunStateContract };
  return {
    ok: false,
    findings: r.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    })),
  };
}

/* ---------------------------------------------------------------------- */
/* Server-side writer (used by the dispatch flow)                            */
/* ---------------------------------------------------------------------- */

/**
 * Server-side factory used by the dispatch flow to write the file.
 * This helper is exported for testing purposes; the desktop client
 * is read-only and SHOULD NOT call this.
 *
 * The function returns a brand-new `RunStateContract` value; it
 * does NOT mutate any external state. Persistence is the caller's
 * responsibility (the dispatch flow writes a JSON file at a
 * well-known path under `.peaks/_runtime/<sid>/<role>/`).
 */
export function buildRunState(args: {
  bee_id: string;
  status: RunStateStatus;
  current_step: string;
  started_at: string;
  updated_at: string;
  last_evaluator_verdict?: string | null;
  last_user_choice?: string | null;
}): RunStateContract {
  return RunStateContractSchema.parse({
    bee_id: args.bee_id,
    status: args.status,
    current_step: args.current_step,
    started_at: args.started_at,
    updated_at: args.updated_at,
    last_evaluator_verdict: args.last_evaluator_verdict ?? null,
    last_user_choice: args.last_user_choice ?? null,
  }) as RunStateContract;
}
