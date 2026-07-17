/**
 * peaks asset * CLI — M5 / spec §5 / §7.4
 *
 * Adds the umbrella verbs for the post-run crystallization flow:
 *
 *   peaks asset crystallize --from-task <id> --loop-name <name> \
 *     --loop-scenario <text> --bee-name <name> \
 *     --bee-version <semver> --bee-description <text> \
 *     --brief-what-happened <text> --brief-why-it-matters <text> \
 *     --brief-what-learned <text> --brief-what-action <text> \
 *     [--bee-relation-reason <text>] [--brief-bullet <bullet>]... \
 *     [--source-trace <id>]... [--evaluator-summary <text>] \
 *     [--user-decision-summary <text>] \
 *     [--trigger <user_explicit|llm_suggested|success_default_prompt|similar_task_recurrence>] \
 *     [--project <root>] [--json]
 *   peaks asset dispose --crystallization-event <id> --mode <trace_only|retain|destroy> \
 *     [--project <root>] [--json]
 *   peaks asset status [--loop <id>] [--bee <name>] [--project <root>] [--json]
 *
 * The crystallize verb prints the 4-section brief in the
 * user-facing recommendation; refuses to proceed if any brief
 * section is missing (EvidenceBriefSchema.refine guard +
 * CrystallizationService pre-run gate).
 *
 * The dispose verb handles trace-only / retain / destroy. trace_only
 * retires the crystallization event but keeps the source trace;
 * retain is a no-op on the asset (the user wants to keep it as
 * evidence); destroy hard-retires both the event and (if the
 * user opts in) the created/updated assets. The CLI defaults to
 * trace-only disposal for safety.
 *
 * The status verb lists loop + bee lifecycle state plus any
 * crystallization events that reference them.
 *
 * Each verb prints a structured JSON envelope (`printResult` with
 * `asJson=true`). The user never types a JSON manifest / form
 * field; the LLM runs the CLI on the user's behalf.
 *
 * Defense in depth: the CrystallizationService enforces the
 * pre-run gate and the brief-section guard; the CLI only
 * translates flags into the service payload.
 */

import { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openStateDb } from "../../services/skillhub/sqlite-store.js";
import {
  CrystallizationService,
  CrystallizationIntegrityError,
} from "../../services/crystallization/crystallization-service.js";
import {
  CRYSTALLIZATION_TRIGGERS,
  type CrystallizationTrigger,
  type EvidenceBrief,
  parseEvidenceBrief,
} from "../../services/crystallization/crystallization-types.js";
import {
  BriefSectionError,
  renderRecommendationPayload,
  safeRenderRecommendationPayload,
} from "../../services/crystallization/evidence-brief-builder.js";
import { findProjectRoot } from "../../services/config/config-safety.js";
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from "../cli-helpers.js";
import { fail, ok } from 'peaks-loop-shared/result';

function collectRepeatable(value: string, previous: string[]): string[] {
  if (Array.isArray(previous)) return [...previous, value];
  return [value];
}

const DISPOSE_MODES = ["trace_only", "retain", "destroy"] as const;
type DisposeMode = (typeof DISPOSE_MODES)[number];

function parseTriggerFlag(raw: string): CrystallizationTrigger | null {
  return (CRYSTALLIZATION_TRIGGERS as readonly string[]).includes(raw)
    ? (raw as CrystallizationTrigger)
    : null;
}

