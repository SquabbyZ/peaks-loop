# Loop Engineering Crystallization: from "sediment workflow / bee" to a Self-evolving Method System

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-07
**Author:** SquabbyZ (via peaks-code brainstorm session 2026-07-07-session-2af05f)
**Affects:** `peaks-loop` product positioning, `peaks skill sediment *` CLI surface, SkillHub schema, peaks-maker skill, peaks-code & future peaks-* domain skills, `.peaks/standards/`, `.peaks/memory/`
**Target version:** 4.x (post-4.0.0-beta.2)
**Inherits from:** `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` (4.x sediment pool), `docs/adr/0007-peaks-workflow-primitive.md` (now demoted to trace mechanism), `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` (long-task loop)
**External references (advisory, not normative):**
- https://github.com/alchaincyf/darwin-skill — ratchet-style independent-context evaluation
- https://github.com/multica-ai/andrej-karpathy-skills — guideline engineering methodology

---

## 0. Project tenet — Loop Engineering is the first-class product

Per user directive 2026-07-07 (synthesized across clarifying rounds): **peaks-loop's product is the user's *Loop Engineering*, not the user's workflows or skill files.** This tenet governs all wording in this spec and every future slice that touches crystallization / evolution.

### 0.1 New product definition

```text
peaks-loop crystallizes Loop Engineering assets from real, completed work,
and evolves them only through verified improvements. The user operates the
system through natural language and choices; the LLM performs every
structured action.
```

In Chinese:

> **peaks-loop 从真实完成的工作中结晶 Loop Engineering 资产，并只通过被验证的改进让其进化。用户只用自然语言和选择操作系统；所有结构化操作由 LLM 代办。**

### 0.2 Why the current product reads as "workflow, not loop engineering"

| Symptom | Root cause |
|---|---|
| README says "loop engineering" but only `peaks-code` ships | There is no `loop release` asset; only `bee release` |
| "Sediment" framing = saving artifacts | The actionable unit is `workflow`, not a method system |
| `peaks-workflow` (ADR 0007) is positioned as the durable asset | It is actually an execution trace, not a method system |
| 4.x sediment spec centers on `bee` | Loop and bee roles are not separated |
| Evolution is "LLM proposes, user accepts" | No independent-context evaluator; recommendation can be self-reinforcing |
| Recommendations lean on count-only evidence | The user cannot tell what the change is and ends up auto-accepting the model-recommended option |

### 0.3 What "loop engineering" means here

A Loop Engineering asset answers:

1. *Why does this loop exist?* — scenario / intent.
2. *When does it fire?* — trigger policy (NL intent match, not keywords).
3. *How does it know it ran well?* — success criteria + evaluators.
4. *What did we learn?* — feedback policy + memory.
5. *How does it improve?* — evolution policy (Darwin-style ratchet, with karpathy-style engineering of the rules).
6. *Which bees does it call or create?* — linked bees (main + supporting + retired).

Workflow traces are the *evidence* these answers are built on; they are not the durable product.

### 0.4 Domain boundary — peaks-code is one bee, not the orchestrator-of-everything

`peaks-code` is the **code-domain** long-task orchestrator. It is not a general-purpose orchestrator and will not be widened into one. Other domains (research, content, product, medical, …) are first-class `peaks-*` skills that **reuse the Loop Engineering primitives** in this spec. They are **not** subclasses of `peaks-code`. New peaks-* skills must import the Loop Engineering guidelines defined in §8.

### 0.5 Layered external references (advisory, never replace each other)

| Layer | Source library | Role in peaks-loop |
|---|---|---|
| Methodology layer | `multica-ai/andrej-karpathy-skills` | How principles are *engineered* — failure-mode table, imperative→declarative rewrite, self-check questions, out-of-scope rules |
| Execution layer | `alchaincyf/darwin-skill` | How improvements are *verified* — single editable asset, single optimization dimension, independent-context evaluator, regression skeptic, ratchet (only keep verified improvements) |

These two layers are **complementary, not substitutable**. karpathy-style engineering is required to write the rules; darwin-style evaluation is required to enforce them. Removing either layer causes drift:

- karpathy-only → well-written principles that drift because nothing verifies them.
- darwin-only → enforced scores on principles that were never clearly defined.
- karpathy-as-darwin-prereq → false sense of security (ratchet still self-scores).
- darwin-as-karpathy-postcheck → token form without substance.

This relationship is locked as a project red line; see §10 RL-0.

---

## 1. Problem statement

### 1.1 Symptom

After multiple release cycles (4.0.0-beta.x), peaks-loop's product narrative is "loop engineering" but its durable artifacts are:

- 4.x sediment pool: bee-first, with workflow as the implicit aggregation.
- peaks-workflow (ADR 0007): positioned as a captureable asset, but architecturally a replay trace.
- peaks-code: the only orchestrator, and code-domain only.
- evolution: implicit, through the LLM proposing and the user accepting — with no independent evaluation.

A user asking "沉淀下来的是 workflow 还是 loop engineering?" cannot be answered with the current product surface. The user's own judgment — "looks like workflow, not loop engineering" — is correct.

### 1.2 Root cause

The product is missing four pillars that "loop engineering" implies:

1. **No Loop Engineering asset.** The product writes `bee_release` and treats bee as the method system. Loop is implicit.
2. **No post-run crystallization contract.** Successful runs save traces, not method systems. The user is not asked "did this become a loop?" in a structured way.
3. **No anti-drift evolution mechanism.** Improvements are accepted on user trust, not on independent evaluation.
4. **No engineering-of-principles.** Principles like "Human-NL-Choice-Only" are slogans, not engineered rules with failure modes, rewrites, and self-checks.

### 1.3 Why bolting on a "loop" label is not enough

