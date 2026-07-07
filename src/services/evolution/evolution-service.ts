import type Database from "better-sqlite3";
import { ZodError } from "zod";
import {
  EvolutionEvaluationSchema,
  EvolutionProposalInputSchema,
  EvolutionProposalSchema,
  EVOLUTION_DEFAULT_DELTA_MIN,
  type EvolutionEvaluation,
  type EvolutionEvaluationInput,
  type EvolutionProposal,
  type EvolutionProposalInput,
  type EvolutionTargetKind,
  type EvolutionVerdict,
} from "./evolution-types.js";
import {
  buildProposal,
  computeScoreDelta,
  ensureEvolutionEvaluationTable,
  getEvolutionEvaluation,
  insertEvolutionEvaluation,
  listEvolutionEvaluationsByTarget,
  newEvaluationId,
  updateEvolutionVerdict,
} from "./evolution-store.js";

/**
 * EvolutionService — Darwin-style ratchet enforcement.
 *
 * Hard rules enforced at THIS layer (not just the Zod schema) so
 * the ratchet cannot be bypassed by a malformed input:
 *
 *   - AC-8:  exactly one target (target_count === 1) AND
 *            exactly one optimization dimension per round.
 *            Code:  EVOLUTION_MULTI_OBJECT, EVOLUTION_MULTI_DIMENSION.
 *   - AC-10: the scorer (evaluator) MUST NOT be the author.
 *            Code:  EVOLUTION_SELF_SCORE.
 *   - AC-11: a `keep` verdict is BLOCKED when
 *            score_delta < score_delta_min (default 1.0).
 *            Code:  EVOLUTION_DELTA_BELOW_THRESHOLD.
 *   - AC-12: evaluator_id MUST be a separate agent from
 *            author_id and skeptic_id.
 *   - AC-14: skeptic_id MUST be a separate agent from
 *            author_id and evaluator_id.
 *
 * The service is intentionally narrow: createProposal / score /
 * markVerdict / list / get. The actual scoring agents
 * (IndependentEvaluatorRunner, RegressionSkepticRunner) live in
 * separate files so the author reasoning is NEVER imported into
 * the evaluator's process boundary.
 */

/* ---------------------------------------------------------------------- */
/* Domain error                                                            */
/* ---------------------------------------------------------------------- */

export type EvolutionIntegrityErrorCode =
  | "EVOLUTION_MULTI_OBJECT"
  | "EVOLUTION_MULTI_DIMENSION"
  | "EVOLUTION_SELF_SCORE"
  | "EVOLUTION_DELTA_BELOW_THRESHOLD"
  | "EVOLUTION_MISSING_USER_CONFIRMATION"
  | "EVOLUTION_BELOW_RUBRIC";

export class EvolutionIntegrityError extends Error {
  readonly code: EvolutionIntegrityErrorCode;
  readonly findings: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    code: EvolutionIntegrityErrorCode,
    message: string,
    findings: ReadonlyArray<{ path: string; message: string }> = []
  ) {
    super(message);
    this.name = "EvolutionIntegrityError";
    this.code = code;
    this.findings = findings;
  }
}

/* ---------------------------------------------------------------------- */
/* Service                                                                 */
/* ---------------------------------------------------------------------- */

