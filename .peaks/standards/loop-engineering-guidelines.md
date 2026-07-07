# Loop Engineering Guidelines

> **Source of truth for the karpathy-engineered red lines that govern every
> Loop Engineering asset, CLI verb, and skill in peaks-loop.**
> Consumed by: `peaks standards lint --category loop-engineering`, every peaks-* skill that touches crystallization / evolution, and the post-run handoff.

**Inherits from:** `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` §8, §10.
**External methodology:** https://github.com/multica-ai/andrej-karpathy-skills (failure-mode table, imperative→declarative rewrite, self-check questions, out-of-scope).
**External execution layer:** https://github.com/alchaincyf/darwin-skill (ratchet, independent-context evaluation, regression skeptic).

---

## How to read this file

Every red line uses the karpathy-style 4-section form:

```text
# <Red Line name>
## Failure modes      — drift this rule prevents
## Rewrite            — imperative user NL → declarative system-checkable condition
## Self-check         — questions to ask before writing the change
## Out-of-scope       — when this rule does not apply
```

`peaks standards lint --category loop-engineering` enforces that each red line below has all 4 sections. The lint harness lives at `src/services/standards/loop-engineering-lint.ts` and is exercised by `tests/unit/standards/loop-engineering-guidelines.test.ts`.

Any new red line introduced in any future slice must be added here using the same 4-section form, or the lint will reject the change. The closed set for the 4.x Loop Engineering slice is `RL-0..RL-9`; new red lines require a new spec section and an `evolution_evaluation` row that proves the new rule is a single-dimension, single-asset, independently-scored improvement (RL-4, RL-5, RL-6).

---

## RL-0 — karpathy × darwin are co-equal, not sequential

## Failure modes

- karpathy-only: principles drift because nothing verifies them.
- darwin-only: verified scores on principles that were never clearly defined.
- karpathy-as-darwin-prereq: false sense of security (ratchet still self-scores).
- darwin-as-karpathy-postcheck: form without substance.

## Rewrite

```text
user_imperative: "把这条 loop 改得更好"
  → declarative:
      authoring_layer: karpathy
        artifact: failure_modes + rewrite + self_check + out_of_scope
      verification_layer: darwin
        artifact: single_asset + single_dimension + independent_eval + ratchet
      coequal: true
      user_confirmation: required
```

## Self-check

- Does the proposal come with a karpathy-engineered red-line form?
- Does it pass a darwin-style independent evaluation?
- Are both layers represented in the artifact, not just one?

## Out-of-scope

- Hotfixes (use micro-cycle, not ratchet).
- Pre-run asset creation (use scratch only, not durable write).

---

## RL-1 — Human-NL-Choice-Only (applies to Loop Engineering assets)

## Failure modes

- User is asked to hand-fill JSON, write a manifest, or type a CLI verb.
- User is pushed into schema decisions they do not understand.
- User accepts the model recommendation by default because the option is opaque.
- A new peaks-* skill introduces a UI surface that bypasses the LLM coordination model.

## Rewrite

```text
user_imperative: "保留这次流程"
  → declarative:
      user_intent: preserve_as_loop_engineering_asset
      user_choice_options: [create_new_loop, update_existing_loop, trace_only]
      cli_invocation_owned_by: LLM
      forbidden_user_actions:
        - hand_author_json
        - type_cli_verb
        - fill_form_field_outside_multi_choice_picker
      evidence_brief: required
```

## Self-check

- Does any step require the user to hand-author structured data?
- Is every user choice expressible in natural language?
- Does every recommendation include an evidence brief?
- Does the new skill still gate every CLI invocation through the LLM?

## Out-of-scope

- Machine-driven flows (CI / autonomous job).
- Emergency security gates (LLM + red lines take over; user is informed in NL).

---

## RL-2 — Post-run crystallization is the only entry into durable change

## Failure modes

- Pre-imagined assets created at run start.
- Failed runs promoted as stable.
- Ad-hoc tasks promoted as loops.
- Workflow traces saved as the durable product.

## Rewrite

```text
user_imperative: "沉淀这个"
  → declarative:
      crystallization: gated
      unlocked_when:
        - task_status: completed
        - gates_passed: true
        - evidence_collected: true
      pre_run_scratch_only: true
      durable_change: requires_user_confirmation
      pre_run_stable_creation: blocked
```

## Self-check