Naming a `loop_release` table does not produce a loop engineering product. The pillars above must all be present; otherwise the new label is a re-skin of the same product. This spec designs all four together.

---

## 2. Goals & non-goals

### 2.1 Goals (priority order)

1. **Loop Engineering is the first-class asset.** SkillHub stores `loop_release`, `bee_release`, their relation, evolution evaluation, and crystallization events. The user thinks in loops; the system stores the loop + its bees.
2. **Bee is a first-class executable body, demoted from "the product".** A bee is the runtime body of one or more loops. Loops own bees, not the reverse.
3. **Workflow trace is evidence, not asset.** Traces are immutable records that *feed* crystallization and evolution; they are not the durable product.
4. **Post-run crystallization is the only entry into durable change.** Loops and bees are created or updated only after a real task completes. Pre-run proposals are scratch-only.
5. **Independent-context evaluation is mandatory for evolution.** The agent that proposes a change cannot be the agent that scores it.
6. **Karpathy-style engineering of all principles.** Every red line and every Loop Engineering rule is written as failure modes + rewrite + self-check + out-of-scope, not as a slogan.
7. **Darwin-style ratchet is mandatory for evolution.** Only verified improvements (single editable asset, single dimension, before/after, evaluator + skeptic, score-delta threshold) are kept; regressions revert.
8. **Evidence Brief is mandatory for every user-facing recommendation.** Counts may support the brief, never replace it.
9. **Human-NL-Choice-Only applies to Loop Engineering assets, not just CLI usage.** The user creates, updates, accepts, rejects, promotes, clones, and retires loops/bees only through natural language or choices; the LLM performs all structured operations.
10. **peaks-code stays code-domain-only.** Non-code domains ship as new peaks-* skills that import this spec's Loop Engineering primitives.

### 2.2 Non-goals

- A general-purpose peaks-* orchestrator. peaks-code is code-domain; other domains are separate skills.
- Replacing LangGraph / Temporal / Inngest / n8n. The product's differentiator remains gate-first + loop engineering crystallization.
- Auto-publishing to a public SkillHub. This slice is local-only.
- Auto-evolving without user confirmation for any durable behavior change.
- Self-scored evolution.
- Count-only evidence.
- Migrating historical `rd/tech-doc.md`, `peaks-workflow.yaml`, or other 4.x-byproducts in this slice. They remain readable; demotion is by narrative + new conventions, not by migration.
- A visual loop editor.
- A loop marketplace.

---

## 3. Architecture — four-layer asset model

```
┌──────────────────────────────────────────────────────────────────────┐
│ LLM Runtime (Claude Code / Codex / Copilot / …)                      │
│   - sees one peaks-* skill at a time (current peaks-code, future     │
│     peaks-research, peaks-content, peaks-product, …)                  │
│   - all peaks-* skills import the same Loop Engineering primitives    │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [1] Loop Engineering Asset  (method system, first-class)             │
│   - scenario, trigger policy, success criteria                       │
│   - feedback policy, evolution policy (darwin + karpathy rules)       │
│   - linked bees, run history, crystallization evidence               │
└──────────────────────────────────────────────────────────────────────┘
                                  │ owns / links
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [2] Bee Asset  (executable body, first-class)                        │
│   - manifest, prompt envelope, segments, gates, evaluators            │
│   - input/output contract, run-state, release version                 │
│   - lifecycle: candidate / stable / retired                          │
└──────────────────────────────────────────────────────────────────────┘
                                  │ produces
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [3] Workflow Trace  (evidence, NOT the durable product)              │
│   - immutable per-run record                                         │
│   - feeds crystallization + evaluation + debugging                    │
│   - retainable, shareable, replayable — but not the main asset       │
└──────────────────────────────────────────────────────────────────────┘
                                  │ scored by
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│ [4] Evolution Evaluation  (anti-drift gate, mandatory for change)     │
│   - target asset + single optimization dimension                     │
│   - before/after snapshots + score delta                             │
│   - independent scorer + regression skeptic + user confirmation       │
└──────────────────────────────────────────────────────────────────────┘
```

Storage: SkillHub continues to use 6+ relation tables + content-addressed blobs; we add `loop_release`, `loop_bee_relation`, `evolution_evaluation`, `crystallization_event`, and an `evidence_brief` projection on top of existing tables. No big JSON BLOB; no schema-only rename.

---

## 4. Asset model — schema semantics (informational, not code)

### 4.1 Loop Engineering Asset

| Field | Meaning |
|---|---|
| `id` | Stable loop id (kebab-case) |
| `name` | Display name, NL-friendly |
| `scenario` | Long-form intent — what real problem this loop solves |
| `trigger_policy` | NL intent match: when should this loop fire |
| `success_criteria` | Declarative criteria the loop self-verifies |
| `interaction_policy` | Hard rule: human-NL-choice-only for this loop |
| `feedback_policy` | What feedback enters long-term memory |
| `evolution_policy` | Darwin-style ratchet rules; karpathy-engineered |
| `evaluator_policy` | Which independent evaluators may score this loop's evolution |
| `linked_bees` | Main bee, supporting bees, retired bees |
| `run_history` | Pointers to workflow traces, not inlined |
| `crystallization_evidence` | Pointers to crystallization events |
| `lifecycle_status` | `candidate` / `stable` / `retired` |
| `version` | semver |
| `schema_version` | `peaks.loop/1` |

### 4.2 Bee Asset

| Field | Meaning |
|---|---|
| `id` | Stable bee id |
| `name` | Display name |
| `source` | `system` / `user` |
| `owning_loop` | The loop that owns this bee (may be many-to-one) |
| `manifest` | The vendor-neutral envelope (unchanged) |
| `prompt_envelope` | Bee's preamble + refs handed to LLM at activate |
| `segments` | Bound segment refs |
| `gates` | Per-phase gate set |
| `evaluators` | Per-phase evaluator set |
| `input_contract` | What the bee consumes |
| `output_contract` | What the bee produces |
| `risk_profile` | `low` / `medium` / `high` — gates further safety rules |
| `run_state` | Latest cycle result snapshot |
| `lifecycle_status` | `candidate` / `stable` / `retired` |
| `version` | semver |
| `schema_version` | `peaks.bee/1` |

