/**
 * peaks evolution * CLI — M4 / spec §4.4 / §6 / §7.4
 *
 * Adds the Darwin-style ratchet CLI surface:
 *
 *   peaks evolution propose --target <kind:id> --dimension <name> \
 *     --before-score <n> --after-score <n> [--delta-min <n>] \
 *     --author <id> [--brief-pointer <path>] [--project <root>] [--json]
 *   peaks evolution evaluate --proposal <id> \
 *     --evaluator <id> --skeptic <id> \
 *     --evaluator-score <n> [--refute-paragraph <text>] \
 *     [--risk-tag <tag>]... [--brief-pointer <path>] [--project <root>] [--json]
 *   peaks evolution revert --proposal <id> [--user-confirmation <ptr>] [--project <root>] [--json]
 *   peaks evolution status [--target <kind:id>] [--project <root>] [--json]
 *
 * Each verb prints a structured JSON envelope (`printResult` with
 * `asJson=true`). The CLI is a thin shim around EvolutionService +
 * the two runner modules. Author / evaluator / skeptic identities
 * are LLM-supplied; the user is NEVER asked to type them.
 *
 * Defense in depth: the EvolutionService enforces the ratchet
 * rules (AC-8 / AC-10 / AC-11); the CLI only translates flags
 * into the service payload.
 */

import { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { openStateDb } from "../../services/skillhub/sqlite-store.js";
import {
  EvolutionService,
  EvolutionIntegrityError,
} from "../../services/evolution/evolution-service.js";
import {
  type EvolutionProposalInput,
  type EvolutionTargetKind,
  EVOLUTION_TARGET_KINDS,
} from "../../services/evolution/evolution-types.js";
import { findProjectRoot } from "../../services/config/config-safety.js";
import {
  runIndependentEvaluator,
} from "../../services/evolution/independent-evaluator-runner.js";
import {
  runRegressionSkeptic,
} from "../../services/evolution/regression-skeptic-runner.js";
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from "../cli-helpers.js";
import { fail, ok } from "../../shared/result.js";

/**
 * Parse `--target <kind:id>`. Returns the kind + id, or `null` on
 * failure. Validates `kind` against the EVOLUTION_TARGET_KINDS
 * union.
 */
function parseTargetFlag(raw: string): { kind: EvolutionTargetKind; id: string } | null {
  const idx = raw.indexOf(":");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const kind = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!(EVOLUTION_TARGET_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as EvolutionTargetKind, id };
}

export function registerEvolutionCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `evolution` parent if one is registered;
  // otherwise create it. The add-a-new-subcommand-check-for-existing-
  // top-level-first rule requires this guard.
  const existing = program.commands.find((c) => c.name() === "evolution");
  const evolution = existing ?? program.command("evolution").description(
    "Darwin-style ratchet: propose / evaluate / revert / status (spec §6)"
  );

  // peaks evolution propose
  addJsonOption(
    evolution
      .command("propose")
      .description(
        "M4: persist a new evolution proposal. Enforces AC-8 (single object + single dimension). The proposal's verdict starts at 'needs-user-decision' until the scoring + skeptic step lands."
      )
      .requiredOption("--target <kind:id>", "target asset, e.g. 'loop:loop-onboarding-research' or 'bee:42'")
      .requiredOption("--dimension <name>", "single optimization dimension (e.g. 'clarity')")
      .requiredOption("--before-score <n>", "score on the 0..10 scale BEFORE the change")
      .requiredOption("--after-score <n>", "score on the 0..10 scale AFTER the change (LLM-claimed)")
      .option("--delta-min <n>", `minimum score delta for promotion (default: 1.0; spec §6.1 #5)`, "1.0")
      .requiredOption("--author <id>", "author agent id (the LLM proposing the change)")
      .option("--brief-pointer <ptr>", "pointer to the evidence brief used in the recommendation (spec §4.7 / §4.4)")
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: {
      target: string;
      dimension: string;
      beforeScore: string;
      afterScore: string;
      deltaMin: string;
      author: string;
      briefPointer?: string;
      project?: string;
      json?: boolean;
    }) => {
      try {
        const target = parseTargetFlag(options.target);
        if (!target) {
          printResult(
            io,
            fail(
              "evolution.propose",
              "EVOLUTION_INVALID_TARGET",
              `--target must be '<kind>:<id>' where kind ∈ {${EVOLUTION_TARGET_KINDS.join(",")}}`,
              { target: options.target },
              ["Pass --target loop:<loop-id> or --target bee:<bee-id>."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        const before = Number(options.beforeScore);
        const after = Number(options.afterScore);
        const deltaMin = Number(options.deltaMin);
        if (!Number.isFinite(before) || before < 0 || before > 10) {
          printResult(
            io,
            fail(
              "evolution.propose",
              "EVOLUTION_INVALID_BEFORE_SCORE",
              `before_score must be a finite number in [0, 10] (got "${options.beforeScore}")`,
              { beforeScore: options.beforeScore },
              ["Pass a numeric --before-score in [0, 10]."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        if (!Number.isFinite(after) || after < 0 || after > 10) {
          printResult(
            io,
            fail(
              "evolution.propose",
              "EVOLUTION_INVALID_AFTER_SCORE",
              `after_score must be a finite number in [0, 10] (got "${options.afterScore}")`,
              { afterScore: options.afterScore },
              ["Pass a numeric --after-score in [0, 10]."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        if (!Number.isFinite(deltaMin) || deltaMin < 0) {
          printResult(
            io,
            fail(
              "evolution.propose",
              "EVOLUTION_INVALID_DELTA_MIN",
              `delta_min must be a finite number >= 0 (got "${options.deltaMin}")`,
              { deltaMin: options.deltaMin },
              ["Pass a numeric --delta-min >= 0 (default 1.0)."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }

        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          // The CLI is allowed to bootstrap an empty .peaks dir so
          // tests do not need a full peaks project.
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new EvolutionService(db);
          const input: EvolutionProposalInput = {
            target_kind: target.kind,
            target_release_id: target.id,
            optimization_dimension: options.dimension,
            before_snapshot: {},
            after_snapshot: { after_score: after },
            diff: {},
            before_score: before,
            after_score: after,
            score_delta_min: deltaMin,
            author_id: options.author,
            single_object: true,
            single_optimization_dimension: true,
            rubric: {},
            red_lines: [],
            source_traces: [],
          };
          const proposal = svc.createProposal(input);
          printResult(
            io,
            ok(
              "evolution.propose",
              {
                proposal: {
                  id: proposal.id,
                  target_kind: proposal.target_kind,
                  target_release_id: proposal.target_release_id,
                  optimization_dimension: proposal.optimization_dimension,
                  before_score: proposal.before_score,
                  after_score: proposal.after_score,
                  score_delta: proposal.score_delta,
                  score_delta_min: proposal.score_delta_min,
                  author_id: proposal.author_id,
                  verdict: "needs-user-decision",
                  ...(options.briefPointer !== undefined ? { brief_pointer: options.briefPointer } : {}),
                },
                nextActions: [
                  `Run \`peaks evolution evaluate --proposal ${proposal.id} --evaluator <id> --skeptic <id> --evaluator-score <n> --json\` to score the proposal.`,
                ],
              },
              [],
              []
            ),
            options.json
          );
        } finally {
          db.close();
        }
      } catch (err) {
        if (err instanceof EvolutionIntegrityError) {
          printResult(
            io,
            fail(
              "evolution.propose",
              err.code,
              err.message,
              { findings: err.findings },
              [
                "Re-shape the proposal per spec §6: single object, single dimension, separate scorer.",
                "If you intended a multi-object change, split it into multiple rounds.",
              ]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail("evolution.propose", "EVOLUTION_PROPOSE_FAILED", getErrorMessage(err), {}, [
            "Verify the target flag and dimension."
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // peaks evolution evaluate
  addJsonOption(
    evolution
      .command("evaluate")
      .description(
        "M4: score a proposal with an independent evaluator (AC-12/AC-13) and a regression skeptic (AC-14). The result is the FINAL verdict: 'keep' (after user confirmation), 'revert' (skeptic blocker or score delta below threshold), or 'needs-user-decision'."
      )
      .requiredOption("--proposal <id>", "proposal id returned by `peaks evolution propose`")
      .requiredOption("--evaluator <id>", "independent scorer id (MUST differ from --author; AC-10)")
      .requiredOption("--skeptic <id>", "regression skeptic id (MUST differ from --evaluator and --author; AC-12/AC-14)")
      .requiredOption("--evaluator-score <n>", "the independent scorer's score on the 0..10 scale (LLM-derived; NOT the author's after_score)")
      .option("--refute-paragraph <text>", "the independent scorer's one-paragraph refute (LLM-authored)", "")
      .option("--risk-tag <tag>", "add a risk tag emitted by the evaluator (repeatable)", collectRepeatable, [] as string[])
      .option("--brief-pointer <ptr>", "pointer to the evidence brief (spec §4.7 / §4.4)")
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    async (options: {
      proposal: string;
      evaluator: string;
      skeptic: string;
      evaluatorScore: string;
      refuteParagraph?: string;
      riskTag: string[];
      briefPointer?: string;
      project?: string;
      json?: boolean;
    }) => {
      try {
        const score = Number(options.evaluatorScore);
        if (!Number.isFinite(score) || score < 0 || score > 10) {
          printResult(
            io,
            fail(
              "evolution.evaluate",
              "EVOLUTION_INVALID_EVALUATOR_SCORE",
              `evaluator-score must be a finite number in [0, 10] (got "${options.evaluatorScore}")`,
              { evaluatorScore: options.evaluatorScore },
              ["Pass a numeric --evaluator-score in [0, 10]."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new EvolutionService(db);
          const proposal = svc.read(options.proposal);
          if (!proposal) {
            printResult(
              io,
              fail(
                "evolution.evaluate",
                "EVOLUTION_PROPOSAL_NOT_FOUND",
                `proposal '${options.proposal}' not found`,
                { proposalId: options.proposal },
                ["Verify the proposal id and that you have run `peaks evolution propose` first."]
              ),
              options.json
            );
            process.exitCode = 1;
            return;
          }

          // The CLI runs the deterministic LLM stubs (no live LLM in
          // M4). Real LLM wiring lands in M5.
          const evaluatorResult = await runIndependentEvaluator(proposal.proposal);
          // Force the CLI-supplied --evaluator-score to be the
          // final score; the LLM stub's score is informational.
          evaluatorResult.score = score;
          if (options.refuteParagraph && options.refuteParagraph.length > 0) {
            evaluatorResult.refuteParagraph = options.refuteParagraph;
          }
          if (Array.isArray(options.riskTag) && options.riskTag.length > 0) {
            evaluatorResult.riskTags = [
              ...evaluatorResult.riskTags,
              ...options.riskTag,
            ];
          }

          const evaluation = svc.score(options.proposal, {
            evaluator_id: options.evaluator,
            skeptic_id: options.skeptic,
            evaluator_result: evaluatorResult,
            skeptic_result: {
              driftRisks: [],
              overfitRisks: [],
              safetyRegressionRisks: [],
            },
            ...(options.briefPointer !== undefined ? { brief_pointer: options.briefPointer } : {}),
          });
          printResult(
            io,
            ok(
              "evolution.evaluate",
              {
                proposalId: evaluation.id,
                verdict: evaluation.verdict,
                evaluator_id: evaluation.evaluator_id,
                skeptic_id: evaluation.skeptic_id,
                evaluator_result: evaluation.evaluator_result,
                skeptic_result: evaluation.skeptic_result,
                score_delta: evaluation.proposal.score_delta,
                score_delta_min: evaluation.proposal.score_delta_min,
                after_score: evaluation.proposal.after_score,
                nextActions:
                  evaluation.verdict === "needs-user-decision"
                    ? [
                        `User confirmation required. Run \`peaks evolution mark-keep --proposal ${evaluation.id} --user-confirmation <ptr> --json\` after the user picks "keep", OR \`peaks evolution revert --proposal ${evaluation.id} --json\`.`,
                      ]
                    : evaluation.verdict === "revert"
                      ? [
                          "Proposal reverted. Investigate the skeptic blocker or the score delta below threshold.",
                        ]
                      : [
                          "Proposal kept. The target asset remains unchanged on disk; full promotion lands in a later slice.",
                        ],
              },
              [],
              []
            ),
            options.json
          );
          if (evaluation.verdict === "revert") process.exitCode = 1;
        } finally {
          db.close();
        }
      } catch (err) {
        if (err instanceof EvolutionIntegrityError) {
          printResult(
            io,
            fail(
              "evolution.evaluate",
              err.code,
              err.message,
              { findings: err.findings },
              [
                "Re-shape per spec §6: evaluator and skeptic MUST be separate from the author; the score delta MUST be >= score_delta_min for keep.",
              ]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail("evolution.evaluate", "EVOLUTION_EVALUATE_FAILED", getErrorMessage(err), { proposalId: options.proposal }, [
            "Verify the proposal id and the evaluator / skeptic ids.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // peaks evolution mark-keep — explicit user confirmation.
  addJsonOption(
    evolution
      .command("mark-keep")
      .description(
        "M4: explicit user-confirmed `keep` verdict. Requires --user-confirmation <ptr> and a score_delta >= score_delta_min (AC-11/AC-15)."
      )
      .requiredOption("--proposal <id>", "proposal id")
      .option("--user-confirmation <ptr>", "pointer to the user choice record (AC-15) — omit to surface the EVOLUTION_MISSING_USER_CONFIRMATION service-layer error")
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: { proposal: string; userConfirmation: string; project?: string; json?: boolean }) => {
      try {
        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new EvolutionService(db);
          const updated = svc.markVerdict(options.proposal, "keep", options.userConfirmation);
          if (!updated) {
            printResult(
              io,
              fail(
                "evolution.mark-keep",
                "EVOLUTION_PROPOSAL_NOT_FOUND",
                `proposal '${options.proposal}' not found`,
                { proposalId: options.proposal },
                ["Verify the proposal id."]
              ),
              options.json
            );
            process.exitCode = 1;
            return;
          }
          printResult(
            io,
            ok("evolution.mark-keep", {
              proposalId: updated.id,
              verdict: updated.verdict,
              user_confirmation_pointer: updated.user_confirmation_pointer ?? null,
              score_delta: updated.proposal.score_delta,
              score_delta_min: updated.proposal.score_delta_min,
            }, [], []),
            options.json
          );
        } finally {
          db.close();
        }
      } catch (err) {
        if (err instanceof EvolutionIntegrityError) {
          printResult(
            io,
            fail("evolution.mark-keep", err.code, err.message, { findings: err.findings }, [
              "Re-shape the proposal or the score so score_delta >= score_delta_min.",
            ]),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail("evolution.mark-keep", "EVOLUTION_MARK_KEEP_FAILED", getErrorMessage(err), { proposalId: options.proposal }, [
            "Verify the proposal id.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // peaks evolution revert
  addJsonOption(
    evolution
      .command("revert")
      .description(
        "M4: revert a proposal (universal recovery; spec §6.1 #8). Always allowed; the user may supply --user-confirmation for audit."
      )
      .requiredOption("--proposal <id>", "proposal id")
      .option("--user-confirmation <ptr>", "optional pointer to the user choice record")
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: { proposal: string; userConfirmation?: string; project?: string; json?: boolean }) => {
      try {
        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new EvolutionService(db);
          const updated = svc.revert(
            options.proposal,
            options.userConfirmation
          );
          if (!updated) {
            printResult(
              io,
              fail(
                "evolution.revert",
                "EVOLUTION_PROPOSAL_NOT_FOUND",
                `proposal '${options.proposal}' not found`,
                { proposalId: options.proposal },
                ["Verify the proposal id."]
              ),
              options.json
            );
            process.exitCode = 1;
            return;
          }
          printResult(
            io,
            ok("evolution.revert", {
              proposalId: updated.id,
              verdict: updated.verdict,
              user_confirmation_pointer: updated.user_confirmation_pointer ?? null,
            }, [], []),
            options.json
          );
        } finally {
          db.close();
        }
      } catch (err) {
        printResult(
          io,
          fail("evolution.revert", "EVOLUTION_REVERT_FAILED", getErrorMessage(err), { proposalId: options.proposal }, [
            "Verify the proposal id.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // peaks evolution status
  addJsonOption(
    evolution
      .command("status")
      .description(
        "M4: read the status snapshot for a target (counts of evaluations by verdict + latest evaluation id)."
      )
      .requiredOption("--target <kind:id>", "target asset, e.g. 'loop:loop-onboarding-research'")
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: { target: string; project?: string; json?: boolean }) => {
      try {
        const target = parseTargetFlag(options.target);
        if (!target) {
          printResult(
            io,
            fail(
              "evolution.status",
              "EVOLUTION_INVALID_TARGET",
              `--target must be '<kind>:<id>' where kind ∈ {${EVOLUTION_TARGET_KINDS.join(",")}}`,
              { target: options.target },
              ["Pass --target loop:<loop-id> or --target bee:<bee-id>."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new EvolutionService(db);
          const status = svc.status({
            target_kind: target.kind,
            target_release_id: target.id,
          });
          printResult(
            io,
            ok("evolution.status", status, [], []),
            options.json
          );
        } finally {
          db.close();
        }
      } catch (err) {
        printResult(
          io,
          fail("evolution.status", "EVOLUTION_STATUS_FAILED", getErrorMessage(err), { target: options.target }, [
            "Verify the target flag.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // Suppress unused-var warnings for the dirname import; it is
  // reserved for the M5 path-pointer materialization.
  void dirname;
}

/**
 * Helper: collect repeatable `--risk-tag` values into an array.
 * Commander's `collect` is not always available; we read
 * `previous` from the default value.
 */
function collectRepeatable(value: string, previous: string[]): string[] {
  if (Array.isArray(previous)) return [...previous, value];
  return [value];
}