- Is the asset from a real completion or pre-imagination?
- If crystallization is skipped, what is lost?
- Is the crystallization entry lightweight enough that it does not become noise?
- Did any code path write a `loop_release` or `bee_release` before the run completed?

## Out-of-scope

- Tasks still in scratch phase.
- Tasks with failing gates / evaluators.
- Tasks the user explicitly says "不要沉淀".
- The dogfood M8 slice in this plan, which is itself the test that proves this rule.

---

## RL-3 — Loop + Bee dual-asset (no synonym, no demotion)

## Failure modes

- Only workflow, no method system.
- Only bee, no method system.
- Loop demoted to bee metadata.
- Bee and loop used as synonyms.
- Crystallization writes a bee without a loop, or a loop without a main bee.

## Rewrite

```text
user_imperative: "沉淀这次流程"
  → declarative:
      create_or_update:
        loop_release:
          role: method_system
          owns: [main_bee, supporting_bees]
        main_bee_release:
          role: executable_body
          owned_by: loop_release
        workflow_trace:
          role: evidence_only
          points_to: [loop_release, main_bee_release]
      schema_required:
        - loop_release_id
        - main_bee_release_id
        - loop_bee_relation.role: main
```

## Self-check

- Am I writing a loop, a bee, or a trace?
- Does this info belong to "method system", "executable body", or "evidence"?
- If I delete the trace, can the loop still be reused?
- Does the crystallization event carry both a `loop_release_id` and a `main_bee_release_id`?

## Out-of-scope

- Simple repeatable steps (bee alone is enough; do not invent a loop).
- Ad-hoc experiments (scratch only).

---

## RL-4 — Darwin-style ratchet (enforced)

## Failure modes

- Multi-object multi-dimension edits in one round.
- Self-scored evolution.
- Inflated scores.
- Inexplicable improvements.
- Promotion with score delta below the threshold.

## Rewrite

```text
evolution_proposal:
  target_asset: loop | bee | policy | gate | evaluator
  single_object: required
  single_optimization_dimension: required
  before_score: required
  after_score: required
  score_delta_min: 1.0
  independent_evaluator: required
  regression_skeptic: required
  user_confirmation: required
  keep_only_if: delta >= threshold
  forbidden_dimensions_in_same_round: [more_than_one_object, more_than_one_dimension]
```

## Self-check

- Single object?
- Single dimension?
- Evaluator ≠ author?
- Before/after scores verifiable?
- Delta ≥ threshold?
- Failure paths encoded into the new version?

## Out-of-scope

- Hotfix → micro-cycle, not ratchet.
- User explicit "全量重写" → single round with `dimension=full_rewrite`, `delta_min=3.0`, explicit skeptic bless, user confirmation.
- Same target + same dimension within 7 days → blocked, user must re-scope or wait.

---

## RL-5 — Independent-context evaluation

## Failure modes

- Author = scorer.
- Scorer reads the author's full reasoning and biases high.
- Bare-numeric recommendation.
- Recommendation that controls the user.

## Rewrite

```text
evaluation_package:
  contains: [before, after, diff, dimension, rubric, source_traces]
  excludes:
    - author_self_praise
    - "推荐A" framing
    - full_author_reasoning
scorer:
  context_isolation: required
  reads: evaluation_package_only
skeptic:
  task: find_regression_drift_overfit
recommendation:
  must_attach: evidence_brief
  must_avoid: bare_numeric_claims
```

## Self-check

- Did the evaluator read the author's full reasoning?
- Did the evaluator output a concrete score delta?
- Is the recommendation only numbers, or is there a brief?
- Does the CLI refuse to pass author-only content into the scorer?

## Out-of-scope

- Internal LLM self-checks (cheap, not user-facing).
- 1-token decisions (cost asymmetric).

---

## RL-6 — No self-scored evolution

## Failure modes

- One model writes and scores.
- Evaluator lacks context isolation.
- Evaluator only checks final outcome.
- User faces pure model recommendation.

## Rewrite

```text
proposal.author_id != scorer.id
proposal.author_id != final_approver.id
evaluation_context_isolation: enforced
minimum_evaluator_count: 2
must_include: regression_skeptic
forbidden_in_proposal:
  - author_acting_as_final_evaluator
  - scorer_reading_full_author_reasoning
```

## Self-check