### 4.3 Workflow Trace (demoted)

| Field | Meaning |
|---|---|
| `id` | Trace id |
| `goal` | User's NL goal |
| `phase_sequence` | Actual executed sequence (segments / bees / gates) |
| `artifacts` | Produced artifacts |
| `gate_results` | All gate verdicts |
| `evaluator_results` | All evaluator verdicts |
| `failure_repair_history` | Failure → repair → verification chain |
| `user_choices` | User picks during the run |
| `final_outcome` | `success` / `failed` / `blocked` |
| `immutable` | `true` — traces never mutate; corrections land as new traces |

### 4.4 Evolution Evaluation (new)

| Field | Meaning |
|---|---|
| `id` | Eval id |
| `target_kind` | `loop` / `bee` / `policy` / `gate` / `evaluator` |
| `target_release_id` | Pointer to the asset under change |
| `optimization_dimension` | Single declared dimension |
| `before_snapshot` | Asset state before change |
| `after_snapshot` | Asset state after change |
| `diff` | Computed diff |
| `independent_scorer_verdict` | Scorer-only output |
| `regression_skeptic_verdict` | Skeptic-only output (find drift / overfit / safety regression) |
| `score_delta` | Numeric delta, per-dimension |
| `keep_or_revert` | `keep` / `revert` / `needs-user-decision` |
| `user_confirmation_pointer` | Trace to user choice |
| `evidence_brief_pointer` | The brief used in the recommendation |
| `schema_version` | `peaks.evolution/1` |

### 4.5 Crystallization Event (new)

| Field | Meaning |
|---|---|
| `id` | Event id |
| `trigger` | `user_explicit` / `llm_suggested` / `success_default_prompt` / `similar_task_recurrence` |
| `evidence_brief` | Natural-language brief (mandatory, see §8) |
| `evidence_bullets` | Structured summary |
| `source_trace_pointers` | Workflow trace ids |
| `evaluator_summary` | Short summary from independent scorers (if applicable) |
| `user_decision_summary` | What the user chose and why |
| `created_loop_release_id` | If a loop was created |
| `updated_loop_release_id` | If a loop was updated |
| `created_bee_release_id` | If a bee was created |
| `updated_bee_release_id` | If a bee was updated |
| `schema_version` | `peaks.crystallization/1` |

### 4.6 Loop–Bee Relation

| Field | Meaning |
|---|---|
| `loop_release_id` | FK to loop |
| `bee_release_id` | FK to bee |
| `role` | `main` / `supporting` / `candidate` / `retired` |
| `reason` | NL-readable reason (machine-derived, LLM-authored) |
| `created_at` | ISO 8601 |

### 4.7 Evidence Brief (cross-cutting)

| Section | Required content |
|---|---|
| `what_happened` | 1–2 sentence factual account of the run |
| `why_it_matters` | 1–2 sentence explanation of why this is worth promoting |
| `what_learned` | 1–2 sentence learning — failure modes encoded, preferences extracted |
| `what_action` | 1 sentence recommended action with rationale |
| `source_traces` | Trace pointers backing the brief |
| `evaluator_summary` | One-liner per independent evaluator |

The brief is mandatory in every recommendation. Counts (4 phases, 3 gates, …) may appear in `evidence_bullets` but never replace the brief. See §10 RL-7.

---

## 5. Lifecycle — post-run crystallization

### 5.1 Pre-run: scratch only

Before the run completes, the system:

- may recognize user intent and match an existing loop,
- may compose a scratch execution path,
- may create a candidate / scratch bee,
- **may NOT** create a stable loop, a stable bee, or a SkillHub release.

Rationale: pre-run reasoning cannot know which steps are durable. Crystallization requires evidence that only post-run states produce.

### 5.2 During run: evidence collection

The system continuously accumulates:

- Execution evidence (phases, segments, gates, evaluators fired).
- Quality evidence (gate verdicts, evaluator verdicts, final review verdict).
- Human evidence (user choices, confirmed preferences, rejected recommendations).
- Reuse evidence (named scenario, expected next trigger, expected next reduction in user input).

This evidence lands in the workflow trace; nothing is promoted to long-term memory mid-run.

### 5.3 Post-run: crystallization review

The system surfaces a structured crystallization prompt to the user, in natural language:

```text
This run produced: <one-sentence summary>.
Reuse signal: <counts> <names>.
Independent view: <one-liner from scorer / skeptic>.

What would you like to do?
A. Create a new loop + main bee (recommended)
B. Update an existing loop
C. Keep this trace only
D. Discard
```

Each option must come with an evidence brief (per §4.7 and §8). The user may also describe a different intent in NL; the LLM must translate that into a declared action (no free-form CLI).

### 5.4 Triggers — four are supported, none is required

| Trigger | Priority | Required conditions |
|---|---|---|
| `user_explicit` (NL "沉淀这个" / "复用这个" / "创建一条 loop") | Highest | None — fires immediately |
| `llm_suggested` (with evidence brief) | High | Must pass: ≥ 2 reuse signals, named scenario, ≥ 1 failure-repair or preference extraction, expected user-input reduction |
| `success_default_prompt` (lightweight prompt in handoff) | Low | Always available, never auto-defaults to "create" |
| `similar_task_recurrence` (2nd–3rd run of similar shape) | Medium | Requires ≥ 2 similar traces; brief must show similarity and divergence |

A run may trigger multiple paths; the system resolves by priority order. The user is the final decider for any durable behavior change.