export class EvolutionService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    // Idempotent — safe to call on every constructor invocation; the
    // openStateDb pipeline already applied the SQL migration, but a
    // caller-built DB (e.g. tests) needs this.
    ensureEvolutionEvaluationTable(this.db);
  }

  /**
   * Persist a new EvolutionProposal. Enforces AC-8 (single object /
   * single dimension) BEFORE writing the row.
   *
   * The proposal id is auto-generated (`eval-<hex>`); callers supply
   * the proposal content only. The proposal's `verdict` is set to
   * `needs-user-decision` until the score + skeptic step lands.
   *
   * Throws:
   *   - ZodError if the input fails schema validation.
   *   - EvolutionIntegrityError(EVOLUTION_MULTI_OBJECT) if
   *     single_object !== true.
   *   - EvolutionIntegrityError(EVOLUTION_MULTI_DIMENSION) if
   *     single_optimization_dimension !== true.
   */
  createProposal(input: EvolutionProposalInput): EvolutionProposal {
    // Parse with the input schema first (so we get defaults applied).
    // The input schema already enforces `single_object: literal(true)`
    // and `single_optimization_dimension: literal(true)`; we map
    // the ZodError to EvolutionIntegrityError so the CLI / tests
    // can assert on a single error code.
    let parsedInput: EvolutionProposalInput;
    try {
      parsedInput =
        EvolutionProposalInputSchema.parse(input) as EvolutionProposalInput;
    } catch (err) {
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        if (issue?.path[0] === "single_object") {
          throw new EvolutionIntegrityError(
            "EVOLUTION_MULTI_OBJECT",
            "proposal must target exactly one object (single_object=true); split multi-object changes into multiple rounds",
            [
              {
                path: "single_object",
                message: issue.message,
              },
            ]
          );
        }
        if (issue?.path[0] === "single_optimization_dimension") {
          throw new EvolutionIntegrityError(
            "EVOLUTION_MULTI_DIMENSION",
            "proposal must declare exactly one optimization dimension (single_optimization_dimension=true); split multi-dimension changes into multiple rounds",
            [
              {
                path: "single_optimization_dimension",
                message: issue.message,
              },
            ]
          );
        }
      }
      throw err;
    }

    // AC-8 defense in depth: in case a future schema version relaxes
    // the literal(true), still enforce at the service boundary.
    if (parsedInput.single_object !== true) {
      throw new EvolutionIntegrityError(
        "EVOLUTION_MULTI_OBJECT",
        "proposal must target exactly one object (single_object=true); split multi-object changes into multiple rounds",
        [{ path: "single_object", message: "must be true (AC-8)" }]
      );
    }
    if (parsedInput.single_optimization_dimension !== true) {
      throw new EvolutionIntegrityError(
        "EVOLUTION_MULTI_DIMENSION",
        "proposal must declare exactly one optimization dimension (single_optimization_dimension=true); split multi-dimension changes into multiple rounds",
        [
          {
            path: "single_optimization_dimension",
            message: "must be true (AC-8)",
          },
        ]
      );
    }

    const id = newEvaluationId();
    const proposal = buildProposal(id, parsedInput);
    // Persist a stub evaluation row with verdict='needs-user-decision';
    // the actual scoring happens in `score()` below.
    const stub: EvolutionEvaluationInput = {
      id,
      proposal,
      evaluator_id: "pending",
      skeptic_id: "pending",
      evaluator_result: { score: parsedInput.before_score, riskTags: [], refuteParagraph: "pending" },
      skeptic_result: {
        driftRisks: [],
        overfitRisks: [],
        safetyRegressionRisks: [],
      },
      verdict: "needs-user-decision",
      schema_version: "peaks.evolution/1",
      created_at: proposal.created_at,
    };
    insertEvolutionEvaluation(this.db, stub);
    return proposal;
  }

  /**
   * Score an existing proposal. Enforces AC-10 (no self-score:
   * `evaluator_id !== proposal.author_id`) and AC-11 (delta
   * threshold: cannot mark `keep` when `score_delta <
   * score_delta_min`).
   *
   * Returns the FINAL evaluation row with verdict derived from the
   * evaluator + skeptic results:
   *   - `verdict = 'revert'` if the skeptic returned a blocker.
   *   - `verdict = 'revert'` if the score delta is below threshold.
   *   - `verdict = 'needs-user-decision'` otherwise; the CLI
   *     (`peaks evolution evaluate`) surfaces this to the user for
   *     a `keep` / `revert` choice.
   *
   * Throws:
   *   - EvolutionIntegrityError(EVOLUTION_SELF_SCORE) if
   *     evaluator_id === proposal.author_id.
   *   - EvolutionIntegrityError(EVOLUTION_DELTA_BELOW_THRESHOLD) if
   *     a `verdict = 'keep'` is requested and the delta is below
   *     the proposal's `score_delta_min`.
   */
  score(
    proposalId: string,
    args: {
      evaluator_id: string;
      skeptic_id: string;
      evaluator_result: import("./evolution-types.js").IndependentEvaluatorResult;
      skeptic_result: import("./evolution-types.js").RegressionSkepticResult;
      brief_pointer?: string;
      user_confirmation_pointer?: string;
    }
  ): EvolutionEvaluation {
    const existing = getEvolutionEvaluation(this.db, proposalId);
    if (!existing) {
      throw new EvolutionIntegrityError(
        "EVOLUTION_BELOW_RUBRIC",
        `evolution_evaluation row '${proposalId}' not found`,
        [{ path: "id", message: "row not found" }]
      );
    }

    // AC-10: scorer MUST NOT be the author.
    if (args.evaluator_id === existing.proposal.author_id) {
      throw new EvolutionIntegrityError(
        "EVOLUTION_SELF_SCORE",
        `evaluator_id '${args.evaluator_id}' equals author_id '${existing.proposal.author_id}'; self-scoring is forbidden (AC-10)`,
        [{ path: "evaluator_id", message: "must differ from author_id" }]
      );
    }
    // AC-12 / AC-14: skeptic and evaluator are SEPARATE agents.
    if (args.skeptic_id === existing.proposal.author_id) {
      throw new EvolutionIntegrityError(
        "EVOLUTION_SELF_SCORE",
        `skeptic_id '${args.skeptic_id}' equals author_id '${existing.proposal.author_id}'; the skeptic must be a separate agent (AC-14)`,
        [{ path: "skeptic_id", message: "must differ from author_id" }]
      );
    }
    if (args.skeptic_id === args.evaluator_id) {
      throw new EvolutionIntegrityError(
        "EVOLUTION_SELF_SCORE",
        `skeptic_id '${args.skeptic_id}' equals evaluator_id '${args.evaluator_id}'; the skeptic must be a separate agent from the evaluator (AC-12/AC-14)`,
        [{ path: "skeptic_id", message: "must differ from evaluator_id" }]
      );
    }

    const after_score = args.evaluator_result.score;
    const score_delta = computeScoreDelta(
      existing.proposal.before_score,
      after_score
    );
    const min = existing.proposal.score_delta_min;

    // Derive verdict. The skeptic's `blocker` is a hard revert.
    let verdict: EvolutionVerdict = "needs-user-decision";
    if (args.skeptic_result.blocker !== undefined) {
      verdict = "revert";
    } else if (score_delta < min) {
      verdict = "revert";
    }

    const next: EvolutionEvaluationInput = {
      id: existing.id,
      proposal: {
        ...existing.proposal,
        after_score,
        score_delta,
      },
      evaluator_id: args.evaluator_id,
      skeptic_id: args.skeptic_id,
      evaluator_result: args.evaluator_result,
      skeptic_result: args.skeptic_result,
      verdict,
      ...(args.brief_pointer !== undefined ? { brief_pointer: args.brief_pointer } : {}),
      ...(args.user_confirmation_pointer !== undefined
        ? { user_confirmation_pointer: args.user_confirmation_pointer }
        : {}),
      schema_version: "peaks.evolution/1",
      created_at: new Date().toISOString(),
    };

    // AC-11 (delta threshold) explicit guard: if the caller
    // explicitly asks to mark `keep` but delta < min, throw.
    if (verdict === "needs-user-decision" && score_delta < min) {
      // The auto-derivation already pinned verdict to `revert`; the
      // guard is for the explicit `markVerdict('keep')` path below.
    }

    // Re-validate before persisting.
    const validated = EvolutionEvaluationSchema.parse({
      ...next,
      score_delta,
    }) as EvolutionEvaluation;

    // Delete + re-insert keeps the row simple; volume is tiny.
    this.db
      .prepare("DELETE FROM evolution_evaluation WHERE id = ?")
      .run(existing.id);
    insertEvolutionEvaluation(this.db, validated);
    return validated;
  }

  /**
   * Mark a verdict explicitly (after the user has confirmed via
   * natural-language or a pick). Enforces:
   *   - AC-11: cannot mark `keep` when score_delta <
   *     score_delta_min.
   *   - AC-15: `keep` requires a user_confirmation_pointer.
   *
   * Throws:
   *   - EvolutionIntegrityError(EVOLUTION_DELTA_BELOW_THRESHOLD)
   *     when `verdict = 'keep'` and the delta is below threshold.
   *   - EvolutionIntegrityError(EVOLUTION_MISSING_USER_CONFIRMATION)
   *     when `verdict = 'keep'` and no user_confirmation_pointer
   *     is supplied.
   */
  markVerdict(
    proposalId: string,
    verdict: EvolutionVerdict,
    userConfirmationPointer?: string
  ): EvolutionEvaluation | undefined {
    const existing = getEvolutionEvaluation(this.db, proposalId);
    if (!existing) return undefined;

    if (verdict === "keep") {
      if (existing.proposal.score_delta < existing.proposal.score_delta_min) {
        throw new EvolutionIntegrityError(
          "EVOLUTION_DELTA_BELOW_THRESHOLD",
          `score_delta ${existing.proposal.score_delta} is below score_delta_min ${existing.proposal.score_delta_min}; cannot mark keep (AC-11)`,
          [
            {
              path: "verdict",
              message:
                "score_delta below score_delta_min; revert instead or raise the score",
            },
          ]
        );
      }
      if (
        userConfirmationPointer === undefined ||
        userConfirmationPointer.trim().length === 0
      ) {
        throw new EvolutionIntegrityError(
          "EVOLUTION_MISSING_USER_CONFIRMATION",
          "marking verdict='keep' requires a user_confirmation_pointer (AC-15)",
          [
            {
              path: "user_confirmation_pointer",
              message: "required for verdict='keep'",
            },
          ]
        );
      }
    }

    return updateEvolutionVerdict(
      this.db,
      proposalId,
      verdict,
      userConfirmationPointer
    );
  }

  /** Revert a proposal (universal recovery). Always allowed. */
  revert(
    proposalId: string,
    userConfirmationPointer?: string
  ): EvolutionEvaluation | undefined {
    return updateEvolutionVerdict(
      this.db,
      proposalId,
      "revert",
      userConfirmationPointer
    );
  }

  /** Read an evolution evaluation by id. */
  read(proposalId: string): EvolutionEvaluation | undefined {
    return getEvolutionEvaluation(this.db, proposalId);
  }

  /** List evaluations for a given target. */
  listByTarget(opts: {
    target_kind: EvolutionTargetKind;
    target_release_id: string;
    verdict?: EvolutionVerdict;
  }): EvolutionEvaluation[] {
    return listEvolutionEvaluationsByTarget(this.db, opts);
  }

  /**
   * Status snapshot for `peaks evolution status`. Returns counts of
   * evaluations by verdict for the given target, plus the latest
   * evaluation id (if any).
   */
  status(target: {
    target_kind: EvolutionTargetKind;
    target_release_id: string;
  }): {
    target_kind: EvolutionTargetKind;
    target_release_id: string;
    total: number;
    byVerdict: Record<EvolutionVerdict, number>;
    latest: EvolutionEvaluation | undefined;
  } {
    const all = listEvolutionEvaluationsByTarget(this.db, {
      target_kind: target.target_kind,
      target_release_id: target.target_release_id,
    });
    const byVerdict: Record<EvolutionVerdict, number> = {
      keep: 0,
      revert: 0,
      "needs-user-decision": 0,
    };
    for (const row of all) byVerdict[row.verdict] += 1;
    const latest = all.length > 0 ? all[0] : undefined;
    return {
      target_kind: target.target_kind,
      target_release_id: target.target_release_id,
      total: all.length,
      byVerdict,
      latest,
    };
  }
}

/**
 * Convenience: re-export the Zod error guard.
 */
export function isZodError(err: unknown): err is ZodError {
  return err instanceof ZodError;
}

/**
 * Convenience: get the default `score_delta_min` from the spec.
 */
export { EVOLUTION_DEFAULT_DELTA_MIN };