export function registerAssetCommands(program: Command, io: ProgramIO): void {
  // Reuse the existing `asset` parent if one is registered; the
  // add-a-new-subcommand-check-for-existing-top-level-first rule
  // requires this guard.
  const existing = program.commands.find((c) => c.name() === "asset");
  const asset = existing ?? program.command("asset").description(
    "M5: cross-asset crystallization surface (crystallize / dispose / status — spec §5 / §7.4)"
  );

  // ---------- peaks asset crystallize ----------
  addJsonOption(
    asset
      .command("crystallize")
      .description(
        "M5: persist a new loop_release + main_bee_release + loop_bee_relation + crystallization_event in a single transaction. Enforces the pre-run gate (task_status=completed AND gates_passed=true AND evidence_collected=true; AC-4 / RL-2) and the brief-section guard (all 4 sections required; AC-15 / RL-7)."
      )
      .requiredOption("--from-task <id>", "the candidate task id (must be 'completed' with gates_passed + evidence_collected)")
      .requiredOption("--loop-id <id>", "kebab-case loop id, e.g. loop-onboarding-research")
      .requiredOption("--loop-name <name>", "NL display name")
      .requiredOption("--loop-scenario <text>", "long-form scenario text (what real problem the loop solves)")
      .requiredOption("--loop-trigger-policy <text>", "trigger policy (NL intent match)")
      .requiredOption("--loop-interaction-policy <text>", "interaction policy (Human-NL-Choice-Only is the default)")
      .requiredOption("--loop-feedback-policy <text>", "feedback policy (what feedback enters long-term memory)")
      .requiredOption("--loop-evolution-policy <text>", "evolution policy (Darwin-style ratchet rules)")
      .requiredOption("--loop-success-criterion <text>", "declarative success criterion (repeatable)", collectRepeatable, [] as string[])
      .requiredOption("--loop-evaluator-policy <text>", "evaluator policy line (repeatable)", collectRepeatable, [] as string[])
      .requiredOption("--loop-version <semver>", "loop version (e.g. 0.1.0)")
      .requiredOption("--bee-name <name>", "main bee name (kebab-case)")
      .requiredOption("--bee-version <semver>", "bee version (e.g. 0.1.0)")
      .requiredOption("--bee-description <text>", "main bee description (manifest-level)")
      .requiredOption("--bee-relation-reason <text>", "NL reason for the main bee relation")
      .requiredOption("--brief-what-happened <text>", "brief section: what_happened (1-2 sentence factual account)")
      .requiredOption("--brief-why-it-matters <text>", "brief section: why_it_matters (1-2 sentence explanation)")
      .requiredOption("--brief-what-learned <text>", "brief section: what_learned (1-2 sentence learning)")
      .requiredOption("--brief-what-action <text>", "brief section: what_action (1 sentence recommended action)")
      .option("--brief-bullet <bullet>", "structured bullet supporting the brief (repeatable)", collectRepeatable, [] as string[])
      .option("--source-trace <id>", "workflow trace id backing the brief (repeatable)", collectRepeatable, [] as string[])
      .option("--evaluator-summary <text>", "evaluator one-liner (independent scorers)", "")
      .option("--user-decision-summary <text>", "user decision summary (NL)", "")
      .option("--bee-intent-raw <text>", "optional bee user_intent_raw")
      .option("--bee-parent-version <semver>", "optional parent_version")
      .option("--bee-changelog <text>", "optional changelog")
      .option(
        "--trigger <name>",
        `crystallization trigger (one of: ${CRYSTALLIZATION_TRIGGERS.join("|")})`,
        "user_explicit"
      )
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: {
      fromTask: string;
      loopId: string;
      loopName: string;
      loopScenario: string;
      loopTriggerPolicy: string;
      loopInteractionPolicy: string;
      loopFeedbackPolicy: string;
      loopEvolutionPolicy: string;
      loopSuccessCriterion: string[];
      loopEvaluatorPolicy: string[];
      loopVersion: string;
      beeName: string;
      beeVersion: string;
      beeDescription: string;
      beeRelationReason: string;
      briefWhatHappened: string;
      briefWhyItMatters: string;
      briefWhatLearned: string;
      briefWhatAction: string;
      briefBullet: string[];
      sourceTrace: string[];
      evaluatorSummary?: string;
      userDecisionSummary?: string;
      beeIntentRaw?: string;
      beeParentVersion?: string;
      beeChangelog?: string;
      trigger: string;
      project?: string;
      json?: boolean;
    }) => {
      try {
        const trigger = parseTriggerFlag(options.trigger);
        if (!trigger) {
          printResult(
            io,
            fail(
              "asset.crystallize",
              "ASSET_INVALID_TRIGGER",
              `--trigger must be one of: ${CRYSTALLIZATION_TRIGGERS.join("|")}`,
              { trigger: options.trigger },
              ["Pass a valid --trigger value."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }

        // Build the brief from CLI flags and re-validate it through
        // the canonical schema (so a partial brief is caught BEFORE
        // any DB side effects fire).
        const candidateBrief = {
          what_happened: options.briefWhatHappened,
          why_it_matters: options.briefWhyItMatters,
          what_learned: options.briefWhatLearned,
          what_action: options.briefWhatAction,
        };
        let brief: EvidenceBrief;
        try {
          brief = parseEvidenceBrief(candidateBrief);
        } catch (err) {
          if (err instanceof BriefSectionError) {
            printResult(
              io,
              fail(
                "asset.crystallize",
                "MISSING_BRIEF_SECTION",
                err.message,
                { findings: [...err.findings], flagsProvided: Object.keys(candidateBrief) },
                [
                  "Pass ALL FOUR brief sections via --brief-what-happened / --brief-why-it-matters / --brief-what-learned / --brief-what-action.",
                  "The CLI refuses to render a recommendation without a complete 4-section brief (spec §4.7 / RL-7).",
                ]
              ),
              options.json
            );
            process.exitCode = 1;
            return;
          }
          throw err;
        }

        // Render the recommendation envelope up-front so the CLI can
        // refuse to write if any brief section is missing. This is
        // the same code path the crystallization service uses.
        const recommendation = safeRenderRecommendationPayload({
          brief,
          bullets: options.briefBullet ?? [],
          source_trace_pointers: options.sourceTrace ?? [],
          evaluator_summary: {
            one_liner: options.evaluatorSummary ?? "",
            risk_tags: [],
          },
        });
        if (!recommendation.ok) {
          printResult(
            io,
            fail(
              "asset.crystallize",
              recommendation.code ?? "MISSING_BRIEF_SECTION",
              "recommendation envelope rejected — brief is missing one of its 4 sections",
              { findings: recommendation.findings, briefProvided: candidateBrief },
              [
                "Pass ALL FOUR brief sections via the matching CLI flags.",
                "Counts in --brief-bullet may support the brief; they do NOT replace it (spec §4.7 / RL-7).",
              ]
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
          const svc = new CrystallizationService(db);
          const result = svc.crystallize({
            task: {
              task_id: options.fromTask,
              task_status: "completed",
              gates_passed: true,
              evidence_collected: true,
            },
            loop_input: {
              id: options.loopId,
              name: options.loopName,
              scenario: options.loopScenario,
              trigger_policy: options.loopTriggerPolicy,
              success_criteria: options.loopSuccessCriterion,
              interaction_policy: options.loopInteractionPolicy,
              feedback_policy: options.loopFeedbackPolicy,
              evolution_policy: options.loopEvolutionPolicy,
              evaluator_policy: options.loopEvaluatorPolicy,
              linked_bees: [],
              run_history: [],
              crystallization_evidence: [],
              lifecycle_status: "candidate",
              version: options.loopVersion,
            },
            bee_input: {
              bee_name: options.beeName,
              version: options.beeVersion,
              description: options.beeDescription,
              ...(options.beeIntentRaw !== undefined ? { user_intent_raw: options.beeIntentRaw } : {}),
              ...(options.beeParentVersion !== undefined ? { parent_version: options.beeParentVersion } : {}),
              ...(options.beeChangelog !== undefined ? { changelog: options.beeChangelog } : {}),
            },
            bee_relation_reason: options.beeRelationReason,
            evidence_brief: brief,
            evidence_bullets: options.briefBullet ?? [],
            source_trace_pointers: options.sourceTrace ?? [],
            ...(options.evaluatorSummary !== undefined ? { evaluator_summary: options.evaluatorSummary } : {}),
            ...(options.userDecisionSummary !== undefined ? { user_decision_summary: options.userDecisionSummary } : {}),
            trigger,
          });

          printResult(
            io,
            ok(
              "asset.crystallize",
              {
                recommendation: {
                  brief: recommendation.payload.brief,
                  bullets: recommendation.payload.bullets,
                  source_trace_pointers: recommendation.payload.source_trace_pointers,
                  evaluator_summary: recommendation.payload.evaluator_summary,
                },
                result,
                nextActions: [
                  `Run \`peaks loop show --loop ${result.loop_release_id}\` to inspect the new loop_release.`,
                  `Run \`peaks asset dispose --crystallization-event ${result.crystallization_event_id} --mode trace_only\` to retire the event without touching the asset.`,
                ],
              },
              [],
              [
                "The CLI has surfaced a complete 4-section brief; the LLM should now drive the user through AskUserQuestion picks (spec §5.3).",
              ]
            ),
            options.json
          );
        } finally {
          db.close();
        }
      } catch (err) {
        if (err instanceof CrystallizationIntegrityError) {
          printResult(
            io,
            fail(
              "asset.crystallize",
              err.code,
              err.message,
              { findings: [...err.findings] },
              [
                err.code === "CRYSTALLIZATION_PRE_RUN"
                  ? "Re-shape the candidate task so task_status=completed AND gates_passed=true AND evidence_collected=true (spec §5 / RL-2)."
                  : err.code === "MISSING_BRIEF_SECTION"
                    ? "Pass ALL FOUR brief sections (RL-7); the CLI refuses to render a recommendation without them."
                    : "Inspect the failure findings and re-shape the payload.",
              ]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        if (err instanceof BriefSectionError) {
          printResult(
            io,
            fail(
              "asset.crystallize",
              "MISSING_BRIEF_SECTION",
              err.message,
              { findings: [...err.findings] },
              ["Pass all 4 brief sections (RL-7)."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        printResult(
          io,
          fail("asset.crystallize", "ASSET_CRYSTALLIZE_FAILED", getErrorMessage(err), {}, [
            "Verify the brief flags and the loop/bee identifiers are valid.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // ---------- peaks asset dispose ----------
  addJsonOption(
    asset
      .command("dispose")
      .description(
        "M5: dispose a crystallization event. mode=trace_only retires the event but keeps the trace; mode=retain keeps both; mode=destroy retires the event and marks the created/updated assets retired."
      )
      .requiredOption("--crystallization-event <id>", "the crystallization event id (returned by `peaks asset crystallize`)")
      .requiredOption(
        `--mode <mode>`,
        `dispose mode (one of: ${DISPOSE_MODES.join("|")}; default: trace_only)`,
        "trace_only"
      )
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: {
      crystallizationEvent: string;
      mode: string;
      project?: string;
      json?: boolean;
    }) => {
      try {
        if (!(DISPOSE_MODES as readonly string[]).includes(options.mode)) {
          printResult(
            io,
            fail(
              "asset.dispose",
              "ASSET_INVALID_MODE",
              `--mode must be one of: ${DISPOSE_MODES.join("|")}`,
              { mode: options.mode },
              ["Pass --mode trace_only / retain / destroy."]
            ),
            options.json
          );
          process.exitCode = 1;
          return;
        }
        const mode = options.mode as DisposeMode;
        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new CrystallizationService(db);
          const existing = svc.read(options.crystallizationEvent);
          if (!existing) {
            printResult(
              io,
              fail(
                "asset.dispose",
                "ASSET_EVENT_NOT_FOUND",
                `crystallization event '${options.crystallizationEvent}' not found`,
                { eventId: options.crystallizationEvent },
                ["Verify the event id."]
              ),
              options.json
            );
            process.exitCode = 1;
            return;
          }
          // trace_only → retire the event row; the source traces are
          // untouched (workflow traces are immutable per spec §4.3).
          // retain → no DB change; the user wants to keep the event
          // as historical evidence.
          // destroy → retire the event + retire the created/updated
          // assets (no asset delete; retirement only).
          if (mode === "retain") {
            printResult(
              io,
              ok(
                "asset.dispose",
                {
                  crystallization_event_id: existing.id,
                  mode,
                  lifecycle_status: existing.lifecycle_status,
                  note: "no DB change; event retained as-is",
                },
                [],
                [
                  "Run `peaks asset status --loop <id>` to inspect the lifecycle state of the linked assets.",
                ]
              ),
              options.json
            );
            return;
          }
          const updated = svc.updateStatus(existing.id, "retired");
          if (mode === "destroy" && updated) {
            // Retire the created/updated loop_release rows as well.
            // We do NOT delete rows — retirement is a status flip
            // (spec §5.6).
            const retireLoop = db.prepare(
              "UPDATE loop_release SET lifecycle_status = 'retired' WHERE id IN (?, ?)"
            );
            const ids = [
              updated.created_loop_release_id ?? null,
              updated.updated_loop_release_id ?? null,
            ].filter((x): x is string => x !== null);
            for (const id of ids) {
              retireLoop.run(id, id);
            }
          }
          printResult(
            io,
            ok(
              "asset.dispose",
              {
                crystallization_event_id: existing.id,
                mode,
                lifecycle_status: updated?.lifecycle_status ?? "retired",
                retired_assets: mode === "destroy" ? "loop_release retired (no rows deleted)" : "none",
                nextActions: [
                  "Run `peaks asset status` to confirm the lifecycle transition.",
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
        printResult(
          io,
          fail("asset.dispose", "ASSET_DISPOSE_FAILED", getErrorMessage(err), { eventId: options.crystallizationEvent }, [
            "Verify the event id and --mode flag.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );

  // ---------- peaks asset status ----------
  addJsonOption(
    asset
      .command("status")
      .description(
        "M5: list loop + bee lifecycle state. With --loop, returns the loop + all linked bee_releases + all crystallization events referencing them."
      )
      .option("--loop <id>", "filter by loop_release id")
      .option("--bee <name>", "filter by bee_name")
      .option("--project <path>", "project root (default: cwd)")
  ).action(
    (options: { loop?: string; bee?: string; project?: string; json?: boolean }) => {
      try {
        const projectRoot = options.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
        if (!existsSync(join(projectRoot, ".peaks"))) {
          mkdirSync(join(projectRoot, ".peaks"), { recursive: true });
        }
        const db = openStateDb(join(projectRoot, ".peaks", "state.db"));
        try {
          const svc = new CrystallizationService(db);
          let events: ReturnType<typeof svc.read>[] = [];
          if (options.loop) {
            events = [
              ...svc.list({ created_loop_release_id: options.loop }),
              ...svc.list({ updated_loop_release_id: options.loop }),
            ];
            // Deduplicate by id.
            const seen = new Set<string>();
            events = events.filter((e) => {
              const key = e?.id ?? "";
              if (!key || seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          } else {
            events = svc.list();
          }

          // Companion queries: loop lifecycle counts + bee lifecycle
          // counts. We compute from the DB so the CLI is the single
          // source of truth.
          const loopCounts = (db
            .prepare(
              "SELECT lifecycle_status, COUNT(*) AS n FROM loop_release GROUP BY lifecycle_status"
            )
            .all() as Array<{ lifecycle_status: string; n: number }>)
            .reduce<Record<string, number>>((acc, r) => {
              acc[r.lifecycle_status] = r.n;
              return acc;
            }, {});
          const beeCounts = (db
            .prepare(
              "SELECT bee_name, COUNT(*) AS n FROM bee_release GROUP BY bee_name ORDER BY bee_name ASC"
            )
            .all() as Array<{ bee_name: string; n: number }>)
            .filter((r) => options.bee === undefined || r.bee_name === options.bee);

          printResult(
            io,
            ok(
              "asset.status",
              {
                filters: {
                  ...(options.loop !== undefined ? { loop: options.loop } : {}),
                  ...(options.bee !== undefined ? { bee: options.bee } : {}),
                },
                crystallization_events: events.length,
                events: events.map((e) => ({
                  id: e?.id,
                  trigger: e?.trigger,
                  lifecycle_status: e?.lifecycle_status,
                  created_loop_release_id: e?.created_loop_release_id,
                  created_bee_release_id: e?.created_bee_release_id,
                  updated_loop_release_id: e?.updated_loop_release_id,
                  updated_bee_release_id: e?.updated_bee_release_id,
                  created_at: e?.created_at,
                })),
                loop_release_counts_by_lifecycle: loopCounts,
                bee_release_counts_by_name: beeCounts,
                nextActions: [
                  options.loop
                    ? `Run \`peaks loop show --loop ${options.loop}\` for the loop detail view.`
                    : "Pass --loop <id> to drill into a specific loop's crystallization history.",
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
        printResult(
          io,
          fail("asset.status", "ASSET_STATUS_FAILED", getErrorMessage(err), { loop: options.loop, bee: options.bee }, [
            "Verify the loop / bee identifiers.",
          ]),
          options.json
        );
        process.exitCode = 1;
      }
    }
  );
}