### 5.5 Crystallization writes

When the user picks create / update:

1. Write `loop_release` (if new) or update existing loop release with a new version.
2. Write `main_bee_release` (if new) or update existing bee release with a new version.
3. Write `loop_bee_relation` rows.
4. Write `crystallization_event` with evidence brief + user decision summary.
5. Do **not** rewrite or "improve" any other loop / bee in the same operation.

### 5.6 Promotion ladder

| Status | Promotion condition |
|---|---|
| `candidate` | Default after first crystallization |
| `stable` | ≥ N cycles (default 2) AND ≥ 1 independent evaluation per cycle AND user explicit promotion AND no regression skeptic blocker in last cycle |
| `retired` | User explicit retirement OR auto-retire threshold triggered (e.g. `retire_on_misses_in_row`) |

LLMs cannot auto-promote to `stable`; user confirmation is required.

---

## 6. Evolution mechanism — Darwin-style ratchet (enforced)

### 6.1 Hard rules

1. **Single editable asset per round.** Exactly one of: `loop_release`, `bee_release`, `policy`, `gate_definition`, `evaluator_definition`.
2. **Single optimization dimension per round.** One declared dimension; multiple dimensions require multiple rounds.
3. **Independent-context evaluation.** The author agent cannot be the scorer. The scorer cannot be the final approver.
4. **Regression skeptic.** A separate agent attempts to refute the proposal: find drift, overfit, safety regression, prompt inflation, gate weakening.
5. **Score delta threshold.** Default `1.0` per dimension. Below threshold → cannot promote.
6. **User confirmation.** Any durable behavior change requires user NL or pick.
7. **No self-scored evolution.** Self-evaluation may be recorded as rationale, never as approval evidence.
8. **Revert is always available.** `peaks evolution revert` is the universal recovery; `git revert` is preserved for source-repo level changes.

### 6.2 Evaluation package (the only input the evaluator sees)

```text
{
  target_kind, target_release_id,
  optimization_dimension,
  before_snapshot, after_snapshot, diff,
  rubric, red_lines, source_traces,
  // EXCLUDED: author self-praise, "推荐A" framing, full author reasoning
}
```

The author and the main session may not be read by the scorer.

### 6.3 Minimum evaluation team

| Role | Required? | Notes |
|---|---|---|
| Author agent | required | Submits proposal |
| Independent scorer | required | Context-isolated, reads evaluation package only |
| Regression skeptic | required | Independent context; refutes proposal |
| Main orchestrator | required | Aggregates evidence; presents to user in NL |

### 6.4 Out-of-scope for ratchet

- Hotfixes that fix a single broken gate. These go through micro-cycle, not ratchet.
- User explicit "rewrite this" requests — these go through a single evolution round with dimension `full_rewrite`, score delta must be ≥ 3, and a regression skeptic must explicitly bless.
- Same-target-same-dimension within 7 days. Blocked; user must re-scope or wait.

---

## 7. SkillHub upgrade — local Loop & Bee Asset Pool

### 7.1 Storage philosophy preserved

- 6+ relation tables, content-addressed `blobs/` sidecar.
- No big JSON BLOB.
- Migration is schema-versioned; existing 4.x `bee_release` rows continue to read.

### 7.2 New tables

- `loop_release` (§4.1)
- `loop_bee_relation` (§4.6)
- `evolution_evaluation` (§4.4)
- `crystallization_event` (§4.5)

### 7.3 New indexes

- `loop_release.lifecycle_status`
- `loop_release.scenario` (full-text)
- `bee_release.owning_loop`
- `evolution_evaluation.target_release_id`
- `crystallization_event.created_loop_release_id`

### 7.4 CLI surface

#### Preserve

- `peaks skill sediment add-segment`
- `peaks skill sediment add-bee`
- `peaks skill sediment list / show / search / recent`
- `peaks skill sediment export / import`
- `peaks skill sediment clone-bee / refine-bee`
- `peaks skill adapter ...`

#### New

- `peaks loop init / list / show / search / recent`
- `peaks loop crystallize --from-trace <id>` (LLM-driven; user confirmation mandatory)
- `peaks loop promote --loop <id>` (user-driven)
- `peaks loop retire --loop <id>` (user-driven)
- `peaks evolution propose --target <kind:id> --dimension <name>`
- `peaks evolution evaluate --proposal <id>` (independent-context evaluator)
- `peaks evolution revert --proposal <id>`
- `peaks asset crystallize` (umbrella verb for cross-asset crystallization)
- `peaks asset dispose` (umbrella verb for trace-only / retain / destroy)
- `peaks asset status` (loop + bee lifecycle dashboard)

#### Demote

- `peaks skill sediment dispose` is replaced by `peaks asset dispose`; the old verb remains as an alias for one release cycle with deprecation warning.

### 7.5 peaks-maker re-positioning

peaks-maker is renamed narratively from "bee sediment gatekeeper" to:

> **Loop crystallizer + Bee creator + Evolution gatekeeper.**

peaks-maker still does not write application code; it only:

- reads crystallization evidence,
- drives the user through NL choices,
- invokes `peaks loop *` / `peaks evolution *` / `peaks asset *` on the user's behalf,
- enforces Darwin-style ratchet and karpathy-engineered red lines.

### 7.6 peaks-workflow (ADR 0007) demoted

`peaks-workflow.yaml` is **demoted to execution trace mechanism**, not durable asset. ADR 0007 is updated to add a §"v3 demotion" section stating:

- The workflow file remains as a replay skeleton and evidence source.
- It is no longer the user-facing asset.
- It is not the recommendation target.

The existing `peaks workflow run / graph / lint` surface continues to function; the user-facing verb is reframed as "replay this run" not "create a new asset".

---

## 8. Karpathy-style engineering of all principles