- Am I both author and evaluator in this round?
- Does the evaluator see an evaluation package or the author's full reasoning?
- Can the evaluator refute the proposal?
- Did the CLI reject a self-score attempt with a hard error?

## Out-of-scope

- Patch-level micro-cycle.
- One-line micro-edits.

---

## RL-7 — Evidence brief required (no count-only evidence)

## Failure modes

- Bare numbers as evidence.
- No source pointers.
- User cannot decide.
- User auto-accepts recommendation.

## Rewrite

```text
recommendation_package:
  evidence_brief:
    contains: [what_happened, why_it_matters, what_learned, what_action]
    format: natural_language_short
  evidence_bullets:
    format: structured_short
  source_trace_pointers: required
  evaluator_summary: required
  user_decision_summary: required
forbidden_in_recommendation:
  - count_only_evidence
  - missing_any_brief_section
```

## Self-check

- Am I giving evidence or just data?
- Can the user decide after reading the brief?
- Does the evidence have a source pointer?
- Are all 4 brief sections present?

## Out-of-scope

- Sub-1-point micro-adjustments (still require the brief; the rule is about form, not size).
- LLM-internal self-check stage.

---

## RL-8 — peaks-code domain boundary

## Failure modes

- peaks-code widens into a general orchestrator.
- Non-code capability smuggled into peaks-code.
- Other domains expressed as "peaks-code variants".
- A new peaks-* skill that does not import the Loop Engineering guidelines.

## Rewrite

```text
peaks-code:
  scope: code-domain long-task loop engineering
  is_not: general_purpose_orchestrator
non_code_domains:
  shipped_as: peaks-X skills
  must_import: .peaks/standards/loop-engineering-guidelines.md
  must_lint: peaks skill lint --category loop-engineering-readiness
forbidden_changes_to_peaks_code:
  - adding_non_code_capability
  - renaming_peaks_code_into_a_general_orchestrator
```

## Self-check

- Am I putting non-code capability into peaks-code?
- Is the new domain a new peaks-* skill that imports the guidelines?
- Will the new skill pass `peaks skill lint --category loop-engineering-readiness`?
- Does the peaks-code SKILL.md self-identify as code-domain only?

## Out-of-scope

- Re-implementing peaks-code as a general orchestrator.
- A "peaks-code for research" or "peaks-code for content" naming.

---

## RL-9 — Desktop + share go through the peaks CLI

## Failure modes

- UI writes to `state.db` directly → bypasses ratchet + evaluation.
- Imported bundle promoted to `stable` without independent evaluation.
- Exported bundle leaks private run-state or personal memory.
- Schema mismatch between sender and receiver without a warn/block.
- Desktop client invents a new IPC bus instead of CLI + run-state.
- Cross-user share happens by sending a raw `state.db` snapshot.

## Rewrite

```text
user_imperative: "把这个 loop 分享给队友"
  → declarative:
      action: peaks loop export --loop <id> --out <path.tar.gz>
      bundle_format: peaks.bundle/1
      includes:
        - loop_release
        - related_bee_releases
        - evidence_briefs
        - relations
      excludes:
        - private_run_state
        - .peaks/memory/personal/
        - raw state.db rows
      receiver_must:
        - import as candidate (no direct stable)
        - run independent evaluation before any durable change
        - respect schemaVersion peaks.loop/1 (major=block, minor=warn)

user_imperative: "在桌面端列出所有 loop"
  → declarative:
      action: peaks skill sediment list --kind loop
      reads_only: true
      forbidden_actions:
        - direct_sqlite
        - direct_filesystem_write
        - custom_ipc_protocol
      source_of_truth: SkillHub (peaks CLI is the only writer)
```

## Self-check

- Is the share / desktop operation going through the peaks CLI?
- Is the bundle free of personal state?
- Does the import path land on `candidate`?
- Does the import path require an independent evaluation before stable?
- Is the schemaVersion checked (major block, minor warn)?
- Is the run-state.json shape read-only for the desktop client?

## Out-of-scope

- Multi-user real-time collaboration.
- Marketplace pricing / ranking.
- Cross-machine automatic sync.
- The desktop implementation itself (only the contract is locked here).
- A public SkillHub registry.

---

## End of file

Total red lines: 9 (RL-0..RL-9). Any new red line introduced in any future slice must be added in the 4-section form above; `peaks standards lint --category loop-engineering` will reject the change otherwise.