Every red line in §10 is written in the following 4-section form. Below is the template and the karpathy-style rewrite tables for crystallization (§8.1) and self-evolution (§8.2). The other red lines are in §10; they all follow the same form.

### 8.0 Template

```text
# <Red Line name>
## Failure modes   — what drift this rule prevents
## Imperative → declarative rewrite   — how user NL becomes a system-checkable condition
## Self-check questions   — questions to ask before writing the change
## Out-of-scope   — when this rule does not apply
```

### 8.1 Crystallization — karpathy-style engineering

#### Failure modes (crystallization)

| # | Drift | Symptom |
|---|---|---|
| 1 | Run-once-as-loop | First success becomes a permanent loop; second run fails |
| 2 | Failure-as-no-loop | One failure retires a perfectly reusable loop |
| 3 | Recommendation-as-decision | System's recommendation = user's choice; no independent view |
| 4 | Numbers-as-evidence | Recommendation shows only counts; user can't decide |
| 5 | User-as-decider | All decisions dumped on user without evidence brief |
| 6 | One-shot-as-loop | Ad-hoc task promoted to a loop |
| 7 | Loop-as-one-shot | A loop run as a one-off, killing reuse |
| 8 | Trace-as-asset | Workflow trace crystallized as the durable product |
| 9 | Bee-as-loop | Bee treated as the method system |

#### Imperative → declarative rewrite (crystallization)

| User NL | Declarative condition |
|---|---|
| "沉淀这个" | `intent=crystallize, trigger=post_run, evidence=required, user_choice=create_or_update_or_no, durable_change=requires_confirmation` |
| "下次按这个来" | `intent=promote, scope=loop, validation=ratchet_pass, user_confirmation=required, single_dimension=true` |
| "再跑一次这个" | `intent=replay, source=trace_pointer, isolation=scratch_only, no_release_writes` |
| "这个不要" | `intent=discard, scope=trace_only, no_durable_change, no_asset_creation` |
| "把论文日报改成只看 oncology" | `intent=clone_or_refine, target=existing_loop_or_bee, evidence_required=true, evaluator_isolation=required` |
| "跑跑看" | `intent=scratch, durable_change=forbidden, evaluator_run=on_completion` |

#### Self-check questions (crystallization)

1. Is this asset derived from a real completed run, or pre-imagined?
2. Does the evidence brief let the user actually decide, not just accept?
3. Does this write pollute long-term memory?
4. Am I treating a trace as the main asset?
5. Am I treating a bee as the loop?
6. Is the user-facing recommendation backed by an evidence brief + an independent evaluator?

#### Out-of-scope (crystallization)

- User explicitly says "不要沉淀".
- Task not completed (gate/evaluator failed, blocked).
- Same loop/bee crystallized within 24h (avoid chained drift).

### 8.2 Self-evolution — karpathy-style engineering

#### Failure modes (evolution)

| # | Drift | Symptom |
|---|---|---|
| 1 | Multi-object edit | One change touches loop + bee + gate + prompt; cause/effect lost |
| 2 | Multi-dimension edit | "Optimize everything" without a single verifiable dimension |
| 3 | Self-scored evolution | Author = evaluator; scoring biases toward keep |
| 4 | Recommendation-induced choice | "推荐A" framing controls the user |
| 5 | Inflated scores | Score system gamed; no independent refuter |
| 6 | Failure-not-encoded | Failures logged but not promoted to asset → next time repeats |
| 7 | Over-eager evolution | Frequent promote → loop never stabilizes |
| 8 | Over-slow evolution | Forever `candidate`, never promoted |
| 9 | Evaluator-context pollution | Evaluator reads author reasoning; independence lost |
| 10 | Inexplicable evolution | User cannot see why the change is an improvement |

#### Imperative → declarative rewrite (evolution)

| LLM proposal | Declarative evolution proposal |
|---|---|
| "优化这条 loop" | `target=loop_blueprint, single_object=true, dimension=<one_of clarity/reuse/evidence/safety>, before_score=required, after_score=required, delta_min=1.0, evaluator=independent, user_confirmation=required` |
| "这只 bee 该升级" | `target=bee_release, single_object=true, dimension=<one_of success_rate/user_burden/drift/safety>, evaluation_package=before+after+diff+rubric, evaluator_isolation=required, regression_skeptic=required` |
| "这个 gate 不够严" | `target=gate_definition, single_object=true, dimension=coverage_or_safety, validation=dry_run+evidence, before_artifacts=required, after_artifacts=required` |
| "让它更稳定" | `target=loop_or_bee, dimension=stability, validator=regression_skeptic, sample_size_required=true` |

#### Self-check questions (evolution)

1. Did I change exactly one object?
2. Did I optimize exactly one dimension?
3. Is the evaluator the author?
4. Does the evaluator see an evaluation package or the author's full reasoning?
5. Are before/after scores verifiable?
6. Did the score delta meet the threshold?
7. Are failure paths encoded into the new version?
8. Did the user see an evidence brief in the recommendation?

#### Out-of-scope (evolution)

- Emergency hotfix → micro-cycle, not ratchet.
- User explicit "全量重写" → single round with `dimension=full_rewrite`, `delta_min=3.0`, regression skeptic explicit bless.
- Same target + same dimension within 7 days → blocked, user must re-scope or wait.
- Evaluator context cannot be isolated → blocked.

### 8.3 Shared guideline file

The karpathy-engineered rule sets for crystallization and self-evolution are published as:

```text
.peaks/standards/loop-engineering-guidelines.md
```

This file is imported (referenced) by:

- `peaks-code/SKILL.md`
- `peaks-maker/SKILL.md` (renamed/repositioned)
- any future `peaks-*` skill that performs crystallization or evolution.

Reference is by `peaks standards lint --category loop-engineering`, not by copy-paste.

### 8.4 Peaks-* skill import contract

Any new peaks-* skill that participates in Loop Engineering must:

- Reference `.peaks/standards/loop-engineering-guidelines.md` in its SKILL.md.
- Pass `peaks skill lint --category loop-engineering-readiness`.
- Implement the four-section red-line form for any new red line it introduces.
- Use `AskUserQuestion` for choices, NL description for intents; no CLI-verb prompts, no JSON hand-authoring.

---

## 9. Layered external references (advisory)

This section records how peaks-loop combines the two external libraries; the libraries are referenced, not vendored, not forked, and not modified.

### 9.1 karpathy-skills (methodology layer)

- Source: https://github.com/multica-ai/andrej-karpathy-skills
- Borrowed: failure-mode table, imperative→declarative rewrite, self-check questions, out-of-scope rules.
- Applied: every red line in §10; the crystallization rules in §8.1; the evolution rules in §8.2.
- Not borrowed: the original `CLAUDE.md` of that repo. peaks-loop has its own system prompt; we do not merge that file.

### 9.2 darwin-skill (execution layer)

- Source: https://github.com/alchaincyf/darwin-skill
- Borrowed: ratchet, single editable asset, single optimization dimension, independent-context evaluator, regression skeptic, score-delta threshold, early stop.
- Applied: §6 evolution mechanism; §8.2 self-evolution rules.
- Not borrowed: any concrete SKILL.md content; the underlying testing harness is implementation detail, not a contract.

### 9.3 Co-equal relationship (red line)

karpathy and darwin are **co-equal layers**, not sequential. The product principle is:

> **Loop Engineering = karpathy-engineered principles × darwin-verified improvements.** Removing either causes drift.

This relationship is locked as RL-0 in §10.

---

## 10. Red Lines (engineered form)

Each red line is a hard rule. The set is closed under this slice; new red lines require a future slice.

### RL-0 — karpathy × darwin co-equal layers

**Failure modes**
- karpathy-only → principles drift because nothing verifies them.
- darwin-only → verified scores on undefined principles.
- Treating karpathy as darwin's prereq → false sense of security.
- Treating darwin as karpathy's postcheck → form without substance.

**Imperative → declarative rewrite**

```text
user_imperative: "把这条 loop 改得更好"
  → declarative:
      authoring_layer: karpathy (failure modes + rewrite + self-check + out-of-scope)
      verification_layer: darwin (single asset + single dimension + independent eval + ratchet)
      coequal: true
      user_confirmation: required
```

**Self-check questions**
- Does the proposal come with a karpathy-engineered red-line form?
- Does it pass a darwin-style independent evaluation?
- Are both layers represented in the artifact, not just one?

**Out-of-scope**
- Hotfixes (use micro-cycle).
- Pre-run asset creation (use scratch only).

### RL-1 — Human-NL-Choice-Only

**Failure modes**
- User is asked to hand-fill JSON / write manifest / type CLI verb.
- User is pushed into schema decisions they don't understand.
- User accepts model recommendation by default because the option is opaque.

**Imperative → declarative rewrite**

```text
user_imperative: "保留这次流程"
  → declarative:
      user_intent: "preserve this as a reusable loop engineering asset"
      user_choice_options: [create_new_loop, update_existing_loop, trace_only]
      cli_invocation_owned_by: LLM
      forbidden_user_actions: [hand_author_json, type_cli_verb, fill_form_field]
      evidence_brief: required
```

**Self-check questions**
- Does any step require the user to hand-author structured data?
- Is every user choice expressible in natural language?
- Does every recommendation include an evidence brief?

**Out-of-scope**
- Machine-driven flows (CI / autonomous job).
- Emergency security gates (LLM + red lines take over).

### RL-2 — Post-run crystallization

**Failure modes**
- Pre-imagined assets.
- Failed runs promoted as stable.
- Ad-hoc tasks promoted as loops.
- Workflow traces saved as assets.

**Imperative → declarative rewrite**

```text
user_imperative: "沉淀这个"
  → declarative:
      crystallization: gated
      unlocked_when: [task_status=completed, gates_passed=true, evidence_collected=true]
      pre_run_scratch_only: true
      durable_change: requires_user_confirmation
```

**Self-check questions**
- Is the asset from a real completion or pre-imagination?
- If crystallization is skipped, what is lost?
- Is the crystallization entry lightweight enough?

**Out-of-scope**
- Tasks still in scratch phase.
- Tasks with failing gates / evaluators.
- Tasks the user explicitly says "不要沉淀".

### RL-3 — Loop + Bee dual-asset

**Failure modes**
- Only workflow, no method system.
- Only bee, no method system.
- Loop demoted to bee metadata.
- Bee and loop used as synonyms.

**Imperative → declarative rewrite**

```text
user_imperative: "沉淀这次流程"
  → declarative:
      create_or_update:
        loop_release: { role: method_system, owns: [main_bee, supporting_bees] }
        main_bee_release: { role: executable_body, owned_by: loop_release }
        workflow_trace: { role: evidence_only, points_to: [loop_release, main_bee_release] }
```

**Self-check questions**
- Am I writing a loop, a bee, or a trace?
- Does this info belong to "method system", "executable body", or "evidence"?
- If I delete the trace, can the loop still be reused?

**Out-of-scope**
- Simple repeatable steps (bee alone is enough).
- Ad-hoc experiments.

### RL-4 — Darwin-style ratchet (enforced)

**Failure modes**
- Multi-object multi-dimension edits.
- Self-scored evolution.
- Inflated scores.
- Inexplicable improvements.

**Imperative → declarative rewrite**

```text
evolution_proposal:
  target_asset: loop OR bee OR policy OR gate OR evaluator
  single_object: required
  single_optimization_dimension: required
  before_score: required
  after_score: required
  score_delta_min: 1.0
  independent_evaluator: required
  regression_skeptic: required
  user_confirmation: required
  keep_only_if: delta >= threshold
```

**Self-check questions**
- Single object?
- Single dimension?
- Evaluator ≠ author?
- Before/after scores verifiable?
- Delta ≥ threshold?
- Failure paths encoded?

**Out-of-scope**
- Hotfix → micro-cycle.
- User explicit "全量重写" → single round with `delta_min=3.0` and skeptic bless.
- Same target + dimension within 7 days.

### RL-5 — Independent-context evaluation

**Failure modes**
- Author = scorer.
- Scorer reads author full reasoning.
- Bare-numeric recommendation.
- Recommendation that controls the user.

**Imperative → declarative rewrite**

```text
evaluation_package:
  contains: [before, after, diff, dimension, rubric, source_traces]
  excludes: [author_self_praise, "推荐A" framing, full_author_reasoning]
scorer:
  context_isolation: required
  reads: evaluation_package_only
skeptic:
  task: find_regression_drift_overfit
recommendation:
  must_attach: evidence_brief
  must_avoid: bare_numeric_claims
```

**Self-check questions**
- Did the evaluator read the author's full reasoning?
- Did the evaluator output a concrete score delta?
- Is the recommendation only numbers?

**Out-of-scope**
- Internal LLM self-checks (cheap, not user-facing).
- 1-token decisions (cost asymmetric).

### RL-6 — No self-scored evolution

**Failure modes**
- One model writes and scores.
- Evaluator lacks context isolation.
- Evaluator only checks final outcome.
- User faces pure model recommendation.

**Imperative → declarative rewrite**

```text
proposal.author_id != scorer.id
proposal.author_id != final_approver.id
evaluation_context_isolation: enforced
minimum_evaluator_count: 2
must_include: regression_skeptic
```

**Self-check questions**
- Am I both author and evaluator?
- Does the evaluator see an evaluation package or the author's full reasoning?
- Can the evaluator refute the proposal?

**Out-of-scope**
- Patch-level micro-cycle.
- One-line micro-edits.

### RL-7 — Evidence brief required

**Failure modes**
- Bare numbers as evidence.
- No source pointers.
- User cannot decide.
- User auto-accepts recommendation.

**Imperative → declarative rewrite**

```text
recommendation_package:
  evidence_brief:
    contains: [what_happened, why_matters, what_learned, what_action]
    format: natural_language_short
  evidence_bullets:
    format: structured_short
  source_trace_pointers: required
  evaluator_summary: required
  user_decision_summary: required
```

**Self-check questions**
- Am I giving evidence or just data?
- Can the user decide after reading the brief?
- Does the evidence have a source?

**Out-of-scope**
- Sub-1-point micro-adjustments.
- LLM-internal self-check stage.

### RL-8 — peaks-code domain boundary

**Failure modes**
- peaks-code widens into a general orchestrator.
- Non-code capabilities smuggled into peaks-code.
- Other domains expressed as "peaks-code variants".

**Imperative → declarative rewrite**

```text
peaks-code:
  scope: code-domain long-task loop engineering
  is_not: general-purpose orchestrator
non_code_domains:
  shipped_as: peaks-X skills
  must_import: .peaks/standards/loop-engineering-guidelines.md
  must_lint: peaks skill lint --category loop-engineering-readiness
```

**Self-check questions**
- Am I putting non-code capability into peaks-code?
- Is the new domain a new peaks-* skill that imports the guidelines?
- Will the new skill pass `peaks skill lint --category loop-engineering-readiness`?

**Out-of-scope**
- Re-implementing peaks-code as a general orchestrator.

---

## 11. Validation criteria (acceptance)

This spec is accepted when the following ACs are met. Each AC is paired with its primary red line for traceability.

### A. Asset model

- AC-1 (RL-3): Schema files for `loop_release`, `bee_release`, `evolution_evaluation`, `crystallization_event`, `loop_bee_relation` exist with `schemaVersion` set.
- AC-2 (RL-3): `loop_bee_relation` supports `main` / `supporting` / `candidate` / `retired` roles.
- AC-3: Existing 4.x `bee_release` rows remain readable; migration is non-breaking.

### B. Crystallization flow

- AC-4 (RL-2): After a successful run, `peaks asset crystallize` exposes a crystallization prompt.
- AC-5 (RL-7): The prompt includes a complete evidence brief (what / why / learned / action) plus structured bullets and source-trace pointers.
- AC-6 (RL-3): Choosing "create new loop" writes `loop_release` + `main_bee_release` + `loop_bee_relation` in a single transaction.
- AC-7 (RL-1): The user writes no JSON / manifest / CLI verb; all actions are NL or choices.

### C. Darwin-style ratchet

- AC-8 (RL-4): `peaks evolution propose` requires `target_asset` + `optimization_dimension`; multi-object / multi-dimension proposals are rejected.
- AC-9 (RL-4): `peaks evolution evaluate` writes an `evolution_evaluation` row containing before / after / independent scorer / regression skeptic / score delta / keep-or-revert / user-confirmation pointer.
- AC-10 (RL-6): `proposal.author_id != scorer.id` is enforced at the CLI layer; a self-score attempt is rejected with a hard error.
- AC-11 (RL-4): Score delta < threshold (default 1.0) blocks promotion with a clear error.

### D. Independent-context evaluation

- AC-12 (RL-5): The evaluator receives only the evaluation package; the CLI does not pass author reasoning into the evaluator's input.
- AC-13 (RL-5): The evaluator's output contains: structure score, output score, risk tags, refute paragraph.
- AC-14 (RL-5): At least three distinct sub-agents are used per evolution round (author / scorer / skeptic).

### E. Evidence brief

- AC-15 (RL-7): All user-facing recommendations include an evidence brief; the CLI refuses to render a recommendation without it.
- AC-16 (RL-7): The brief template contains 4 sections: what_happened / why_it_matters / what_learned / what_action.
- AC-17 (RL-7): The brief is persisted on `crystallization_event` and `evolution_evaluation` rows.

### F. Domain boundary

- AC-18 (RL-8): `peaks-code/SKILL.md` self-describes as code-domain long-task loop engineering, not general orchestrator.
- AC-19 (RL-8): Any new peaks-* skill ships with a reference to `.peaks/standards/loop-engineering-guidelines.md` and passes `peaks skill lint --category loop-engineering-readiness`.
- AC-20 (RL-8): No non-code capability is added to `peaks-code` in this slice; a `peaks-research` / `peaks-content` / `peaks-product` example is allowed but out of this slice's scope.

### G. Red lines

- AC-21: All 9 red lines (RL-0..RL-8) are present in `.peaks/standards/loop-engineering-guidelines.md` in the four-section form.
- AC-22: `peaks standards lint --category loop-engineering` asserts each red line has all 4 sections and no missing fields.
- AC-23: A regression test in `tests/unit/standards/loop-engineering-guidelines.test.ts` enforces the four-section shape for every red line in the file.

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Naming "loop" overloads with `peaks-loop` product | Use Loop Engineering as a phrase; "loop_release" is the asset name |
| Crystallization prompt becomes noise | Default trigger is `success_default_prompt` (lightweight); user can disable |
| Evaluator context isolation leaks author reasoning | CLI is the only evaluator entry; the eval package is computed by the CLI; LLM never passes raw reasoning through |
| ratchet blocks legitimate large rewrites | `dimension=full_rewrite` escape hatch with `delta_min=3.0` and explicit skeptic bless + user confirmation |
| peaks-maker skill narrative rewrite destabilizes existing skill inventory | `peaks-maker` keeps its id; only the SKILL.md and memory references are re-narrated |
| peaks-workflow demotion breaks ADR 0007 callers | `peaks workflow *` continues to function; only the framing is updated |
| Cross-domain peaks-* skill proliferation | `peaks skill lint --category loop-engineering-readiness` is a hard gate |

---

## 13. Out of scope (explicit)

- Public SkillHub / online marketplace.
- Desktop client UI accelerator (already a memory line; not a code change in this slice).
- Cross-machine loop sync.
- Loop collaboration (CRDT / multi-user edit).
- Real-time visual loop editor.
- LLM self-healing / auto-restore of corrupted SkillHub.
- Migration of historical `rd/tech-doc.md` and pre-4.x `peaks-workflow.yaml` files.
- A specific `peaks-research` / `peaks-content` skill implementation (only the contract is defined; first example is a future slice).

---

## 14. Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-07-07 | Adopt Dual-Asset Model (Loop + Bee + Trace + Evaluation) | User selected C; reasoning that workflow alone is not loop engineering |
| 2026-07-07 | Post-run crystallization is the only durable-change entry | "Only after a run completes do you know what to create" |
| 2026-07-07 | Loop and Bee are written together on crystallization | User confirmed simultaneous creation |
| 2026-07-07 | Loop Engineering is the first-class product; Bee is the executable body | User explicit |
| 2026-07-07 | Darwin-style ratchet is mandatory for evolution | Drift prevention requires independent verification |
| 2026-07-07 | Independent-context evaluation is mandatory | User explicit: "自己写自己评没有意义" |
| 2026-07-07 | karpathy-style engineering of all red lines | User explicit: principles must be engineered, not slogans |
| 2026-07-07 | karpathy × darwin are co-equal, not sequential | User explicit: they are complementary, not substitutable |
| 2026-07-07 | peaks-code stays code-domain only | User explicit: other domains are peaks-* skills, not peaks-code subclasses |
| 2026-07-07 | peaks-workflow demoted to execution trace | Demoted from durable asset to evidence source |
| 2026-07-07 | SkillHub is a Loop & Bee Asset Pool | Storage layer expanded, not replaced |
| 2026-07-07 | Evidence Brief is mandatory for every recommendation | User explicit: counts alone are not enough |
| 2026-07-07 | Triggers: 4 supported, none required, user explicit is highest | User explicit: all four should be supported |

---

## 15. Open questions (for next slice)

1. Exact scoring rubric dimensions and weights for `loop_release` and `bee_release`. Default in this slice: 5 dimensions × 20 points each (clarity, gate coverage, reuse confidence, drift risk, human burden).
2. Default `retire_on_misses_in_row` for promotion. Default in this slice: 3.
3. `peaks-research` as the first reference cross-domain peaks-* skill (out of scope here, but a candidate).
4. Backfill policy for historical 4.x `bee_release` rows that pre-date `loop_release`. Default in this slice: leave as-is; new loop rows reference them via `loop_bee_relation` only on the next crystallization.

---

## 16. Related designs / memory

- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` — 4.x sediment pool (this spec extends it, does not replace)
- `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` — long-task loop (this spec inherits its outer loop)
- `docs/superpowers/specs/2026-07-05-skills-bee-folder-demote-design.md` — physical skill layering (this spec uses it)
- `docs/adr/0007-peaks-workflow-primitive.md` — peaks-workflow (now demoted; ADR will be updated with §"v3 demotion")
- `.peaks/memory/human-nl-choice-only-tenet.md` — RL-1 derives from this
- `.peaks/memory/two-forms-only-rule.md` — RL-1 derives from this
- `.peaks/memory/peaks-loop-24h-ai-programmer-positioning.md` — positions peaks-code as code-domain orchestrator (RL-8 derives from this)
- `.peaks/memory/4x-sediment-pool-reserves-desktop-client-entry-points.md` — desktop client implications (preserved)

---

**End of design.** Next step: writing-plans for implementation. The user must approve this spec before any plan is written.
